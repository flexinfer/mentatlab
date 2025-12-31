package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecurityMiddleware(t *testing.T) {
	sm := NewSecurityMiddleware(&SecurityConfig{
		AllowedOrigins: []string{"https://example.com", "https://app.example.com"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
		FrameOptions:   "DENY",
		HSTSMaxAge:     31536000,
		ReferrerPolicy: "strict-origin-when-cross-origin",
	})

	handler := sm.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))

	t.Run("sets X-Frame-Options", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Header().Get("X-Frame-Options") != "DENY" {
			t.Errorf("expected X-Frame-Options DENY, got %q", rr.Header().Get("X-Frame-Options"))
		}
	})

	t.Run("sets X-Content-Type-Options", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("expected X-Content-Type-Options nosniff, got %q", rr.Header().Get("X-Content-Type-Options"))
		}
	})

	t.Run("sets X-XSS-Protection", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Header().Get("X-XSS-Protection") != "1; mode=block" {
			t.Errorf("expected X-XSS-Protection, got %q", rr.Header().Get("X-XSS-Protection"))
		}
	})

	t.Run("sets Strict-Transport-Security", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		expected := "max-age=31536000; includeSubDomains"
		if rr.Header().Get("Strict-Transport-Security") != expected {
			t.Errorf("expected HSTS %q, got %q", expected, rr.Header().Get("Strict-Transport-Security"))
		}
	})

	t.Run("sets Referrer-Policy", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Header().Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
			t.Errorf("expected Referrer-Policy, got %q", rr.Header().Get("Referrer-Policy"))
		}
	})
}

func TestCORSMiddleware(t *testing.T) {
	sm := NewSecurityMiddleware(&SecurityConfig{
		AllowedOrigins: []string{"https://example.com", "https://app.example.com"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE"},
		AllowedHeaders: []string{"Content-Type", "Authorization", "X-Request-ID"},
	})

	handler := sm.CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))

	t.Run("handles preflight OPTIONS", func(t *testing.T) {
		req := httptest.NewRequest("OPTIONS", "/api/test", nil)
		req.Header.Set("Origin", "https://example.com")
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "Content-Type")

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusNoContent {
			t.Errorf("expected 204 for preflight, got %d", rr.Code)
		}

		if rr.Header().Get("Access-Control-Allow-Origin") != "https://example.com" {
			t.Errorf("expected CORS origin header, got %q", rr.Header().Get("Access-Control-Allow-Origin"))
		}

		if rr.Header().Get("Access-Control-Allow-Methods") == "" {
			t.Error("expected Access-Control-Allow-Methods header")
		}
	})

	t.Run("allows valid origin", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("Origin", "https://example.com")

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Header().Get("Access-Control-Allow-Origin") != "https://example.com" {
			t.Errorf("expected origin header for valid origin, got %q", rr.Header().Get("Access-Control-Allow-Origin"))
		}
	})

	t.Run("rejects invalid origin", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("Origin", "https://evil.com")

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Error("should not set CORS header for invalid origin")
		}
	})

	t.Run("handles no origin header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		// Should succeed without CORS headers
		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("sets Vary header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("Origin", "https://example.com")

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Header().Get("Vary") != "Origin" {
			t.Errorf("expected Vary: Origin header, got %q", rr.Header().Get("Vary"))
		}
	})

	t.Run("includes credentials when configured", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("Origin", "https://example.com")

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Header().Get("Access-Control-Allow-Credentials") != "true" {
			t.Errorf("expected credentials header, got %q", rr.Header().Get("Access-Control-Allow-Credentials"))
		}
	})
}

func TestCORSWildcardOrigin(t *testing.T) {
	sm := NewSecurityMiddleware(&SecurityConfig{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST"},
		AllowedHeaders: []string{"Content-Type"},
	})

	handler := sm.CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	t.Run("allows any origin with wildcard", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("Origin", "https://any-domain.com")

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		// With wildcard, should reflect the requesting origin
		origin := rr.Header().Get("Access-Control-Allow-Origin")
		if origin != "https://any-domain.com" && origin != "*" {
			t.Errorf("expected wildcard to allow origin, got %q", origin)
		}
	})
}

func TestSecurityMiddlewareDefaultConfig(t *testing.T) {
	sm := NewSecurityMiddleware(nil)

	handler := sm.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	// Should still set security headers with defaults
	if rr.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("should set default security headers")
	}
}

func TestSecurityMiddlewareChain(t *testing.T) {
	sm := NewSecurityMiddleware(&SecurityConfig{
		AllowedOrigins: []string{"https://example.com"},
		AllowedMethods: []string{"GET", "POST"},
		AllowedHeaders: []string{"Content-Type"},
		FrameOptions:   "SAMEORIGIN",
		HSTSMaxAge:     86400,
	})

	// Chain both middlewares
	handler := sm.Middleware(sm.CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})))

	t.Run("applies both security and CORS", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("Origin", "https://example.com")

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		// Security headers
		if rr.Header().Get("X-Frame-Options") != "SAMEORIGIN" {
			t.Error("missing security headers")
		}

		// CORS headers
		if rr.Header().Get("Access-Control-Allow-Origin") != "https://example.com" {
			t.Error("missing CORS headers")
		}
	})
}
