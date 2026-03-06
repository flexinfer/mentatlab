package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"go.opentelemetry.io/otel/trace"
)

// AuditMiddleware logs authenticated API operations for compliance and security
// monitoring. It runs inside the /api/v1 subrouter, after auth middleware, so
// user identity is already resolved in request headers.
func (h *Handlers) AuditMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)

		duration := time.Since(start)

		// Only audit mutating operations and sensitive reads
		if !shouldAudit(r.Method, r.URL.Path) {
			return
		}

		// Build audit entry
		attrs := []any{
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("path_normalized", normalizePath(r.URL.Path)),
			slog.Int("status", wrapped.statusCode),
			slog.String("duration_ms", durationMs(duration)),
			slog.String("remote_addr", r.RemoteAddr),
		}

		// User identity
		if email := r.Header.Get("X-User-Email"); email != "" {
			attrs = append(attrs, slog.String("user_email", email))
		}
		attrs = append(attrs, slog.String("auth_method", detectAuthMethod(r)))

		// Request ID (set by LoggingMiddleware upstream)
		if id, ok := r.Context().Value(RequestIDKey).(string); ok {
			attrs = append(attrs, slog.String("request_id", id))
		}

		// Trace ID
		spanCtx := trace.SpanContextFromContext(r.Context())
		if spanCtx.HasTraceID() {
			attrs = append(attrs, slog.String("trace_id", spanCtx.TraceID().String()))
		}

		// Resource context from mux route vars
		vars := mux.Vars(r)
		if id := vars["id"]; id != "" {
			attrs = append(attrs, slog.String("resource_id", id))
		}
		attrs = append(attrs, slog.String("resource_type", inferResourceType(r.URL.Path)))

		h.logger.Info("audit", attrs...)
	})
}

// shouldAudit returns true for operations that should be audit-logged.
// All writes (POST/PUT/DELETE) are logged. Reads are logged for sensitive
// endpoints (apikeys, schedules, runstore diagnostics).
func shouldAudit(method, path string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodDelete:
		return true
	case http.MethodGet:
		// Audit reads on sensitive endpoints
		return strings.Contains(path, "/apikeys") ||
			strings.Contains(path, "/runstore/") ||
			strings.Contains(path, "/events")
	}
	return false
}

// detectAuthMethod inspects request headers to determine how the user authenticated.
func detectAuthMethod(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return "none"
	}
	if strings.HasPrefix(auth, "Bearer ") {
		return "oidc"
	}
	if strings.HasPrefix(auth, "mlk_") {
		return "apikey"
	}
	return "unknown"
}

// inferResourceType extracts the resource type from the URL path.
func inferResourceType(path string) string {
	// Strip /api/v1/ prefix and take the first segment
	trimmed := strings.TrimPrefix(path, "/api/v1/")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) > 0 && parts[0] != "" {
		return parts[0]
	}
	return "unknown"
}

// durationMs formats duration as milliseconds with 1 decimal place.
func durationMs(d time.Duration) string {
	return fmt.Sprintf("%.1f", float64(d.Nanoseconds())/1e6)
}
