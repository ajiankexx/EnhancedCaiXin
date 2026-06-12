ALTER TABLE articles
  CHANGE COLUMN reserved_1 content TEXT NULL;

ALTER TABLE articles
  ADD COLUMN add_time DATETIME NULL AFTER content;

UPDATE articles
SET add_time = created_at
WHERE add_time IS NULL;

ALTER TABLE articles
  DROP COLUMN reserved_2;
