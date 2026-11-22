// Cloudflare Worker "upload-to-r2" — приём видео из upload.html и запись в R2.
//
// Как обновить: Cloudflare → Workers & Pages → upload-to-r2 → Edit code →
// вставить этот файл целиком → Deploy.
//
// Привязки (Settings → Bindings / Variables):
//   R2_BUCKET  — R2 bucket "islimi" (уже настроена)
//   UPLOAD_KEY — секрет (Settings → Variables and Secrets → Add → Secret).
//                Если не задан, загрузка разрешена без пароля, как раньше.

const ALLOWED_ORIGINS = [
  'https://catalog.islimi.az',
  'https://islimi.pages.dev',
  'http://localhost:3000', // локальная проверка формы
];

const PUBLIC_BASE = 'https://video.islimi.az';
const MAX_BYTES = 50 * 1024 * 1024; // после сжатия файл ~2–3 МБ, 50 МБ — с запасом

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeName(name) {
  const base = String(name || 'video')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'video'}.mp4`;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(request) });
    }

    try {
      const formData = await request.formData();

      if (env.UPLOAD_KEY && !safeEqual(formData.get('key'), env.UPLOAD_KEY)) {
        return json(request, { success: false, message: 'Şifrə yanlışdır' }, 401);
      }

      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return json(request, { success: false, message: 'Fayl seçilməyib' }, 400);
      }
      if (file.size > MAX_BYTES) {
        return json(request, { success: false, message: 'Fayl çox böyükdür' }, 413);
      }
      if (file.type && !file.type.startsWith('video/')) {
        return json(request, { success: false, message: 'Yalnız video fayllar' }, 415);
      }

      const filename = `${Date.now()}-${safeName(file.name)}`;
      await env.R2_BUCKET.put(filename, file, {
        httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' },
      });

      return json(request, { success: true, url: `${PUBLIC_BASE}/${filename}` });
    } catch (err) {
      return json(request, { success: false, message: err.message }, 500);
    }
  },
};
