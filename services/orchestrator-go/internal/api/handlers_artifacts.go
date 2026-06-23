package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/dataflow"
)

// --- Artifact Management ---

// ListRunArtifacts handles GET /api/v1/runs/{id}/artifacts
func (h *Handlers) ListRunArtifacts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	runID := vars["id"]

	if h.dataflowSvc == nil {
		h.respondError(w, r,http.StatusServiceUnavailable, "artifact storage not available", errors.New("dataflow service not configured"))
		return
	}

	artifacts, err := h.dataflowSvc.ListRunArtifacts(ctx, runID)
	if err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "failed to list artifacts", err)
		return
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"run_id":    runID,
		"artifacts": artifacts,
		"count":     len(artifacts),
	})
}

// UploadArtifactRequest is the request for getting an upload URL.
type UploadArtifactRequest struct {
	Name        string `json:"name"`
	ContentType string `json:"content_type,omitempty"`
	NodeID      string `json:"node_id,omitempty"`
}

// UploadArtifact handles POST /api/v1/runs/{id}/artifacts
// Supports two modes:
// 1. Direct upload: multipart/form-data with file
// 2. Presigned URL: JSON body with name/content_type returns upload URL
func (h *Handlers) UploadArtifact(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	runID := vars["id"]

	if h.dataflowSvc == nil {
		h.respondError(w, r,http.StatusServiceUnavailable, "artifact storage not available", errors.New("dataflow service not configured"))
		return
	}

	contentType := r.Header.Get("Content-Type")

	// Check if this is a multipart upload or JSON request for presigned URL
	if strings.HasPrefix(contentType, "multipart/form-data") {
		h.handleDirectUpload(w, r, runID)
		return
	}

	// JSON request for presigned URL
	var req UploadArtifactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r,http.StatusBadRequest, "invalid request body", err)
		return
	}

	if req.Name == "" {
		h.respondError(w, r,http.StatusBadRequest, "name is required", errors.New("missing name"))
		return
	}

	nodeID := req.NodeID
	if nodeID == "" {
		nodeID = "default"
	}

	uploadURL, err := h.dataflowSvc.GetUploadURL(ctx, runID, nodeID, req.Name, req.ContentType, 15*time.Minute)
	if err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "failed to generate upload URL", err)
		return
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"upload_url": uploadURL,
		"expires_in": "15m",
		"path":       h.dataflowSvc.GenerateArtifactPath(runID, nodeID, req.Name),
	})
}

// handleDirectUpload handles multipart file upload.
func (h *Handlers) handleDirectUpload(w http.ResponseWriter, r *http.Request, runID string) {
	ctx := r.Context()

	// Parse multipart form (max 100MB)
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		h.respondError(w, r,http.StatusBadRequest, "failed to parse multipart form", err)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		h.respondError(w, r,http.StatusBadRequest, "file is required", err)
		return
	}
	defer file.Close()

	nodeID := r.FormValue("node_id")
	if nodeID == "" {
		nodeID = "default"
	}

	name := r.FormValue("name")
	if name == "" {
		name = header.Filename
	}

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	ref, err := h.dataflowSvc.StoreArtifact(ctx, runID, nodeID, name, file, contentType)
	if err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "failed to store artifact", err)
		return
	}

	h.logger.Info("artifact uploaded",
		slog.String("run_id", runID),
		slog.String("uri", ref.URI),
		slog.Int64("size", ref.Size),
	)

	h.respondJSON(w, http.StatusCreated, ref)
}

// GetArtifactDownloadURL handles POST /api/v1/artifacts/download-url
func (h *Handlers) GetArtifactDownloadURL(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.dataflowSvc == nil {
		h.respondError(w, r,http.StatusServiceUnavailable, "artifact storage not available", errors.New("dataflow service not configured"))
		return
	}

	var req struct {
		URI string `json:"uri"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r,http.StatusBadRequest, "invalid request body", err)
		return
	}

	if req.URI == "" {
		h.respondError(w, r,http.StatusBadRequest, "uri is required", errors.New("missing uri"))
		return
	}

	ref := &dataflow.ArtifactRef{URI: req.URI}
	downloadURL, err := h.dataflowSvc.GetDownloadURL(ctx, ref, 15*time.Minute)
	if err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "failed to generate download URL", err)
		return
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"download_url": downloadURL,
		"expires_in":   "15m",
	})
}

// GetArtifact handles GET /api/v1/artifacts - streams artifact content directly
func (h *Handlers) GetArtifact(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.dataflowSvc == nil {
		h.respondError(w, r,http.StatusServiceUnavailable, "artifact storage not available", errors.New("dataflow service not configured"))
		return
	}

	uri := r.URL.Query().Get("uri")
	if uri == "" {
		h.respondError(w, r,http.StatusBadRequest, "uri query parameter is required", errors.New("missing uri"))
		return
	}

	ref := &dataflow.ArtifactRef{URI: uri}
	reader, err := h.dataflowSvc.GetArtifact(ctx, ref)
	if err != nil {
		h.respondError(w, r,http.StatusNotFound, "artifact not found", err)
		return
	}
	defer reader.Close()

	// Set content type if known
	if ref.ContentType != "" {
		w.Header().Set("Content-Type", ref.ContentType)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}

	// Stream the content
	if _, err := io.Copy(w, reader); err != nil {
		h.logger.Error("failed to stream artifact", slog.String("uri", uri), slog.String("error", err.Error()))
	}
}

// DeleteArtifact handles DELETE /api/v1/artifacts
func (h *Handlers) DeleteArtifact(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if h.dataflowSvc == nil {
		h.respondError(w, r,http.StatusServiceUnavailable, "artifact storage not available", errors.New("dataflow service not configured"))
		return
	}

	uri := r.URL.Query().Get("uri")
	if uri == "" {
		h.respondError(w, r,http.StatusBadRequest, "uri query parameter is required", errors.New("missing uri"))
		return
	}

	ref := &dataflow.ArtifactRef{URI: uri}
	if err := h.dataflowSvc.DeleteArtifact(ctx, ref); err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "failed to delete artifact", err)
		return
	}

	h.logger.Info("artifact deleted", slog.String("uri", uri))
	w.WriteHeader(http.StatusNoContent)
}
