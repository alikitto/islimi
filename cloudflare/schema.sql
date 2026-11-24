-- Каталог Islimi (Cloudflare D1)
-- Порядок товаров = порядок id: чем больше id, тем новее (как строки в бывшей Google-таблице).

CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL,
  video      TEXT    NOT NULL,
  video_sm   TEXT,             -- лёгкая копия 540 px для карточек; NULL → берётся video
  poster     TEXT,             -- JPEG 640×640, первый кадр видео (карточки, превью ссылок); NULL → нет
  category   TEXT    NOT NULL,
  pin        INTEGER NOT NULL DEFAULT 0,
  views      INTEGER NOT NULL DEFAULT 0, -- просмотры на сайте, см. view_log
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
CREATE INDEX IF NOT EXISTS idx_items_code ON items (code);

-- Готовый снимок каталога (JSON), пересобирается при каждом изменении.
-- Чтение сайтом = 1 строка вместо всех товаров.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Сессии админки. В браузере хранится только токен; здесь — его SHA-256.
-- key_fp — отпечаток пароля на момент входа: после смены пароля все сессии недействительны.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  key_fp     TEXT NOT NULL,
  user_agent TEXT,
  location   TEXT,
  created_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Неудачные попытки входа (по хэшу IP) для защиты от подбора пароля.
CREATE TABLE IF NOT EXISTS login_failures (
  ip_hash  TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);

-- Защита счётчика просмотров: посетитель (IP + браузер) засчитывается раз в сутки на товар.
CREATE TABLE IF NOT EXISTS view_log (
  key TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);
