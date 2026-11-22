// Worker "upload-to-r2" (аккаунт islimi):
//   • приём видео из upload.html и запись в R2 (bucket "islimi" → video.islimi.az)
//   • API каталога на D1 (база "islimi-catalog")
//
// Маршруты:
//   GET    /api/items          — каталог JSON (публично)
//   GET    /api/items.tsv      — каталог в формате бывшей Google-таблицы (публично, его читает сайт)
//   GET    /api/auth           — проверка пароля
//   POST   /api/items          — добавить товар            (пароль)
//   PATCH  /api/items/:id      — изменить товар            (пароль)
//   DELETE /api/items/:id      — удалить товар из каталога (пароль; видео в R2 остаётся)
//   POST   /  или /upload      — загрузить видео (+ сразу добавить товар, если передана категория) (пароль)
//
// Пароль: секрет UPLOAD_KEY. В JSON-запросах — заголовок "Authorization: Bearer <пароль>",
// при загрузке файла — поле формы "key". Без заданного секрета все изменения запрещены.

const ALLOWED_ORIGINS = [
  'https://catalog.islimi.az',
  'https://islimi.pages.dev',
  'http://localhost:3000', // локальная проверка
];

const PUBLIC_BASE = 'https://video.islimi.az';
const MAX_BYTES = 50 * 1024 * 1024; // после сжатия файл ~2–3 МБ
const CATEGORIES = ['Üzüklər', 'Sırgalar', 'Qolbaqlar', 'Boyunbağılar'];
const MEMORY_TTL_MS = 15_000; // кэш снимка каталога в памяти изолята

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

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// null — пароль верный; иначе готовый ответ с ошибкой
function checkKey(request, env, provided) {
  if (!env.UPLOAD_KEY) return fail(request, 503, 'Şifrə serverdə təyin edilməyib (UPLOAD_KEY)');
  if (!safeEqual(provided || '', env.UPLOAD_KEY)) return fail(request, 401, 'Şifrə yanlışdır');
  return null;
}

const bearer = (request) => (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

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
    if (!out.code) return { error: 'Məhsul kodu boşdur' };
  }
  if (!partial || input.video !== undefined) {
    out.video = String(input.video || '').trim();
    if (!/^https:\/\/\S+$/.test(out.video)) return { error: 'Video linki yanlışdır' };
  }
  if (!partial || input.category !== undefined) {
    out.category = String(input.category || '').trim();
    if (!CATEGORIES.includes(out.category)) return { error: 'Kateqoriya yanlışdır' };
  }
  if (!partial || input.pin !== undefined) out.pin = toBool(input.pin) ? 1 : 0;
  return { value: out };
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
  const formData = await request.formData();
  const denied = checkKey(request, env, formData.get('key'));
  if (denied) return denied;

  const file = formData.get('file');
  if (!file || typeof file === 'string') return fail(request, 400, 'Fayl seçilməyib');
  if (file.size > MAX_BYTES) return fail(request, 413, 'Fayl çox böyükdür');
  if (file.type && !file.type.startsWith('video/')) return fail(request, 415, 'Yalnız video fayllar');

  // Если передана категория — сначала проверяем товар, чтобы не загружать видео впустую
  const category = formData.get('category');
  let item = null;
  if (category) {
    const check = validateItem({
      code: formData.get('code'), video: PUBLIC_BASE + '/x', category, pin: formData.get('pin'),
    });
    if (check.error) return fail(request, 400, check.error);
    item = check.value;
  }

  const filename = `${Date.now()}-${safeFileName(file.name)}`;
  await env.R2_BUCKET.put(filename, file, {
    httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' },
  });
  const url = `${PUBLIC_BASE}/${filename}`;

  let saved = null;
  if (item) saved = await insertItem(env, { ...item, video: url });
  return json(request, { success: true, url, item: saved });
}

async function handleApi(request, env, path) {
  const method = request.method;

  if (method === 'GET' && (path === '/api/items' || path === '/api/items.tsv')) {
    const snap = await getSnapshot(env);
    const cache = { 'Cache-Control': 'public, max-age=30' };
    if (path === '/api/items') return json(request, JSON.parse(snap.json), 200, cache);
    snap.tsv ??= toTsv(snap.json);
    return new Response(snap.tsv, {
      headers: { 'Content-Type': 'text/tab-separated-values; charset=utf-8', ...corsHeaders(request), ...cache },
    });
  }

  // Всё остальное — только с паролем
  const denied = checkKey(request, env, bearer(request));
  if (denied) return denied;

  if (method === 'GET' && path === '/api/auth') return json(request, { success: true });

  if (method === 'POST' && path === '/api/items') {
    const check = validateItem(await request.json().catch(() => ({})));
    if (check.error) return fail(request, 400, check.error);
    return json(request, { success: true, item: await insertItem(env, check.value) }, 201);
  }

  const m = path.match(/^\/api\/items\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);

    if (method === 'PATCH') {
      const check = validateItem(await request.json().catch(() => ({})), true);
      if (check.error) return fail(request, 400, check.error);
      const fields = Object.keys(check.value);
      if (!fields.length) return fail(request, 400, 'Dəyişiklik yoxdur');
      const sets = fields.map((f, i) => `${f} = ?${i + 1}`).join(', ');
      const row = await env.DB.prepare(
        `UPDATE items SET ${sets} WHERE id = ?${fields.length + 1} RETURNING id, code, video, category, pin, created_at`
      ).bind(...fields.map((f) => check.value[f]), id).first();
      if (!row) return fail(request, 404, 'Məhsul tapılmadı');
      await rebuildSnapshot(env);
      return json(request, { success: true, item: row });
    }

    if (method === 'DELETE') {
      const row = await env.DB.prepare('DELETE FROM items WHERE id = ?1 RETURNING id').bind(id).first();
      if (!row) return fail(request, 404, 'Məhsul tapılmadı');
      await rebuildSnapshot(env);
      return json(request, { success: true });
    }
  }

  return fail(request, 404, 'Not found');
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (path.startsWith('/api/')) return await handleApi(request, env, path);
      if (request.method === 'POST' && (path === '/' || path === '/upload')) return await handleUpload(request, env);
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(request) });
    } catch (err) {
      return fail(request, 500, err.message);
    }
  },
};
