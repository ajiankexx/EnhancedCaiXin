package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
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
	favorites   *database.FavoriteStore
	wordNotes   *database.WordNoteStore
	logger      *slog.Logger
	mux         *http.ServeMux
}

func NewServer(articles *database.ArticleStore, annotations *database.AnnotationStore, favorites *database.FavoriteStore, wordNotes *database.WordNoteStore, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	server := &Server{
		articles:    articles,
		annotations: annotations,
		favorites:   favorites,
		wordNotes:   wordNotes,
		logger:      logger,
		mux:         http.NewServeMux(),
	}
	server.routes()
	return server.withRequestLogging(server.withCORS(server.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.handleHealthz)
	s.mux.HandleFunc("POST /api/articles", s.handleCreateArticle)
	s.mux.HandleFunc("GET /api/articles/search", s.handleSearchArticles)
	s.mux.HandleFunc("GET /api/articles/{caixinID}", s.handleGetArticle)
	s.mux.HandleFunc("DELETE /api/articles/{caixinID}", s.handleDeleteArticle)
	s.mux.HandleFunc("GET /api/articles/{caixinID}/annotations", s.handleListAnnotations)
	s.mux.HandleFunc("POST /api/articles/{caixinID}/annotations", s.handleCreateAnnotation)
	s.mux.HandleFunc("DELETE /api/annotations/{id}", s.handleDeleteAnnotation)
	s.mux.HandleFunc("GET /api/favorite-folders", s.handleListFavoriteFolders)
	s.mux.HandleFunc("POST /api/favorite-folders", s.handleCreateFavoriteFolder)
	s.mux.HandleFunc("GET /api/articles/{caixinID}/favorite", s.handleGetArticleFavorite)
	s.mux.HandleFunc("POST /api/articles/{caixinID}/favorite", s.handleSaveArticleFavorite)
	s.mux.HandleFunc("DELETE /api/articles/{caixinID}/favorite", s.handleDeleteArticleFavorite)
	s.mux.HandleFunc("GET /api/favorites", s.handleListFavorites)
	s.mux.HandleFunc("GET /api/word-notes", s.handleListWordNotes)
	s.mux.HandleFunc("POST /api/word-notes", s.handleSaveWordNote)
	s.mux.HandleFunc("GET /api/word-notes/{id}", s.handleGetWordNote)
	s.mux.HandleFunc("DELETE /api/word-notes/{id}", s.handleDeleteWordNote)
	s.mux.HandleFunc("GET /api/articles/{caixinID}/word-notes", s.handleListArticleWordNotes)
	s.mux.HandleFunc("POST /api/articles/{caixinID}/word-notes", s.handleSaveArticleWordNote)
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

func (s *Server) handleSearchArticles(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeError(w, http.StatusBadRequest, "q is required")
		return
	}
	if len([]rune(query)) > 128 {
		writeError(w, http.StatusBadRequest, "q is too long")
		return
	}

	limit, err := parseIntQuery(r, "limit", 50)
	if err != nil {
		writeError(w, http.StatusBadRequest, "limit must be an integer")
		return
	}
	offset, err := parseIntQuery(r, "offset", 0)
	if err != nil {
		writeError(w, http.StatusBadRequest, "offset must be an integer")
		return
	}

	results, err := s.articles.Search(r.Context(), query, limit, offset)
	if err != nil {
		s.logger.Error("search articles failed", "error", err, "query", query, "limit", limit, "offset", offset)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"query":   query,
		"results": results,
	})
}

func (s *Server) handleDeleteArticle(w http.ResponseWriter, r *http.Request) {
	caixinID := strings.TrimSpace(r.PathValue("caixinID"))
	if caixinID == "" {
		writeError(w, http.StatusBadRequest, "caixin_id is required")
		return
	}

	if err := s.articles.DeleteByCaixinID(r.Context(), caixinID); err != nil {
		if errors.Is(err, database.ErrArticleNotFound) {
			writeError(w, http.StatusNotFound, "article not found")
			return
		}
		s.logger.Error("delete article failed", "error", err, "caixin_id", caixinID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.logger.Info("article deleted", "caixin_id", caixinID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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

func (s *Server) handleListFavoriteFolders(w http.ResponseWriter, r *http.Request) {
	if _, err := s.favorites.EnsureDefaultFolder(r.Context()); err != nil {
		s.logger.Error("ensure default favorite folder failed", "error", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	folders, err := s.favorites.ListFolders(r.Context())
	if err != nil {
		s.logger.Error("list favorite folders failed", "error", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"folders": folders,
	})
}

func (s *Server) handleCreateFavoriteFolder(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	request.Name = strings.TrimSpace(request.Name)
	if request.Name == "" {
		writeError(w, http.StatusBadRequest, "folder name is required")
		return
	}
	if len([]rune(request.Name)) > 128 {
		writeError(w, http.StatusBadRequest, "folder name is too long")
		return
	}

	folder, err := s.favorites.CreateFolder(r.Context(), request.Name)
	if err != nil {
		if errors.Is(err, database.ErrFavoriteFolderExists) {
			writeError(w, http.StatusConflict, "favorite folder already exists")
			return
		}
		s.logger.Error("create favorite folder failed", "error", err, "name", request.Name)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"folder": folder,
	})
}

func (s *Server) handleGetArticleFavorite(w http.ResponseWriter, r *http.Request) {
	article, ok := s.loadArticleByPathCaixinID(w, r, "get article favorite")
	if !ok {
		return
	}

	favorite, err := s.favorites.GetArticleFavorite(r.Context(), article.ID)
	if err != nil {
		s.logger.Error("get article favorite failed", "error", err, "caixin_id", article.CaixinID, "article_id", article.ID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"favorite": favorite,
	})
}

func (s *Server) handleSaveArticleFavorite(w http.ResponseWriter, r *http.Request) {
	article, ok := s.loadArticleByPathCaixinID(w, r, "save article favorite")
	if !ok {
		return
	}

	var request struct {
		FolderIDs []uint64 `json:"folder_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	folderIDs := uniqueUint64s(request.FolderIDs)
	if len(folderIDs) == 0 {
		defaultFolder, err := s.favorites.EnsureDefaultFolder(r.Context())
		if err != nil {
			s.logger.Error("ensure default favorite folder failed", "error", err)
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		folderIDs = []uint64{defaultFolder.ID}
	}

	favorite, err := s.favorites.ReplaceArticleFolders(r.Context(), article.ID, folderIDs)
	if err != nil {
		s.logger.Error("save article favorite failed", "error", err, "caixin_id", article.CaixinID, "article_id", article.ID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"favorite": favorite,
	})
}

func (s *Server) handleDeleteArticleFavorite(w http.ResponseWriter, r *http.Request) {
	article, ok := s.loadArticleByPathCaixinID(w, r, "delete article favorite")
	if !ok {
		return
	}

	if err := s.favorites.ClearArticleFavorite(r.Context(), article.ID); err != nil {
		s.logger.Error("delete article favorite failed", "error", err, "caixin_id", article.CaixinID, "article_id", article.ID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListFavorites(w http.ResponseWriter, r *http.Request) {
	folderID, err := parseOptionalUintQuery(r, "folder_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "folder_id must be a positive integer")
		return
	}
	limit, err := parseIntQuery(r, "limit", 50)
	if err != nil {
		writeError(w, http.StatusBadRequest, "limit must be an integer")
		return
	}
	offset, err := parseIntQuery(r, "offset", 0)
	if err != nil {
		writeError(w, http.StatusBadRequest, "offset must be an integer")
		return
	}

	favorites, err := s.favorites.ListArticles(r.Context(), folderID, limit, offset)
	if err != nil {
		s.logger.Error("list favorites failed", "error", err, "folder_id", folderID, "limit", limit, "offset", offset)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"favorites": favorites,
	})
}

func (s *Server) handleListWordNotes(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 128 {
		writeError(w, http.StatusBadRequest, "q is too long")
		return
	}
	limit, err := parseIntQuery(r, "limit", 50)
	if err != nil {
		writeError(w, http.StatusBadRequest, "limit must be an integer")
		return
	}
	offset, err := parseIntQuery(r, "offset", 0)
	if err != nil {
		writeError(w, http.StatusBadRequest, "offset must be an integer")
		return
	}

	notes, err := s.wordNotes.Search(r.Context(), query, limit, offset)
	if err != nil {
		s.logger.Error("list word notes failed", "error", err, "query", query, "limit", limit, "offset", offset)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"word_notes": notes,
	})
}

func (s *Server) handleSaveWordNote(w http.ResponseWriter, r *http.Request) {
	var request database.WordNote
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	request.WordName = strings.TrimSpace(request.WordName)
	request.WordExplanation = strings.TrimSpace(request.WordExplanation)
	if err := validateWordNote(request.WordName, request.WordExplanation); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	note, err := s.wordNotes.Upsert(r.Context(), request)
	if err != nil {
		s.logger.Error("save word note failed", "error", err, "word_name", request.WordName)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"word_note": note,
	})
}

func (s *Server) handleGetWordNote(w http.ResponseWriter, r *http.Request) {
	id, ok := parsePathUint(w, r.PathValue("id"), "word note id is required")
	if !ok {
		return
	}

	detail, err := s.wordNotes.Detail(r.Context(), id)
	if err != nil {
		if errors.Is(err, database.ErrWordNoteNotFound) {
			writeError(w, http.StatusNotFound, "word note not found")
			return
		}
		s.logger.Error("get word note failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"detail": detail,
	})
}

func (s *Server) handleDeleteWordNote(w http.ResponseWriter, r *http.Request) {
	id, ok := parsePathUint(w, r.PathValue("id"), "word note id is required")
	if !ok {
		return
	}

	if err := s.wordNotes.SoftDelete(r.Context(), id); err != nil {
		if errors.Is(err, database.ErrWordNoteNotFound) {
			writeError(w, http.StatusNotFound, "word note not found")
			return
		}
		s.logger.Error("delete word note failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListArticleWordNotes(w http.ResponseWriter, r *http.Request) {
	caixinID := strings.TrimSpace(r.PathValue("caixinID"))
	if caixinID == "" {
		writeError(w, http.StatusBadRequest, "caixin_id is required")
		return
	}

	article, err := s.articles.FindByCaixinID(r.Context(), caixinID)
	if err != nil {
		if errors.Is(err, database.ErrArticleNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":         true,
				"word_notes": []database.WordNote{},
			})
			return
		}
		s.logger.Error("list article word notes failed to load article", "error", err, "caixin_id", caixinID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	notes, err := s.wordNotes.ListByArticleID(r.Context(), article.ID)
	if err != nil {
		s.logger.Error("list article word notes failed", "error", err, "caixin_id", article.CaixinID, "article_id", article.ID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"word_notes": notes,
	})
}

func (s *Server) handleSaveArticleWordNote(w http.ResponseWriter, r *http.Request) {
	article, ok := s.loadArticleByPathCaixinID(w, r, "save article word note")
	if !ok {
		return
	}

	var request struct {
		WordName        string  `json:"word_name"`
		WordExplanation string  `json:"word_explanation"`
		SelectedText    string  `json:"selected_text"`
		PrefixText      *string `json:"prefix_text,omitempty"`
		SuffixText      *string `json:"suffix_text,omitempty"`
		StartOffset     uint    `json:"start_offset"`
		EndOffset       uint    `json:"end_offset"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	request.WordName = strings.TrimSpace(request.WordName)
	request.WordExplanation = strings.TrimSpace(request.WordExplanation)
	request.SelectedText = strings.TrimSpace(request.SelectedText)
	if request.SelectedText == "" {
		request.SelectedText = request.WordName
	}
	if err := validateWordNote(request.WordName, request.WordExplanation); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if request.EndOffset <= request.StartOffset {
		writeError(w, http.StatusBadRequest, "end_offset must be greater than start_offset")
		return
	}

	detail, err := s.wordNotes.AddSource(r.Context(), database.WordNote{
		WordName:        request.WordName,
		WordExplanation: request.WordExplanation,
	}, database.WordNoteSource{
		ArticleID:    article.ID,
		CaixinID:     article.CaixinID,
		SelectedText: request.SelectedText,
		PrefixText:   request.PrefixText,
		SuffixText:   request.SuffixText,
		StartOffset:  request.StartOffset,
		EndOffset:    request.EndOffset,
	})
	if err != nil {
		s.logger.Error("save article word note failed", "error", err, "caixin_id", article.CaixinID, "word_name", request.WordName)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"detail": detail,
	})
}

func (s *Server) loadArticleByPathCaixinID(w http.ResponseWriter, r *http.Request, logAction string) (database.Article, bool) {
	caixinID := strings.TrimSpace(r.PathValue("caixinID"))
	if caixinID == "" {
		writeError(w, http.StatusBadRequest, "caixin_id is required")
		return database.Article{}, false
	}

	article, err := s.articles.FindByCaixinID(r.Context(), caixinID)
	if err != nil {
		if errors.Is(err, database.ErrArticleNotFound) {
			writeError(w, http.StatusNotFound, "article not found")
			return database.Article{}, false
		}
		s.logger.Error(logAction+" failed to load article", "error", err, "caixin_id", caixinID)
		writeError(w, http.StatusInternalServerError, err.Error())
		return database.Article{}, false
	}

	return article, true
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

		s.logger.Log(r.Context(), level, requestLogMessage(r, recorder, time.Since(startedAt)))
	})
}

func requestLogMessage(r *http.Request, recorder *statusRecorder, duration time.Duration) string {
	target := r.URL.Path
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	return fmt.Sprintf("%s %s -> %d (%dms, %dB) from %s", r.Method, target, recorder.status, duration.Milliseconds(), recorder.bytes, r.RemoteAddr)
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

func parseOptionalUintQuery(r *http.Request, name string) (uint64, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return 0, nil
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, err
	}
	return parsed, nil
}

func parsePathUint(w http.ResponseWriter, value string, message string) (uint64, bool) {
	id, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	if err != nil || id == 0 {
		writeError(w, http.StatusBadRequest, message)
		return 0, false
	}
	return id, true
}

func parseIntQuery(r *http.Request, name string, fallback int) (int, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return fallback, nil
	}
	return strconv.Atoi(value)
}

func validateWordNote(wordName string, wordExplanation string) error {
	if wordName == "" {
		return errors.New("word_name is required")
	}
	if len([]rune(wordName)) > 255 {
		return errors.New("word_name is too long")
	}
	if len([]rune(wordExplanation)) > 12000 {
		return errors.New("word_explanation is too long")
	}
	return nil
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
