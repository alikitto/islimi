-- Лёгкая копия видео (540 px) для карточек каталога. NULL → сайт берёт основное видео.
ALTER TABLE items ADD COLUMN video_sm TEXT;
