-- Счётчик просмотров товара (открытие окна товара на сайте).
-- Один и тот же посетитель (IP + браузер) засчитывается не чаще раза в сутки на товар.
ALTER TABLE items ADD COLUMN views INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS view_log (
  key TEXT PRIMARY KEY, -- sha256(посетитель + товар + день)
  at  INTEGER NOT NULL  -- ms, для очистки старых записей
);
