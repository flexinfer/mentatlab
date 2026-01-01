package middleware

import (
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// TracingMiddleware wraps handlers with OpenTelemetry tracing.
type TracingMiddleware struct {
	enabled bool
}

// TracingConfig holds tracing middleware configuration.
type TracingConfig struct {
	// Enabled controls whether tracing middleware is active
	Enabled bool
}

// NewTracingMiddleware creates a new tracing middleware.
func NewTracingMiddleware(cfg *TracingConfig) *TracingMiddleware {
	if cfg == nil {
		cfg = &TracingConfig{}
	}
	return &TracingMiddleware{
		enabled: cfg.Enabled,
	}
}

// Middleware returns the HTTP middleware handler.
func (t *TracingMiddleware) Middleware(next http.Handler) http.Handler {
	if !t.enabled {
		return next
	}

	// Use otelhttp to automatically instrument HTTP handlers
	return otelhttp.NewHandler(next, "gateway",
		otelhttp.WithMessageEvents(otelhttp.ReadEvents, otelhttp.WriteEvents),
	)
}
