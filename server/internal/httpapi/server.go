package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"enhanced-caixin/server/internal/database"
)

type Server struct {
	store  *database.ArticleStore
	logger *slog.Logger
	mux    *http.ServeMux
}

func NewServer(store *database.ArticleStore, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	server := &Server{
		store:  store,
		logger: logger,
		mux:    http.NewServeMux(),
	}
	server.routes()
	return server.withRequestLogging(server.withCORS(server.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.handleHealthz)
	s.mux.HandleFunc("POST /api/articles", s.handleCreateArticle)
	s.mux.HandleFunc("GET /api/articles/{caixinID}", s.handleGetArticle)
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
	saved, created, err := s.store.CreateIfNotExists(r.Context(), article)
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

	article, err := s.store.FindByCaixinID(r.Context(), caixinID)
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
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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
