package database

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

const DefaultFavoriteFolderName = "默认收藏"

var ErrFavoriteFolderExists = errors.New("favorite folder already exists")

type FavoriteFolder struct {
	ID        uint64     `json:"id"`
	Name      string     `json:"name"`
	CreatedAt *time.Time `json:"created_at,omitempty"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

type ArticleFavorite struct {
	Favorited bool             `json:"favorited"`
	Folders   []FavoriteFolder `json:"folders"`
}

type FavoriteArticle struct {
	Article     Article          `json:"article"`
	Folders     []FavoriteFolder `json:"folders"`
	FavoritedAt *time.Time       `json:"favorited_at,omitempty"`
}

type FavoriteStore struct {
	db *sql.DB
}

func NewFavoriteStore(db *sql.DB) *FavoriteStore {
	return &FavoriteStore{db: db}
}

func (s *FavoriteStore) ListFolders(ctx context.Context) ([]FavoriteFolder, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, name, created_at, updated_at
FROM favorite_folders
ORDER BY id ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	folders := make([]FavoriteFolder, 0)
	for rows.Next() {
		folder, err := scanFavoriteFolder(rows)
		if err != nil {
			return nil, err
		}
		folders = append(folders, folder)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return folders, nil
}

func (s *FavoriteStore) CreateFolder(ctx context.Context, name string) (FavoriteFolder, error) {
	name = strings.TrimSpace(name)
	result, err := s.db.ExecContext(ctx, `
INSERT INTO favorite_folders (name) VALUES (?)
`, name)
	if err != nil {
		if isDuplicateKey(err) {
			return FavoriteFolder{}, ErrFavoriteFolderExists
		}
		return FavoriteFolder{}, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return FavoriteFolder{}, err
	}
	return s.FindFolderByID(ctx, uint64(id))
}

func (s *FavoriteStore) EnsureDefaultFolder(ctx context.Context) (FavoriteFolder, error) {
	folder, err := s.FindFolderByName(ctx, DefaultFavoriteFolderName)
	if err == nil {
		return folder, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FavoriteFolder{}, err
	}

	if _, err := s.db.ExecContext(ctx, `
INSERT IGNORE INTO favorite_folders (name) VALUES (?)
`, DefaultFavoriteFolderName); err != nil {
		return FavoriteFolder{}, err
	}
	return s.FindFolderByName(ctx, DefaultFavoriteFolderName)
}

func (s *FavoriteStore) FindFolderByID(ctx context.Context, id uint64) (FavoriteFolder, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, name, created_at, updated_at
FROM favorite_folders
WHERE id = ?
LIMIT 1
`, id)
	return scanFavoriteFolder(row)
}

func (s *FavoriteStore) FindFolderByName(ctx context.Context, name string) (FavoriteFolder, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, name, created_at, updated_at
FROM favorite_folders
WHERE name = ?
LIMIT 1
`, name)
	return scanFavoriteFolder(row)
}

func (s *FavoriteStore) GetArticleFavorite(ctx context.Context, articleID uint64) (ArticleFavorite, error) {
	folders, err := s.listFoldersByArticleID(ctx, articleID)
	if err != nil {
		return ArticleFavorite{}, err
	}
	return ArticleFavorite{
		Favorited: len(folders) > 0,
		Folders:   folders,
	}, nil
}

func (s *FavoriteStore) ReplaceArticleFolders(ctx context.Context, articleID uint64, folderIDs []uint64) (ArticleFavorite, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ArticleFavorite{}, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
DELETE FROM article_favorite_folders
WHERE article_id = ?
`, articleID); err != nil {
		return ArticleFavorite{}, err
	}

	for _, folderID := range uniqueUint64s(folderIDs) {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO article_favorite_folders (article_id, folder_id)
VALUES (?, ?)
`, articleID, folderID); err != nil {
			return ArticleFavorite{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return ArticleFavorite{}, err
	}
	return s.GetArticleFavorite(ctx, articleID)
}

func (s *FavoriteStore) ClearArticleFavorite(ctx context.Context, articleID uint64) error {
	_, err := s.db.ExecContext(ctx, `
DELETE FROM article_favorite_folders
WHERE article_id = ?
`, articleID)
	return err
}

func (s *FavoriteStore) ListArticles(ctx context.Context, folderID uint64, limit int, offset int) ([]FavoriteArticle, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	var rows *sql.Rows
	var err error
	if folderID > 0 {
		rows, err = s.db.QueryContext(ctx, `
SELECT a.id, a.caixin_id, a.url, a.title, a.author, a.catagory, a.publish_time,
       a.content, a.add_time, a.reserved_3, a.reserved_4, a.reserved_5,
       a.created_at, a.updated_at, favorite_articles.favorited_at
FROM (
  SELECT article_id, MAX(created_at) AS favorited_at
  FROM article_favorite_folders
  WHERE folder_id = ?
  GROUP BY article_id
) favorite_articles
JOIN articles a ON a.id = favorite_articles.article_id
ORDER BY favorite_articles.favorited_at DESC, a.id DESC
LIMIT ? OFFSET ?
`, folderID, limit, offset)
	} else {
		rows, err = s.db.QueryContext(ctx, `
SELECT a.id, a.caixin_id, a.url, a.title, a.author, a.catagory, a.publish_time,
       a.content, a.add_time, a.reserved_3, a.reserved_4, a.reserved_5,
       a.created_at, a.updated_at, favorite_articles.favorited_at
FROM (
  SELECT article_id, MAX(created_at) AS favorited_at
  FROM article_favorite_folders
  GROUP BY article_id
) favorite_articles
JOIN articles a ON a.id = favorite_articles.article_id
ORDER BY favorite_articles.favorited_at DESC, a.id DESC
LIMIT ? OFFSET ?
`, limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	articles := make([]FavoriteArticle, 0)
	for rows.Next() {
		favorite, err := scanFavoriteArticle(rows)
		if err != nil {
			return nil, err
		}
		folders, err := s.listFoldersByArticleID(ctx, favorite.Article.ID)
		if err != nil {
			return nil, err
		}
		favorite.Folders = folders
		articles = append(articles, favorite)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return articles, nil
}

func (s *FavoriteStore) listFoldersByArticleID(ctx context.Context, articleID uint64) ([]FavoriteFolder, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT ff.id, ff.name, ff.created_at, ff.updated_at
FROM favorite_folders ff
JOIN article_favorite_folders aff ON aff.folder_id = ff.id
WHERE aff.article_id = ?
ORDER BY ff.id ASC
`, articleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	folders := make([]FavoriteFolder, 0)
	for rows.Next() {
		folder, err := scanFavoriteFolder(rows)
		if err != nil {
			return nil, err
		}
		folders = append(folders, folder)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return folders, nil
}

type favoriteFolderScanner interface {
	Scan(dest ...any) error
}

func scanFavoriteFolder(scanner favoriteFolderScanner) (FavoriteFolder, error) {
	var folder FavoriteFolder
	var createdAt, updatedAt sql.NullTime
	if err := scanner.Scan(&folder.ID, &folder.Name, &createdAt, &updatedAt); err != nil {
		return FavoriteFolder{}, err
	}
	folder.CreatedAt = timePtr(createdAt)
	folder.UpdatedAt = timePtr(updatedAt)
	return folder, nil
}

func scanFavoriteArticle(scanner favoriteFolderScanner) (FavoriteArticle, error) {
	var favorite FavoriteArticle
	var author, catagory, content, reserved3, reserved4, reserved5 sql.NullString
	var publishTime, addTime, createdAt, updatedAt, favoritedAt sql.NullTime
	if err := scanner.Scan(
		&favorite.Article.ID,
		&favorite.Article.CaixinID,
		&favorite.Article.URL,
		&favorite.Article.Title,
		&author,
		&catagory,
		&publishTime,
		&content,
		&addTime,
		&reserved3,
		&reserved4,
		&reserved5,
		&createdAt,
		&updatedAt,
		&favoritedAt,
	); err != nil {
		return FavoriteArticle{}, err
	}

	favorite.Article.Author = stringPtr(author)
	favorite.Article.Catagory = stringPtr(catagory)
	favorite.Article.PublishTime = timePtr(publishTime)
	favorite.Article.Content = stringPtr(content)
	favorite.Article.AddTime = timePtr(addTime)
	favorite.Article.Reserved3 = stringPtr(reserved3)
	favorite.Article.Reserved4 = stringPtr(reserved4)
	favorite.Article.Reserved5 = stringPtr(reserved5)
	favorite.Article.CreatedAt = timePtr(createdAt)
	favorite.Article.UpdatedAt = timePtr(updatedAt)
	favorite.FavoritedAt = timePtr(favoritedAt)

	return favorite, nil
}

func uniqueUint64s(values []uint64) []uint64 {
	seen := make(map[uint64]bool, len(values))
	unique := make([]uint64, 0, len(values))
	for _, value := range values {
		if value == 0 || seen[value] {
			continue
		}
		seen[value] = true
		unique = append(unique, value)
	}
	return unique
}

func isDuplicateKey(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1062
}
