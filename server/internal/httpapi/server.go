package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"enhanced-caixin/server/internal/database"
)

type Server struct {
	articles    *database.ArticleStore
	annotations *database.AnnotationStore
	logger      *slog.Logger
	mux         *http.ServeMux
}

func NewServer(articles *database.ArticleStore, annotations *database.AnnotationStore, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	server := &Server{
		articles:    articles,
		annotations: annotations,
		logger:      logger,
		mux:         http.NewServeMux(),
	}
	server.routes()
	return server.withRequestLogging(server.withCORS(server.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.handleHealthz)
	s.mux.HandleFunc("POST /api/articles", s.handleCreateArticle)
	s.mux.HandleFunc("GET /api/articles/{caixinID}", s.handleGetArticle)
	s.mux.HandleFunc("GET /api/articles/{caixinID}/annotations", s.handleListAnnotations)
	s.mux.HandleFunc("POST /api/articles/{caixinID}/annotations", s.handleCreateAnnotation)
	s.mux.HandleFunc("DELETE /api/annotations/{id}", s.handleDeleteAnnotation)
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleCreateArticle(w http.ResponseWriter, r *http.Request) {
	var article database.Article
	if err := json.NewDecoder(r.Body).Decode(&article); err != nil {
		s.logger.Warn("decode article request failed", "error", err, "remote_addr", r.RemoteAddr)
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if strings.TrimSpace(article.CaixinID) == "" || strings.TrimSpace(article.URL) == "" || strings.TrimSpace(article.Title) == "" {
		s.logger.Warn("article request validation failed",
			"caixin_id", article.CaixinID,
			"url", article.URL,
			"title_present", strings.TrimSpace(article.Title) != "",
		)
		writeError(w, http.StatusBadRequest, "caixin_id, url and title are required")
		return
	}

	s.logger.Info("saving article",
		"caixin_id", article.CaixinID,
		"url", article.URL,
		"title", article.Title,
		"has_content", article.Content != nil && strings.TrimSpace(*article.Content) != "",
	)
	saved, created, err := s.articles.CreateIfNotExists(r.Context(), article)
	if err != nil {
		s.logger.Error("save article failed",
			"error", err,
			"caixin_id", article.CaixinID,
			"url", article.URL,
		)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if created {
		s.logger.Info("article saved", "caixin_id", saved.CaixinID, "id", saved.ID)
	} else {
		s.logger.Info("article already exists", "caixin_id", saved.CaixinID, "id", saved.ID)
	}

	message := "article already exists"
	if created {
		message = "article saved"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": message,
		"created": created,
		"article": saved,
	})
}

func (s *Server) handleGetArticle(w http.ResponseWriter, r *http.Request) {
	caixinID := strings.TrimSpace(r.PathValue("caixinID"))
	if caixinID == "" {
		s.logger.Warn("get article validation failed")
		writeError(w, http.StatusBadRequest, "caixin_id is required")
		return
	}

	article, err := s.articles.FindByCaixinID(r.Context(), caixinID)
	if err != nil {
		if errors.Is(err, database.ErrArticleNotFound) {
			s.logger.Warn("article not found", "caixin_id", caixinID)
			writeError(w, http.StatusNotFound, "article not found")
			return
		}
		s.logger.Error("get article failed", "error", err, "caixin_id", caixinID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.logger.Info("article loaded", "caixin_id", article.CaixinID, "id", article.ID)

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"article": article,
	})
}

func (s *Server) handleListAnnotations(w http.ResponseWriter, r *http.Request) {
	caixinID := strings.TrimSpace(r.PathValue("caixinID"))
	if caixinID == "" {
		writeError(w, http.StatusBadRequest, "caixin_id is required")
		return
	}

	annotations, err := s.annotations.ListByCaixinID(r.Context(), caixinID)
	if err != nil {
		s.logger.Error("list annotations failed", "error", err, "caixin_id", caixinID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"annotations": annotations,
	})
}

func (s *Server) handleCreateAnnotation(w http.ResponseWriter, r *http.Request) {
	caixinID := strings.TrimSpace(r.PathValue("caixinID"))
	if caixinID == "" {
		writeError(w, http.StatusBadRequest, "caixin_id is required")
		return
	}

	var request database.Annotation
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		s.logger.Warn("decode annotation request failed", "error", err, "caixin_id", caixinID)
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	request.Type = strings.TrimSpace(request.Type)
	request.SelectedText = strings.TrimSpace(request.SelectedText)
	request.Color = strings.TrimSpace(request.Color)
	if request.Color == "" {
		request.Color = "yellow"
	}

	if request.Type != "highlight" && request.Type != "note" {
		writeError(w, http.StatusBadRequest, "type must be highlight or note")
		return
	}
	if request.SelectedText == "" {
		writeError(w, http.StatusBadRequest, "selected_text is required")
		return
	}
	if request.EndOffset <= request.StartOffset {
		writeError(w, http.StatusBadRequest, "end_offset must be greater than start_offset")
		return
	}

	article, err := s.articles.FindByCaixinID(r.Context(), caixinID)
	if err != nil {
		if errors.Is(err, database.ErrArticleNotFound) {
			writeError(w, http.StatusNotFound, "article not found")
			return
		}
		s.logger.Error("load article for annotation failed", "error", err, "caixin_id", caixinID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	request.ArticleID = article.ID
	request.CaixinID = article.CaixinID
	annotation, err := s.annotations.Create(r.Context(), request)
	if err != nil {
		s.logger.Error("create annotation failed", "error", err, "caixin_id", caixinID, "article_id", article.ID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"annotation": annotation,
	})
}

func (s *Server) handleDeleteAnnotation(w http.ResponseWriter, r *http.Request) {
	idText := strings.TrimSpace(r.PathValue("id"))
	id, err := strconv.ParseUint(idText, 10, 64)
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, "annotation id is required")
		return
	}

	if err := s.annotations.SoftDelete(r.Context(), id); err != nil {
		s.logger.Error("delete annotation failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) withRequestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		recorder := &statusRecorder{
			ResponseWriter: w,
			status:         http.StatusOK,
		}

		next.ServeHTTP(recorder, r)

		level := slog.LevelInfo
		if recorder.status >= http.StatusInternalServerError {
			level = slog.LevelError
		} else if recorder.status >= http.StatusBadRequest {
			level = slog.LevelWarn
		}

		s.logger.Log(r.Context(), level, "http request",
			"method", r.Method,
			"path", r.URL.Path,
			"query", r.URL.RawQuery,
			"status", recorder.status,
			"bytes", recorder.bytes,
			"duration_ms", time.Since(startedAt).Milliseconds(),
			"remote_addr", r.RemoteAddr,
			"origin", r.Header.Get("Origin"),
			"user_agent", r.UserAgent(),
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(data []byte) (int, error) {
	written, err := r.ResponseWriter.Write(data)
	r.bytes += written
	return written, err
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" || origin == "null" || strings.HasPrefix(origin, "chrome-extension://") || strings.HasPrefix(origin, "http://localhost") || strings.HasPrefix(origin, "http://127.0.0.1") {
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"ok":    false,
		"error": message,
	})
}
