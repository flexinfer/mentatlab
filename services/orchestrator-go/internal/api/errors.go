package api

import (
	"context"
	"encoding/json"
	"net/http"
)

// Error codes for consistent error identification.
const (
	ErrCodeAuthRequired   = "auth_required"
	ErrCodeInvalidToken   = "invalid_token"
	ErrCodeForbidden      = "forbidden"
	ErrCodeNotFound       = "not_found"
	ErrCodeRateLimited    = "rate_limited"
	ErrCodeBadRequest     = "bad_request"
	ErrCodeConflict       = "conflict"
	ErrCodeInternalError  = "internal_error"
	ErrCodeServiceUnavail = "service_unavailable"
)

// ErrorResponse is the standard error response format.
type ErrorResponse struct {
	Error     string                 `json:"error"`                // Short error code
	Message   string                 `json:"message"`              // Human-readable message
	Details   map[string]interface{} `json:"details,omitempty"`    // Optional additional details
	RequestID string                 `json:"request_id,omitempty"` // Request ID for correlation
}

// requestIDContextKey is the context key for request ID.
type requestIDContextKey struct{}

// RequestIDKey is the exported context key for request ID.
var RequestIDKey = requestIDContextKey{}

// GetRequestID retrieves the request ID from context or request header.
func GetRequestID(ctx context.Context, r *http.Request) string {
	// Try context first
	if id, ok := ctx.Value(RequestIDKey).(string); ok && id != "" {
		return id
	}
	// Fall back to request header (set by gateway)
	return r.Header.Get("X-Request-ID")
}

// HTTPStatusToErrorCode maps HTTP status codes to error codes.
func HTTPStatusToErrorCode(status int) string {
	switch status {
	case http.StatusUnauthorized:
		return ErrCodeAuthRequired
	case http.StatusForbidden:
		return ErrCodeForbidden
	case http.StatusNotFound:
		return ErrCodeNotFound
	case http.StatusTooManyRequests:
		return ErrCodeRateLimited
	case http.StatusBadRequest:
		return ErrCodeBadRequest
	case http.StatusConflict:
		return ErrCodeConflict
	case http.StatusServiceUnavailable:
		return ErrCodeServiceUnavail
	default:
		return ErrCodeInternalError
	}
}

// writeErrorResponse writes a standardized JSON error response.
func writeErrorResponse(w http.ResponseWriter, r *http.Request, status int, code string, message string, details map[string]interface{}) {
	requestID := GetRequestID(r.Context(), r)

	resp := ErrorResponse{
		Error:     code,
		Message:   message,
		Details:   details,
		RequestID: requestID,
	}

	// Set request ID in response header for correlation
	if requestID != "" {
		w.Header().Set("X-Request-ID", requestID)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(resp)
}
