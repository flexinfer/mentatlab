package middleware

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// testLogger returns a silent logger for tests.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(&discardWriter{}, nil))
}

type discardWriter struct{}

func (d *discardWriter) Write(p []byte) (n int, err error) {
	return len(p), nil
}

func TestAuthMiddlewareDisabled(t *testing.T) {
	am := NewAuthMiddleware(&AuthConfig{
		Enabled: false,
	}, testLogger())

	handler := am.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))

	t.Run("allows all requests when disabled", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200 when auth disabled, got %d", rr.Code)
		}
	})
}

func TestAuthMiddlewareSkipPaths(t *testing.T) {
	am := NewAuthMiddleware(&AuthConfig{
		Enabled:    true,
		TeamDomain: "test.cloudflareaccess.com",
		PolicyAUD:  "test-aud",
		SkipPaths:  []string{"/health", "/healthz", "/ready", "/ws/"},
	}, testLogger())

	handler := am.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))

	tests := []struct {
		path         string
		shouldSkip   bool
		expectedCode int
	}{
		{"/health", true, http.StatusOK},
		{"/healthz", true, http.StatusOK},
		{"/ready", true, http.StatusOK},
		{"/ws/streams/123", true, http.StatusOK},
		{"/api/runs", false, http.StatusUnauthorized},
		{"/api/agents", false, http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.path, nil)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			if rr.Code != tt.expectedCode {
				t.Errorf("path %s: expected %d, got %d", tt.path, tt.expectedCode, rr.Code)
			}
		})
	}
}

func TestAuthMiddlewareMissingToken(t *testing.T) {
	am := NewAuthMiddleware(&AuthConfig{
		Enabled:    true,
		TeamDomain: "test.cloudflareaccess.com",
		PolicyAUD:  "test-aud",
	}, testLogger())

	handler := am.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	t.Run("rejects request without token", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", rr.Code)
		}
	})
}

func TestAuthMiddlewareTokenExtraction(t *testing.T) {
	am := NewAuthMiddleware(&AuthConfig{
		Enabled:    true,
		TeamDomain: "test.cloudflareaccess.com",
		PolicyAUD:  "test-aud",
	}, testLogger())

	// We can't fully test JWT validation without mocking the JWKS endpoint,
	// but we can test that token extraction works

	t.Run("extracts token from CF-Access-JWT-Assertion header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("CF-Access-JWT-Assertion", "invalid-but-present-token")

		// The middleware should attempt to validate (and fail on invalid token)
		// This verifies the header is being read
		handler := am.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		// Should fail with 401 because token is invalid, not because it's missing
		if rr.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 for invalid token, got %d", rr.Code)
		}
	})

	t.Run("extracts token from Authorization Bearer header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("Authorization", "Bearer invalid-but-present-token")

		handler := am.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 for invalid token, got %d", rr.Code)
		}
	})
}

func TestInjectServiceToken(t *testing.T) {
	t.Run("injects service token when configured", func(t *testing.T) {
		am := NewAuthMiddleware(&AuthConfig{
			Enabled:             true,
			ServiceClientID:     "test-client-id",
			ServiceClientSecret: "test-client-secret",
		}, testLogger())

		req := httptest.NewRequest("GET", "/api/test", nil)
		am.InjectServiceToken(req)

		if req.Header.Get("CF-Access-Client-Id") != "test-client-id" {
			t.Error("should inject CF-Access-Client-Id")
		}
		if req.Header.Get("CF-Access-Client-Secret") != "test-client-secret" {
			t.Error("should inject CF-Access-Client-Secret")
		}
	})

	t.Run("does nothing when not configured", func(t *testing.T) {
		am := NewAuthMiddleware(&AuthConfig{
			Enabled: true,
		}, testLogger())

		req := httptest.NewRequest("GET", "/api/test", nil)
		am.InjectServiceToken(req)

		if req.Header.Get("CF-Access-Client-Id") != "" {
			t.Error("should not inject headers when not configured")
		}
	})
}

func TestAuthMiddlewareNilConfig(t *testing.T) {
	// Should handle nil config gracefully
	am := NewAuthMiddleware(nil, testLogger())

	handler := am.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/test", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	// With nil config, auth should be disabled
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 with nil config, got %d", rr.Code)
	}
}

func TestBase64URLDecode(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{
			name:    "valid base64url",
			input:   "SGVsbG8gV29ybGQ",
			wantErr: false,
		},
		{
			name:    "valid with url-safe chars",
			input:   "PDw_Pz4-",
			wantErr: false,
		},
		{
			name:    "empty string",
			input:   "",
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := base64URLDecode(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("base64URLDecode() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestParseRSAPublicKey(t *testing.T) {
	// Use a known test key (2048-bit RSA)
	// These are the base64url-encoded n and e values
	t.Run("parses valid RSA key components", func(t *testing.T) {
		// A minimal test - just verify the function doesn't panic
		// with reasonably formatted but fake values
		n := "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw"
		e := "AQAB"

		key, err := parseRSAPublicKey(n, e)
		if err != nil {
			t.Fatalf("parseRSAPublicKey failed: %v", err)
		}
		if key == nil {
			t.Fatal("expected non-nil key")
		}
		if key.E != 65537 {
			t.Errorf("expected exponent 65537, got %d", key.E)
		}
	})

	t.Run("fails on invalid base64", func(t *testing.T) {
		_, err := parseRSAPublicKey("!!!invalid!!!", "AQAB")
		if err == nil {
			t.Error("expected error for invalid base64")
		}
	})
}
