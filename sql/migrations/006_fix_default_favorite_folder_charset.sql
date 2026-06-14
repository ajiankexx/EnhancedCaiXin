INSERT IGNORE INTO favorite_folders (name) VALUES ('默认收藏');

INSERT IGNORE INTO article_favorite_folders (article_id, folder_id, created_at)
SELECT bad_links.article_id, good_folder.id, MIN(bad_links.created_at)
FROM article_favorite_folders AS bad_links
JOIN favorite_folders AS bad_folder ON bad_folder.id = bad_links.folder_id
JOIN favorite_folders AS good_folder ON good_folder.name = '默认收藏'
WHERE bad_folder.name <> '默认收藏'
  AND (bad_folder.id = 1 OR bad_folder.name LIKE 'é»%')
GROUP BY bad_links.article_id, good_folder.id;

DELETE bad_links
FROM article_favorite_folders AS bad_links
JOIN favorite_folders AS bad_folder ON bad_folder.id = bad_links.folder_id
WHERE bad_folder.name <> '默认收藏'
  AND (bad_folder.id = 1 OR bad_folder.name LIKE 'é»%');

DELETE FROM favorite_folders
WHERE name <> '默认收藏'
  AND (id = 1 OR name LIKE 'é»%');
