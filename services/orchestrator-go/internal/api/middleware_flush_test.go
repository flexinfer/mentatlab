package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// responseWriter must satisfy http.Flusher, otherwise the SSE handler's
// w.(http.Flusher) assertion fails and /events returns 500
// "streaming not supported" (this middleware wraps every API request).
var _ http.Flusher = (*responseWriter)(nil)

func TestResponseWriterFlushForwards(t *testing.T) {
	rec := httptest.NewRecorder()
	rw := &responseWriter{ResponseWriter: rec, statusCode: http.StatusOK}

	f, ok := interface{}(rw).(http.Flusher)
	if !ok {
		t.Fatal("responseWriter does not implement http.Flusher")
	}
	f.Flush()

	if !rec.Flushed {
		t.Fatal("Flush did not forward to the underlying ResponseWriter")
	}
}
