CREATE TABLE IF NOT EXISTS favorite_folders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_favorite_folders_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS article_favorite_folders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  article_id BIGINT UNSIGNED NOT NULL,
  folder_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_article_favorite_folders_article_folder (article_id, folder_id),
  KEY idx_article_favorite_folders_folder_created (folder_id, created_at),
  KEY idx_article_favorite_folders_article_created (article_id, created_at),
  CONSTRAINT fk_article_favorite_folders_article
    FOREIGN KEY (article_id) REFERENCES articles (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_article_favorite_folders_folder
    FOREIGN KEY (folder_id) REFERENCES favorite_folders (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO favorite_folders (name) VALUES ('默认收藏');
