package database

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var ErrWordNoteNotFound = errors.New("word note not found")

type WordNote struct {
	ID              uint64     `json:"id,omitempty"`
	WordName        string     `json:"word_name"`
	WordExplanation string     `json:"word_explanation"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	CreatedAt       *time.Time `json:"created_at,omitempty"`
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
}

type WordNoteSource struct {
	ID           uint64     `json:"id,omitempty"`
	WordNoteID   uint64     `json:"word_note_id,omitempty"`
	ArticleID    uint64     `json:"article_id,omitempty"`
	CaixinID     string     `json:"caixin_id"`
	SelectedText string     `json:"selected_text"`
	PrefixText   *string    `json:"prefix_text,omitempty"`
	SuffixText   *string    `json:"suffix_text,omitempty"`
	StartOffset  uint       `json:"start_offset"`
	EndOffset    uint       `json:"end_offset"`
	CreatedAt    *time.Time `json:"created_at,omitempty"`
	Article      *Article   `json:"article,omitempty"`
}

type WordNoteDetail struct {
	WordNote WordNote         `json:"word_note"`
	Sources  []WordNoteSource `json:"sources"`
}

type WordNoteStore struct {
	db *sql.DB
}

func NewWordNoteStore(db *sql.DB) *WordNoteStore {
	return &WordNoteStore{db: db}
}

func (s *WordNoteStore) Upsert(ctx context.Context, note WordNote) (WordNote, error) {
	note.WordName = strings.TrimSpace(note.WordName)
	note.WordExplanation = strings.TrimSpace(note.WordExplanation)
	_, err := s.db.ExecContext(ctx, `
INSERT INTO word_notes (word_name, word_explanation, deleted_at)
VALUES (?, ?, NULL)
ON DUPLICATE KEY UPDATE
  word_explanation = VALUES(word_explanation),
  deleted_at = NULL,
  updated_at = CURRENT_TIMESTAMP
`, note.WordName, note.WordExplanation)
	if err != nil {
		return WordNote{}, err
	}
	return s.FindByName(ctx, note.WordName)
}

func (s *WordNoteStore) FindByID(ctx context.Context, id uint64) (WordNote, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, word_name, word_explanation, deleted_at, created_at, updated_at
FROM word_notes
WHERE id = ? AND deleted_at IS NULL
LIMIT 1
`, id)
	return scanWordNote(row)
}

func (s *WordNoteStore) FindByName(ctx context.Context, wordName string) (WordNote, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, word_name, word_explanation, deleted_at, created_at, updated_at
FROM word_notes
WHERE word_name = ? AND deleted_at IS NULL
LIMIT 1
`, wordName)
	return scanWordNote(row)
}

func (s *WordNoteStore) Search(ctx context.Context, query string, limit int, offset int) ([]WordNote, error) {
	query = strings.TrimSpace(query)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	var rows *sql.Rows
	var err error
	if query == "" {
		rows, err = s.db.QueryContext(ctx, `
SELECT id, word_name, word_explanation, deleted_at, created_at, updated_at
FROM word_notes
WHERE deleted_at IS NULL
ORDER BY updated_at DESC, id DESC
LIMIT ? OFFSET ?
`, limit, offset)
	} else {
		likeQuery := "%" + escapeLike(query) + "%"
		rows, err = s.db.QueryContext(ctx, `
SELECT id, word_name, word_explanation, deleted_at, created_at, updated_at
FROM word_notes
WHERE deleted_at IS NULL
  AND (
    MATCH(word_name, word_explanation) AGAINST (? IN NATURAL LANGUAGE MODE)
    OR word_name LIKE ? ESCAPE '\\'
    OR word_explanation LIKE ? ESCAPE '\\'
  )
ORDER BY MATCH(word_name, word_explanation) AGAINST (? IN NATURAL LANGUAGE MODE) DESC,
         updated_at DESC,
         id DESC
LIMIT ? OFFSET ?
`, query, likeQuery, likeQuery, query, limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notes := make([]WordNote, 0)
	for rows.Next() {
		note, err := scanWordNote(rows)
		if err != nil {
			return nil, err
		}
		notes = append(notes, note)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return notes, nil
}

func (s *WordNoteStore) Detail(ctx context.Context, id uint64) (WordNoteDetail, error) {
	note, err := s.FindByID(ctx, id)
	if err != nil {
		return WordNoteDetail{}, err
	}
	sources, err := s.ListSources(ctx, id)
	if err != nil {
		return WordNoteDetail{}, err
	}
	return WordNoteDetail{WordNote: note, Sources: sources}, nil
}

func (s *WordNoteStore) AddSource(ctx context.Context, note WordNote, source WordNoteSource) (WordNoteDetail, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WordNoteDetail{}, err
	}
	defer tx.Rollback()

	note.WordName = strings.TrimSpace(note.WordName)
	note.WordExplanation = strings.TrimSpace(note.WordExplanation)
	if _, err := tx.ExecContext(ctx, `
INSERT INTO word_notes (word_name, word_explanation, deleted_at)
VALUES (?, ?, NULL)
ON DUPLICATE KEY UPDATE
  word_explanation = IF(VALUES(word_explanation) = '', word_explanation, VALUES(word_explanation)),
  deleted_at = NULL,
  updated_at = CURRENT_TIMESTAMP
`, note.WordName, note.WordExplanation); err != nil {
		return WordNoteDetail{}, err
	}

	var noteID uint64
	if err := tx.QueryRowContext(ctx, `
SELECT id
FROM word_notes
WHERE word_name = ?
LIMIT 1
`, note.WordName).Scan(&noteID); err != nil {
		return WordNoteDetail{}, err
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO word_note_sources (
  word_note_id, article_id, caixin_id, selected_text,
  prefix_text, suffix_text, start_offset, end_offset
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`, noteID, source.ArticleID, source.CaixinID, source.SelectedText, source.PrefixText,
		source.SuffixText, source.StartOffset, source.EndOffset); err != nil {
		return WordNoteDetail{}, err
	}

	if err := tx.Commit(); err != nil {
		return WordNoteDetail{}, err
	}
	return s.Detail(ctx, noteID)
}

func (s *WordNoteStore) ListByArticleID(ctx context.Context, articleID uint64) ([]WordNote, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT DISTINCT n.id, n.word_name, n.word_explanation, n.deleted_at, n.created_at, n.updated_at
FROM word_notes n
JOIN word_note_sources s ON s.word_note_id = n.id
WHERE s.article_id = ? AND n.deleted_at IS NULL
ORDER BY n.updated_at DESC, n.id DESC
`, articleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notes := make([]WordNote, 0)
	for rows.Next() {
		note, err := scanWordNote(rows)
		if err != nil {
			return nil, err
		}
		notes = append(notes, note)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return notes, nil
}

func (s *WordNoteStore) ListSources(ctx context.Context, wordNoteID uint64) ([]WordNoteSource, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT s.id, s.word_note_id, s.article_id, s.caixin_id, s.selected_text,
       s.prefix_text, s.suffix_text, s.start_offset, s.end_offset, s.created_at,
       a.id, a.caixin_id, a.url, a.title, a.author, a.catagory, a.publish_time,
       a.content, a.add_time, a.reserved_3, a.reserved_4, a.reserved_5,
       a.created_at, a.updated_at
FROM word_note_sources s
JOIN articles a ON a.id = s.article_id
WHERE s.word_note_id = ?
ORDER BY s.created_at DESC, s.id DESC
`, wordNoteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sources := make([]WordNoteSource, 0)
	for rows.Next() {
		source, err := scanWordNoteSourceWithArticle(rows)
		if err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return sources, nil
}

func (s *WordNoteStore) SoftDelete(ctx context.Context, id uint64) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE word_notes
SET deleted_at = CURRENT_TIMESTAMP
WHERE id = ? AND deleted_at IS NULL
`, id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrWordNoteNotFound
	}
	return nil
}

type wordNoteScanner interface {
	Scan(dest ...any) error
}

func scanWordNote(scanner wordNoteScanner) (WordNote, error) {
	var note WordNote
	var deletedAt, createdAt, updatedAt sql.NullTime
	if err := scanner.Scan(
		&note.ID,
		&note.WordName,
		&note.WordExplanation,
		&deletedAt,
		&createdAt,
		&updatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WordNote{}, ErrWordNoteNotFound
		}
		return WordNote{}, err
	}
	note.DeletedAt = timePtr(deletedAt)
	note.CreatedAt = timePtr(createdAt)
	note.UpdatedAt = timePtr(updatedAt)
	return note, nil
}

func scanWordNoteSourceWithArticle(scanner wordNoteScanner) (WordNoteSource, error) {
	var source WordNoteSource
	var prefixText, suffixText sql.NullString
	var sourceCreatedAt sql.NullTime
	article, err := scanArticle(&compoundScanner{
		scan: scanner.Scan,
		before: []any{
			&source.ID,
			&source.WordNoteID,
			&source.ArticleID,
			&source.CaixinID,
			&source.SelectedText,
			&prefixText,
			&suffixText,
			&source.StartOffset,
			&source.EndOffset,
			&sourceCreatedAt,
		},
	})
	if err != nil {
		return WordNoteSource{}, err
	}
	source.PrefixText = stringPtr(prefixText)
	source.SuffixText = stringPtr(suffixText)
	source.CreatedAt = timePtr(sourceCreatedAt)
	source.Article = &article
	return source, nil
}

type compoundScanner struct {
	scan   func(dest ...any) error
	before []any
}

func (s *compoundScanner) Scan(dest ...any) error {
	return s.scan(append(s.before, dest...)...)
}
