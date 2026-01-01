package middleware

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/flexinfer/mentatlab/services/gateway-go/metrics"
)

// LoggingMiddleware logs request details with request ID and records metrics.
type LoggingMiddleware struct {
	logger    *slog.Logger
	skipPaths map[string]bool
}

// LoggingConfig holds logging middleware configuration.
type LoggingConfig struct {
	// SkipPaths are paths that should not be logged (e.g., health checks)
	SkipPaths []string
}

// NewLoggingMiddleware creates a new logging middleware.
func NewLoggingMiddleware(cfg *LoggingConfig, logger *slog.Logger) *LoggingMiddleware {
	if logger == nil {
		logger = slog.Default()
	}
	if cfg == nil {
		cfg = &LoggingConfig{}
	}

	skipPaths := make(map[string]bool)
	for _, p := range cfg.SkipPaths {
		skipPaths[p] = true
	}

	return &LoggingMiddleware{
		logger:    logger,
		skipPaths: skipPaths,
	}
}

// Middleware returns the HTTP middleware handler.
func (l *LoggingMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Generate or extract request ID
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}
		w.Header().Set("X-Request-ID", requestID)

		// Wrap response writer to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(wrapped, r)

		duration := time.Since(start)

		// Check if path should be skipped
		shouldSkip := l.skipPaths[r.URL.Path]
		for skipPath := range l.skipPaths {
			if strings.HasPrefix(r.URL.Path, skipPath) {
				shouldSkip = true
				break
			}
		}

		// Record metrics
		if !shouldSkip {
			metricPath := normalizePath(r.URL.Path)
			statusStr := strconv.Itoa(wrapped.statusCode)

			metrics.HTTPRequestsTotal.WithLabelValues(r.Method, metricPath, statusStr).Inc()
			metrics.HTTPRequestDuration.WithLabelValues(r.Method, metricPath).Observe(duration.Seconds())
		}

		// Log request (skip health checks to reduce noise)
		if !shouldSkip {
			l.logger.Info("request",
				slog.String("request_id", requestID),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", wrapped.statusCode),
				slog.Duration("duration", duration),
				slog.String("remote_addr", r.RemoteAddr),
				slog.String("user_agent", r.UserAgent()),
			)
		}
	})
}

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// normalizePath replaces dynamic path segments (UUIDs, IDs) with placeholders for metrics.
func normalizePath(path string) string {
	parts := strings.Split(path, "/")
	for i, part := range parts {
		// Replace UUIDs and numeric IDs with placeholders
		if len(part) == 36 && strings.Count(part, "-") == 4 {
			parts[i] = "{id}"
		} else if _, err := strconv.Atoi(part); err == nil && len(part) > 0 {
			parts[i] = "{id}"
		}
	}
	return strings.Join(parts, "/")
}
