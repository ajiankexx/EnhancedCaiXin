package database

import (
	"context"
	"database/sql"
	"time"
)

type Annotation struct {
	ID           uint64     `json:"id,omitempty"`
	ArticleID    uint64     `json:"article_id,omitempty"`
	CaixinID     string     `json:"caixin_id"`
	Type         string     `json:"type"`
	SelectedText string     `json:"selected_text"`
	NoteText     *string    `json:"note_text,omitempty"`
	Color        string     `json:"color"`
	StartOffset  uint       `json:"start_offset"`
	EndOffset    uint       `json:"end_offset"`
	PrefixText   *string    `json:"prefix_text,omitempty"`
	SuffixText   *string    `json:"suffix_text,omitempty"`
	DeletedAt    *time.Time `json:"deleted_at,omitempty"`
	CreatedAt    *time.Time `json:"created_at,omitempty"`
	UpdatedAt    *time.Time `json:"updated_at,omitempty"`
}

type AnnotationStore struct {
	db *sql.DB
}

func NewAnnotationStore(db *sql.DB) *AnnotationStore {
	return &AnnotationStore{db: db}
}

func (s *AnnotationStore) Create(ctx context.Context, annotation Annotation) (Annotation, error) {
	result, err := s.db.ExecContext(ctx, `
INSERT INTO article_annotations (
  article_id, caixin_id, type, selected_text, note_text, color,
  start_offset, end_offset, prefix_text, suffix_text
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, annotation.ArticleID, annotation.CaixinID, annotation.Type, annotation.SelectedText, annotation.NoteText,
		annotation.Color, annotation.StartOffset, annotation.EndOffset, annotation.PrefixText, annotation.SuffixText)
	if err != nil {
		return Annotation{}, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return Annotation{}, err
	}
	return s.FindByID(ctx, uint64(id))
}

func (s *AnnotationStore) ListByCaixinID(ctx context.Context, caixinID string) ([]Annotation, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, article_id, caixin_id, type, selected_text, note_text, color,
       start_offset, end_offset, prefix_text, suffix_text, deleted_at,
       created_at, updated_at
FROM article_annotations
WHERE caixin_id = ? AND deleted_at IS NULL
ORDER BY start_offset ASC, created_at ASC
`, caixinID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	annotations := make([]Annotation, 0)
	for rows.Next() {
		annotation, err := scanAnnotation(rows)
		if err != nil {
			return nil, err
		}
		annotations = append(annotations, annotation)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return annotations, nil
}

func (s *AnnotationStore) FindByID(ctx context.Context, id uint64) (Annotation, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, article_id, caixin_id, type, selected_text, note_text, color,
       start_offset, end_offset, prefix_text, suffix_text, deleted_at,
       created_at, updated_at
FROM article_annotations
WHERE id = ?
LIMIT 1
`, id)
	return scanAnnotation(row)
}

func (s *AnnotationStore) SoftDelete(ctx context.Context, id uint64) error {
	_, err := s.db.ExecContext(ctx, `
UPDATE article_annotations
SET deleted_at = CURRENT_TIMESTAMP
WHERE id = ? AND deleted_at IS NULL
`, id)
	return err
}

type annotationScanner interface {
	Scan(dest ...any) error
}

func scanAnnotation(scanner annotationScanner) (Annotation, error) {
	var annotation Annotation
	var noteText, prefixText, suffixText sql.NullString
	var deletedAt, createdAt, updatedAt sql.NullTime
	if err := scanner.Scan(
		&annotation.ID,
		&annotation.ArticleID,
		&annotation.CaixinID,
		&annotation.Type,
		&annotation.SelectedText,
		&noteText,
		&annotation.Color,
		&annotation.StartOffset,
		&annotation.EndOffset,
		&prefixText,
		&suffixText,
		&deletedAt,
		&createdAt,
		&updatedAt,
	); err != nil {
		return Annotation{}, err
	}

	annotation.NoteText = stringPtr(noteText)
	annotation.PrefixText = stringPtr(prefixText)
	annotation.SuffixText = stringPtr(suffixText)
	annotation.DeletedAt = timePtr(deletedAt)
	annotation.CreatedAt = timePtr(createdAt)
	annotation.UpdatedAt = timePtr(updatedAt)

	return annotation, nil
}
