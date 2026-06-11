package database

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var ErrArticleNotFound = errors.New("article not found")

type Article struct {
	ID          uint64     `json:"id,omitempty"`
	CaixinID    string     `json:"caixin_id"`
	URL         string     `json:"url"`
	Title       string     `json:"title"`
	Author      *string    `json:"author,omitempty"`
	Catagory    *string    `json:"catagory,omitempty"`
	PublishTime *time.Time `json:"publish_time,omitempty"`
	Content     *string    `json:"content,omitempty"`
	Reserved1   *string    `json:"reserved_1,omitempty"`
	Reserved2   *string    `json:"reserved_2,omitempty"`
	Reserved3   *string    `json:"reserved_3,omitempty"`
	Reserved4   *string    `json:"reserved_4,omitempty"`
	Reserved5   *string    `json:"reserved_5,omitempty"`
	CreatedAt   *time.Time `json:"created_at,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

type ArticleStore struct {
	db *sql.DB
}

func NewArticleStore(db *sql.DB) *ArticleStore {
	return &ArticleStore{db: db}
}

func (s *ArticleStore) Upsert(ctx context.Context, article Article) (Article, error) {
	reserved1 := article.Reserved1
	if reserved1 == nil {
		reserved1 = article.Content
	}

	_, err := s.db.ExecContext(ctx, `
INSERT INTO articles (
  caixin_id, url, title, author, catagory, publish_time,
  reserved_1, reserved_2, reserved_3, reserved_4, reserved_5
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  caixin_id = VALUES(caixin_id),
  url = VALUES(url),
  title = VALUES(title),
  author = VALUES(author),
  catagory = VALUES(catagory),
  publish_time = VALUES(publish_time),
  reserved_1 = VALUES(reserved_1),
  reserved_2 = VALUES(reserved_2),
  reserved_3 = VALUES(reserved_3),
  reserved_4 = VALUES(reserved_4),
  reserved_5 = VALUES(reserved_5)
`, article.CaixinID, article.URL, article.Title, article.Author, article.Catagory, article.PublishTime,
		reserved1, article.Reserved2, article.Reserved3, article.Reserved4, article.Reserved5)
	if err != nil {
		return Article{}, err
	}

	return s.FindByCaixinID(ctx, article.CaixinID)
}

func (s *ArticleStore) FindByCaixinID(ctx context.Context, caixinID string) (Article, error) {
	return s.findOne(ctx, "caixin_id = ?", caixinID)
}

func (s *ArticleStore) FindByURL(ctx context.Context, url string) (Article, error) {
	return s.findOne(ctx, "url = ?", url)
}

func (s *ArticleStore) findOne(ctx context.Context, where string, arg any) (Article, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, caixin_id, url, title, author, catagory, publish_time,
       reserved_1, reserved_2, reserved_3, reserved_4, reserved_5,
       created_at, updated_at
FROM articles
WHERE `+where+`
LIMIT 1
`, arg)

	var article Article
	var author, catagory, reserved1, reserved2, reserved3, reserved4, reserved5 sql.NullString
	var publishTime, createdAt, updatedAt sql.NullTime
	if err := row.Scan(
		&article.ID,
		&article.CaixinID,
		&article.URL,
		&article.Title,
		&author,
		&catagory,
		&publishTime,
		&reserved1,
		&reserved2,
		&reserved3,
		&reserved4,
		&reserved5,
		&createdAt,
		&updatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Article{}, ErrArticleNotFound
		}
		return Article{}, err
	}

	article.Author = stringPtr(author)
	article.Catagory = stringPtr(catagory)
	article.PublishTime = timePtr(publishTime)
	article.Reserved1 = stringPtr(reserved1)
	article.Content = article.Reserved1
	article.Reserved2 = stringPtr(reserved2)
	article.Reserved3 = stringPtr(reserved3)
	article.Reserved4 = stringPtr(reserved4)
	article.Reserved5 = stringPtr(reserved5)
	article.CreatedAt = timePtr(createdAt)
	article.UpdatedAt = timePtr(updatedAt)

	return article, nil
}

func stringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func timePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}
