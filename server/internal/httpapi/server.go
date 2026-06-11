package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"enhanced-caixin/server/internal/database"
)

type Server struct {
	store *database.ArticleStore
	mux   *http.ServeMux
}

func NewServer(store *database.ArticleStore) http.Handler {
	server := &Server{
		store: store,
		mux:   http.NewServeMux(),
	}
	server.routes()
	return server.withCORS(server.mux)
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
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if strings.TrimSpace(article.CaixinID) == "" || strings.TrimSpace(article.URL) == "" || strings.TrimSpace(article.Title) == "" {
		writeError(w, http.StatusBadRequest, "caixin_id, url and title are required")
		return
	}

	saved, err := s.store.Upsert(r.Context(), article)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "article saved",
		"article": saved,
	})
}

func (s *Server) handleGetArticle(w http.ResponseWriter, r *http.Request) {
	caixinID := strings.TrimSpace(r.PathValue("caixinID"))
	if caixinID == "" {
		writeError(w, http.StatusBadRequest, "caixin_id is required")
		return
	}

	article, err := s.store.FindByCaixinID(r.Context(), caixinID)
	if err != nil {
		if errors.Is(err, database.ErrArticleNotFound) {
			writeError(w, http.StatusNotFound, "article not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"article": article,
	})
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
