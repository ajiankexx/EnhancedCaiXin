CREATE TABLE IF NOT EXISTS article_annotations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  article_id BIGINT UNSIGNED NOT NULL,
  caixin_id VARCHAR(128) NOT NULL,
  type ENUM('highlight', 'note') NOT NULL,
  selected_text TEXT NOT NULL,
  note_text TEXT NULL,
  color VARCHAR(32) NOT NULL DEFAULT 'yellow',
  start_offset INT UNSIGNED NOT NULL,
  end_offset INT UNSIGNED NOT NULL,
  prefix_text VARCHAR(255) NULL,
  suffix_text VARCHAR(255) NULL,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_article_annotations_article_position (article_id, start_offset, created_at),
  KEY idx_article_annotations_caixin_position (caixin_id, start_offset, created_at),
  KEY idx_article_annotations_deleted_at (deleted_at),
  CONSTRAINT fk_article_annotations_article
    FOREIGN KEY (article_id) REFERENCES articles (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
