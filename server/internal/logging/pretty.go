package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"
)

type PrettyHandler struct {
	out    io.Writer
	opts   slog.HandlerOptions
	attrs  []slog.Attr
	groups []string
	mu     *sync.Mutex
}

func NewPrettyHandler(out io.Writer, opts *slog.HandlerOptions) *PrettyHandler {
	handlerOptions := slog.HandlerOptions{}
	if opts != nil {
		handlerOptions = *opts
	}
	return &PrettyHandler{
		out:  out,
		opts: handlerOptions,
		mu:   &sync.Mutex{},
	}
}

func (h *PrettyHandler) Enabled(_ context.Context, level slog.Level) bool {
	minLevel := slog.LevelInfo
	if h.opts.Level != nil {
		minLevel = h.opts.Level.Level()
	}
	return level >= minLevel
}

func (h *PrettyHandler) Handle(_ context.Context, record slog.Record) error {
	fields := make([]string, 0, len(h.attrs)+record.NumAttrs())
	for _, attr := range h.attrs {
		appendAttr(&fields, attr)
	}
	record.Attrs(func(attr slog.Attr) bool {
		appendAttr(&fields, attr)
		return true
	})

	line := fmt.Sprintf("%s %-5s %s", record.Time.Format("15:04:05"), levelLabel(record.Level), record.Message)
	if len(fields) > 0 {
		line += " | " + strings.Join(fields, ", ")
	}
	line += "\n"

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := io.WriteString(h.out, line)
	return err
}

func (h *PrettyHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := *h
	next.attrs = append(append([]slog.Attr{}, h.attrs...), attrs...)
	return &next
}

func (h *PrettyHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	next := *h
	next.groups = append(append([]string{}, h.groups...), name)
	return &next
}

func appendAttr(fields *[]string, attr slog.Attr) {
	attr.Value = attr.Value.Resolve()
	if attr.Key == "" {
		return
	}
	if attr.Value.Kind() == slog.KindGroup {
		for _, groupAttr := range attr.Value.Group() {
			appendAttr(fields, slog.Attr{
				Key:   attr.Key + "." + groupAttr.Key,
				Value: groupAttr.Value,
			})
		}
		return
	}
	*fields = append(*fields, fmt.Sprintf("%s: %s", attr.Key, formatValue(attr.Value)))
}

func formatValue(value slog.Value) string {
	switch value.Kind() {
	case slog.KindString:
		return value.String()
	case slog.KindTime:
		return value.Time().Format(time.RFC3339)
	case slog.KindDuration:
		return value.Duration().String()
	default:
		return value.String()
	}
}

func levelLabel(level slog.Level) string {
	switch {
	case level >= slog.LevelError:
		return "ERROR"
	case level >= slog.LevelWarn:
		return "WARN"
	case level >= slog.LevelInfo:
		return "INFO"
	default:
		return "DEBUG"
	}
}
