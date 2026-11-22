-- Каталог Islimi (Cloudflare D1)
-- Порядок товаров = порядок id: чем больше id, тем новее (как строки в бывшей Google-таблице).

CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL,
  video      TEXT    NOT NULL,
  category   TEXT    NOT NULL,
  pin        INTEGER NOT NULL DEFAULT 0,
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
