package api

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
)

// CreateAPIKey handles POST /api/v1/apikeys
func (h *Handlers) CreateAPIKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.apiKeyStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "api key store not available", nil)
		return
	}

	var req struct {
		Name   string   `json:"name"`
		Scopes []string `json:"scopes,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	if req.Name == "" {
		h.respondError(w, r, http.StatusBadRequest, "name is required", nil)
		return
	}

	owner := getOwnerFromRequest(r)
	if owner == "" {
		owner = "anonymous"
	}

	plaintext, key, err := h.apiKeyStore.GenerateKey(ctx, req.Name, owner, req.Scopes)
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to generate api key", err)
		return
	}

	h.respondJSON(w, http.StatusCreated, map[string]interface{}{
		"id":         key.ID,
		"name":       key.Name,
		"owner":      key.Owner,
		"key":        plaintext, // Only returned once
		"scopes":     key.Scopes,
		"created_at": key.CreatedAt,
	})
}

// ListAPIKeys handles GET /api/v1/apikeys
func (h *Handlers) ListAPIKeys(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.apiKeyStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "api key store not available", nil)
		return
	}

	owner := r.URL.Query().Get("owner")

	keys, err := h.apiKeyStore.ListKeys(ctx, owner)
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to list api keys", err)
		return
	}

	// Strip key_hash from response
	type safeKey struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		Owner     string   `json:"owner"`
		Scopes    []string `json:"scopes,omitempty"`
		CreatedAt string   `json:"created_at"`
		LastUsed  string   `json:"last_used,omitempty"`
	}

	safe := make([]safeKey, 0, len(keys))
	for _, k := range keys {
		sk := safeKey{
			ID:        k.ID,
			Name:      k.Name,
			Owner:     k.Owner,
			Scopes:    k.Scopes,
			CreatedAt: k.CreatedAt.Format("2006-01-02T15:04:05Z"),
		}
		if !k.LastUsed.IsZero() {
			sk.LastUsed = k.LastUsed.Format("2006-01-02T15:04:05Z")
		}
		safe = append(safe, sk)
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"api_keys": safe,
		"count":    len(safe),
	})
}

// RevokeAPIKey handles DELETE /api/v1/apikeys/{id}
func (h *Handlers) RevokeAPIKey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.apiKeyStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "api key store not available", nil)
		return
	}

	vars := mux.Vars(r)
	keyID := vars["id"]

	// Look up the full hash by listing and matching the ID prefix
	keys, err := h.apiKeyStore.ListKeys(ctx, "")
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to list api keys", err)
		return
	}

	var keyHash string
	for _, k := range keys {
		if k.ID == keyID {
			keyHash = k.KeyHash
			break
		}
	}

	if keyHash == "" {
		h.respondError(w, r, http.StatusNotFound, "api key not found", nil)
		return
	}

	if err := h.apiKeyStore.RevokeKey(ctx, keyHash); err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to revoke api key", err)
		return
	}

	h.respondJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}
