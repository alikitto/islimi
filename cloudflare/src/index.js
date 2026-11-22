// Worker "upload-to-r2" (аккаунт islimi):
//   • приём видео и запись в R2 (bucket "islimi" → video.islimi.az)
//   • API каталога на D1 (база "islimi-catalog")
//   • вход в админку: пароль → сессия на 30 дней (продлевается при использовании)
//
// Маршруты:
//   GET    /api/items           — каталог JSON (публично)
//   GET    /api/items.tsv       — каталог в формате бывшей Google-таблицы (публично, его читает сайт)
//   POST   /api/login           — {password} → {token}; 5 ошибок за 15 мин → блокировка на 15 мин
//   GET    /api/me              — текущая сессия                     (сессия)
//   POST   /api/logout          — завершить текущую сессию           (сессия)
//   GET    /api/sessions        — активные сессии                    (сессия)
//   DELETE /api/sessions        — выйти на всех устройствах          (сессия)
//   DELETE /api/sessions/:id    — завершить одну сессию              (сессия)
//   POST   /api/items           — добавить товар                     (сессия)
//   PATCH  /api/items/:id       — изменить товар                     (сессия)
//   DELETE /api/items/:id       — удалить товар (видео в R2 остаётся) (сессия)
//   POST   /upload              — загрузить видео и добавить товар    (сессия)
//
// Сессия передаётся заголовком "Authorization: Bearer <token>".
// Пароль — секрет UPLOAD_KEY. Его смена завершает все сессии.

const ALLOWED_ORIGINS = [
  'https://catalog.islimi.az',
  'https://islimi.pages.dev',
  'http://localhost:3000', // локальная проверка
];

const PUBLIC_BASE = 'https://video.islimi.az';
const MAX_BYTES = 50 * 1024 * 1024; // после сжатия файл ~2–3 МБ
const CATEGORIES = ['Üzüklər', 'Sırgalar', 'Qolbaqlar', 'Boyunbağılar'];
const MEMORY_TTL_MS = 15_000; // кэш снимка каталога в памяти изолята

const SESSION_DAYS = 30;
const TOUCH_EVERY_MS = 60 * 60 * 1000; // продлевать сессию не чаще раза в час
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

let memo = null; // { at, json, tsv }

// ---------- HTTP helpers ----------

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request), ...extra },
  });
}

const fail = (request, status, message) => json(request, { success: false, message }, status);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const bearer = (request) => (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

// ---------- Sessions ----------

async function keyFingerprint(env) {
  if (!env.UPLOAD_KEY) throw new HttpError(503, 'Şifrə serverdə təyin edilməyib (UPLOAD_KEY)');
  return (await sha256('islimi-key:' + env.UPLOAD_KEY)).slice(0, 16);
}

async function login(request, env) {
  const fp = await keyFingerprint(env);
  const ipHash = (await sha256('islimi-ip:' + (request.headers.get('CF-Connecting-IP') || 'local'))).slice(0, 32);
  const now = Date.now();

  const fails = await env.DB.prepare('SELECT count, first_at FROM login_failures WHERE ip_hash = ?1').bind(ipHash).first();
  if (fails && now - fails.first_at < LOCK_MS && fails.count >= MAX_FAILURES) {
    const minutes = Math.ceil((LOCK_MS - (now - fails.first_at)) / 60000);
    throw new HttpError(429, `Çox cəhd edildi. ${minutes} dəqiqə sonra yenidən yoxlayın.`);
  }

  const body = await request.json().catch(() => ({}));
  if (!safeEqual(String(body.password || ''), env.UPLOAD_KEY)) {
    if (!fails || now - fails.first_at >= LOCK_MS) {
      await env.DB.prepare(
        'INSERT INTO login_failures (ip_hash, count, first_at) VALUES (?1, 1, ?2) ON CONFLICT(ip_hash) DO UPDATE SET count = 1, first_at = ?2'
      ).bind(ipHash, now).run();
    } else {
      await env.DB.prepare('UPDATE login_failures SET count = count + 1 WHERE ip_hash = ?1').bind(ipHash).run();
    }
    const left = MAX_FAILURES - ((fails && now - fails.first_at < LOCK_MS ? fails.count : 0) + 1);
    throw new HttpError(401, left > 0 ? `Şifrə yanlışdır (${left} cəhd qaldı)` : 'Şifrə yanlışdır. Giriş 15 dəqiqəlik bağlandı.');
  }

  const token = randomToken(32);
  const cf = request.cf || {};
  const location = [cf.city, cf.country].filter(Boolean).join(', ') || null;
  const session = {
    id: randomId(),
    user_agent: (request.headers.get('User-Agent') || '').slice(0, 300),
    location,
    created_at: iso(now),
    last_seen: iso(now),
    expires_at: iso(now + SESSION_DAYS * 86400000),
  };

  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_failures WHERE ip_hash = ?1').bind(ipHash),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1 OR key_fp != ?2').bind(iso(now), fp),
    env.DB.prepare(
      'INSERT INTO sessions (id, token_hash, key_fp, user_agent, location, created_at, last_seen, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
    ).bind(session.id, await sha256(token), fp, session.user_agent, session.location, session.created_at, session.last_seen, session.expires_at),
  ]);

  return { token, session };
}

// Возвращает текущую сессию или бросает 401
async function authenticate(request, env) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'Daxil olun');
  const fp = await keyFingerprint(env);
  const s = await env.DB.prepare(
    'SELECT id, key_fp, user_agent, location, created_at, last_seen, expires_at FROM sessions WHERE token_hash = ?1'
  ).bind(await sha256(token)).first();

  const now = Date.now();
  if (!s || s.key_fp !== fp || Date.parse(s.expires_at) < now) {
    if (s) await env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(s.id).run();
    throw new HttpError(401, 'Sessiya bitib. Yenidən daxil olun.');
  }

  if (now - Date.parse(s.last_seen) > TOUCH_EVERY_MS) {
    s.last_seen = iso(now);
    s.expires_at = iso(now + SESSION_DAYS * 86400000);
    await env.DB.prepare('UPDATE sessions SET last_seen = ?1, expires_at = ?2 WHERE id = ?3').bind(s.last_seen, s.expires_at, s.id).run();
  }
  delete s.key_fp;
  return s;
}

async function listSessions(env, currentId) {
  const fp = await keyFingerprint(env);
  const { results } = await env.DB.prepare(
    'SELECT id, user_agent, location, created_at, last_seen, expires_at FROM sessions WHERE key_fp = ?1 AND expires_at > ?2 ORDER BY last_seen DESC'
  ).bind(fp, iso(Date.now())).all();
  return results.map((s) => ({ ...s, current: s.id === currentId }));
}

// ---------- Validation ----------

// "UN-0141" → "un0141" (как в бывшей таблице)
function normalizeCode(code) {
  return String(code || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

function safeFileName(name) {
  const base = String(name || 'video')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'video'}.mp4`;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  return ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
}

// Проверяет и нормализует поля товара. partial=true — для PATCH (только переданные поля).
function validateItem(input, partial = false) {
  const out = {};
  if (!partial || input.code !== undefined) {
    out.code = normalizeCode(input.code);
    if (!out.code) throw new HttpError(400, 'Məhsul kodu boşdur');
  }
  if (!partial || input.video !== undefined) {
    out.video = String(input.video || '').trim();
    if (!/^https:\/\/\S+$/.test(out.video)) throw new HttpError(400, 'Video linki yanlışdır');
  }
  if (!partial || input.category !== undefined) {
    out.category = String(input.category || '').trim();
    if (!CATEGORIES.includes(out.category)) throw new HttpError(400, 'Kateqoriya yanlışdır');
  }
  if (!partial || input.pin !== undefined) out.pin = toBool(input.pin) ? 1 : 0;
  return out;
}

// ---------- Catalog snapshot ----------

async function rebuildSnapshot(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, code, video, category, pin, created_at FROM items ORDER BY id'
  ).all();
  const snapshot = JSON.stringify({ updated: new Date().toISOString(), items: results });
  await env.DB.prepare(
    "INSERT INTO meta (key, value) VALUES ('catalog', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(snapshot).run();
  memo = null;
  return snapshot;
}

async function getSnapshot(env) {
  if (memo && Date.now() - memo.at < MEMORY_TTL_MS) return memo;
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'catalog'").first();
  const jsonText = row?.value ?? (await rebuildSnapshot(env));
  memo = { at: Date.now(), json: jsonText, tsv: null };
  return memo;
}

function toTsv(jsonText) {
  const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
  const lines = ['Kod\tVideo URL\tCategory\tPIN'];
  for (const it of JSON.parse(jsonText).items) {
    lines.push([clean(it.code), clean(it.video), clean(it.category), it.pin ? 'YES' : ''].join('\t'));
  }
  return lines.join('\n');
}

async function insertItem(env, item) {
  const row = await env.DB.prepare(
    'INSERT INTO items (code, video, category, pin) VALUES (?1, ?2, ?3, ?4) RETURNING id, code, video, category, pin, created_at'
  ).bind(item.code, item.video, item.category, item.pin).first();
  await rebuildSnapshot(env);
  return row;
}

// ---------- Handlers ----------

async function handleUpload(request, env) {
  await authenticate(request, env);
  const formData = await request.formData();

  const file = formData.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'Fayl seçilməyib');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'Fayl çox böyükdür');
  if (file.type && !file.type.startsWith('video/')) throw new HttpError(415, 'Yalnız video fayllar');

  // Сначала проверяем товар, чтобы не загружать видео впустую
  const item = validateItem({
    code: formData.get('code'), video: PUBLIC_BASE + '/x', category: formData.get('category'), pin: formData.get('pin'),
  });

  const filename = `${Date.now()}-${safeFileName(file.name)}`;
  await env.R2_BUCKET.put(filename, file, {
    httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' },
  });
  const url = `${PUBLIC_BASE}/${filename}`;
  const saved = await insertItem(env, { ...item, video: url });
  return json(request, { success: true, url, item: saved });
}

async function handleApi(request, env, path) {
  const method = request.method;

  // --- публичное ---
  if (method === 'GET' && (path === '/api/items' || path === '/api/items.tsv')) {
    const snap = await getSnapshot(env);
    const cache = { 'Cache-Control': 'public, max-age=30' };
    if (path === '/api/items') return json(request, JSON.parse(snap.json), 200, cache);
    snap.tsv ??= toTsv(snap.json);
    return new Response(snap.tsv, {
      headers: { 'Content-Type': 'text/tab-separated-values; charset=utf-8', ...corsHeaders(request), ...cache },
    });
  }

  if (method === 'POST' && path === '/api/login') {
    const { token, session } = await login(request, env);
    return json(request, { success: true, token, session: { ...session, current: true } });
  }

  // --- только с сессией ---
  const session = await authenticate(request, env);

  if (method === 'GET' && path === '/api/me') return json(request, { success: true, session: { ...session, current: true } });

  if (method === 'POST' && path === '/api/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(session.id).run();
    return json(request, { success: true });
  }

  if (path === '/api/sessions') {
    if (method === 'GET') return json(request, { success: true, sessions: await listSessions(env, session.id) });
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM sessions').run();
      return json(request, { success: true });
    }
  }

  const sm = path.match(/^\/api\/sessions\/([0-9a-f]{16})$/);
  if (sm && method === 'DELETE') {
    const row = await env.DB.prepare('DELETE FROM sessions WHERE id = ?1 RETURNING id').bind(sm[1]).first();
    if (!row) throw new HttpError(404, 'Sessiya tapılmadı');
    return json(request, { success: true });
  }

  if (method === 'POST' && path === '/api/items') {
    const item = validateItem(await request.json().catch(() => ({})));
    return json(request, { success: true, item: await insertItem(env, item) }, 201);
  }

  const m = path.match(/^\/api\/items\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);

    if (method === 'PATCH') {
      const patch = validateItem(await request.json().catch(() => ({})), true);
      const fields = Object.keys(patch);
      if (!fields.length) throw new HttpError(400, 'Dəyişiklik yoxdur');
      const sets = fields.map((f, i) => `${f} = ?${i + 1}`).join(', ');
      const row = await env.DB.prepare(
        `UPDATE items SET ${sets} WHERE id = ?${fields.length + 1} RETURNING id, code, video, category, pin, created_at`
      ).bind(...fields.map((f) => patch[f]), id).first();
      if (!row) throw new HttpError(404, 'Məhsul tapılmadı');
      await rebuildSnapshot(env);
      return json(request, { success: true, item: row });
    }

    if (method === 'DELETE') {
      const row = await env.DB.prepare('DELETE FROM items WHERE id = ?1 RETURNING id').bind(id).first();
      if (!row) throw new HttpError(404, 'Məhsul tapılmadı');
      await rebuildSnapshot(env);
      return json(request, { success: true });
    }
  }

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (path.startsWith('/api/')) return await handleApi(request, env, path);
      if (request.method === 'POST' && path === '/upload') return await handleUpload(request, env);
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(request) });
    } catch (err) {
      if (err instanceof HttpError) return fail(request, err.status, err.message);
      return fail(request, 500, err.message);
    }
  },
};
