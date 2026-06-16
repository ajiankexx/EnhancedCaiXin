CREATE TABLE IF NOT EXISTS word_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  word_name VARCHAR(255) NOT NULL,
  word_explanation TEXT NOT NULL,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_word_notes_name (word_name),
  KEY idx_word_notes_deleted_at (deleted_at),
  FULLTEXT KEY ft_word_notes_name_explanation (word_name, word_explanation)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS word_note_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  word_note_id BIGINT UNSIGNED NOT NULL,
  article_id BIGINT UNSIGNED NOT NULL,
  caixin_id VARCHAR(128) NOT NULL,
  selected_text TEXT NOT NULL,
  prefix_text VARCHAR(255) NULL,
  suffix_text VARCHAR(255) NULL,
  start_offset INT UNSIGNED NOT NULL,
  end_offset INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_word_note_sources_note_created (word_note_id, created_at),
  KEY idx_word_note_sources_article_position (article_id, start_offset, created_at),
  KEY idx_word_note_sources_caixin_position (caixin_id, start_offset, created_at),
  CONSTRAINT fk_word_note_sources_note
    FOREIGN KEY (word_note_id) REFERENCES word_notes (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_word_note_sources_article
    FOREIGN KEY (article_id) REFERENCES articles (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
