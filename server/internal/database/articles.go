package database

import (
	"context"
	"database/sql"
	"errors"
	"strings"
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
	AddTime     *time.Time `json:"add_time,omitempty"`
	Reserved3   *string    `json:"reserved_3,omitempty"`
	Reserved4   *string    `json:"reserved_4,omitempty"`
	Reserved5   *string    `json:"reserved_5,omitempty"`
	CreatedAt   *time.Time `json:"created_at,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

type ArticleSearchResult struct {
	Article Article `json:"article"`
	Snippet string  `json:"snippet,omitempty"`
	Score   float64 `json:"score,omitempty"`
}

type ArticleStore struct {
	db *sql.DB
}

func NewArticleStore(db *sql.DB) *ArticleStore {
	return &ArticleStore{db: db}
}

func (s *ArticleStore) CreateIfNotExists(ctx context.Context, article Article) (Article, bool, error) {
	existing, err := s.FindByCaixinID(ctx, article.CaixinID)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, ErrArticleNotFound) {
		return Article{}, false, err
	}

	addTime := time.Now()

	_, err = s.db.ExecContext(ctx, `
INSERT INTO articles (
  caixin_id, url, title, author, catagory, publish_time,
  content, add_time, reserved_3, reserved_4, reserved_5
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
`, article.CaixinID, article.URL, article.Title, article.Author, article.Catagory, article.PublishTime,
		article.Content, addTime)
	if err != nil {
		return Article{}, false, err
	}

	saved, err := s.FindByCaixinID(ctx, article.CaixinID)
	if err != nil {
		return Article{}, false, err
	}
	return saved, true, nil
}

func (s *ArticleStore) FindByCaixinID(ctx context.Context, caixinID string) (Article, error) {
	return s.findOne(ctx, "caixin_id = ?", caixinID)
}

func (s *ArticleStore) FindByURL(ctx context.Context, url string) (Article, error) {
	return s.findOne(ctx, "url = ?", url)
}

func (s *ArticleStore) DeleteByCaixinID(ctx context.Context, caixinID string) error {
	result, err := s.db.ExecContext(ctx, `
DELETE FROM articles
WHERE caixin_id = ?
`, caixinID)
	if err != nil {
		return err
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrArticleNotFound
	}
	return nil
}

func (s *ArticleStore) Search(ctx context.Context, query string, limit int, offset int) ([]ArticleSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []ArticleSearchResult{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	likeQuery := "%" + escapeLike(query) + "%"
	rows, err := s.db.QueryContext(ctx, `
SELECT id, caixin_id, url, title, author, catagory, publish_time,
       content, add_time, reserved_3, reserved_4, reserved_5,
       created_at, updated_at,
       MATCH(title, author, catagory, content) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
FROM articles
WHERE MATCH(title, author, catagory, content) AGAINST (? IN NATURAL LANGUAGE MODE)
   OR title LIKE ? ESCAPE '\\'
   OR author LIKE ? ESCAPE '\\'
   OR catagory LIKE ? ESCAPE '\\'
   OR content LIKE ? ESCAPE '\\'
ORDER BY score DESC, publish_time DESC, id DESC
LIMIT ? OFFSET ?
`, query, query, likeQuery, likeQuery, likeQuery, likeQuery, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]ArticleSearchResult, 0)
	for rows.Next() {
		result, err := scanArticleSearchResult(rows, query)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func (s *ArticleStore) findOne(ctx context.Context, where string, arg any) (Article, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, caixin_id, url, title, author, catagory, publish_time,
       content, add_time, reserved_3, reserved_4, reserved_5,
       created_at, updated_at
FROM articles
WHERE `+where+`
LIMIT 1
`, arg)

	article, err := scanArticle(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Article{}, ErrArticleNotFound
		}
		return Article{}, err
	}

	return article, nil
}

type articleScanner interface {
	Scan(dest ...any) error
}

func scanArticle(scanner articleScanner) (Article, error) {
	var article Article
	var author, catagory, content, reserved3, reserved4, reserved5 sql.NullString
	var publishTime, addTime, createdAt, updatedAt sql.NullTime
	if err := scanner.Scan(
		&article.ID,
		&article.CaixinID,
		&article.URL,
		&article.Title,
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
	); err != nil {
		return Article{}, err
	}

	article.Author = stringPtr(author)
	article.Catagory = stringPtr(catagory)
	article.PublishTime = timePtr(publishTime)
	article.Content = stringPtr(content)
	article.AddTime = timePtr(addTime)
	article.Reserved3 = stringPtr(reserved3)
	article.Reserved4 = stringPtr(reserved4)
	article.Reserved5 = stringPtr(reserved5)
	article.CreatedAt = timePtr(createdAt)
	article.UpdatedAt = timePtr(updatedAt)

	return article, nil
}

func scanArticleSearchResult(scanner articleScanner, query string) (ArticleSearchResult, error) {
	var article Article
	var author, catagory, content, reserved3, reserved4, reserved5 sql.NullString
	var publishTime, addTime, createdAt, updatedAt sql.NullTime
	var score sql.NullFloat64
	if err := scanner.Scan(
		&article.ID,
		&article.CaixinID,
		&article.URL,
		&article.Title,
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
		&score,
	); err != nil {
		return ArticleSearchResult{}, err
	}

	article.Author = stringPtr(author)
	article.Catagory = stringPtr(catagory)
	article.PublishTime = timePtr(publishTime)
	article.AddTime = timePtr(addTime)
	article.Reserved3 = stringPtr(reserved3)
	article.Reserved4 = stringPtr(reserved4)
	article.Reserved5 = stringPtr(reserved5)
	article.CreatedAt = timePtr(createdAt)
	article.UpdatedAt = timePtr(updatedAt)

	return ArticleSearchResult{
		Article: article,
		Snippet: buildSnippet(content.String, query, 120),
		Score:   score.Float64,
	}, nil
}

func buildSnippet(content string, query string, radius int) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	query = strings.TrimSpace(query)
	contentRunes := []rune(content)
	if query == "" || len(contentRunes) <= radius*2 {
		return string(contentRunes[:minInt(len(contentRunes), radius*2)])
	}

	lowerContent := strings.ToLower(content)
	lowerQuery := strings.ToLower(query)
	byteIndex := strings.Index(lowerContent, lowerQuery)
	if byteIndex < 0 {
		return string(contentRunes[:minInt(len(contentRunes), radius*2)])
	}

	runeIndex := len([]rune(content[:byteIndex]))
	start := runeIndex - radius
	if start < 0 {
		start = 0
	}
	end := runeIndex + len([]rune(query)) + radius
	if end > len(contentRunes) {
		end = len(contentRunes)
	}

	prefix := ""
	if start > 0 {
		prefix = "..."
	}
	suffix := ""
	if end < len(contentRunes) {
		suffix = "..."
	}
	return prefix + string(contentRunes[start:end]) + suffix
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
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
