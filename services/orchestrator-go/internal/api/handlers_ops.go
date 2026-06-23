package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gorilla/mux"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// --- Job Management ---

// GetJobStatus handles GET /api/v1/jobs/{id}/status
func (h *Handlers) GetJobStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	jobID := vars["id"]

	if h.k8sClient == nil {
		// No K8s client - return unknown status
		h.respondJSON(w, http.StatusOK, map[string]interface{}{
			"job_id": jobID,
			"status": "unknown",
			"error":  "k8s client not configured",
		})
		return
	}

	job, err := h.k8sClient.GetJob(ctx, jobID)
	if err != nil {
		h.respondError(w, r,http.StatusNotFound, "job not found", err)
		return
	}

	// Determine job status from K8s job conditions
	status := "unknown"
	var startTime, completionTime *string

	if job.Status.StartTime != nil {
		t := job.Status.StartTime.Format(time.RFC3339)
		startTime = &t
	}
	if job.Status.CompletionTime != nil {
		t := job.Status.CompletionTime.Format(time.RFC3339)
		completionTime = &t
	}

	if job.Status.Succeeded > 0 {
		status = "succeeded"
	} else if job.Status.Failed > 0 {
		status = "failed"
	} else if job.Status.Active > 0 {
		status = "running"
	} else {
		status = "pending"
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"job_id":          jobID,
		"status":          status,
		"active":          job.Status.Active,
		"succeeded":       job.Status.Succeeded,
		"failed":          job.Status.Failed,
		"start_time":      startTime,
		"completion_time": completionTime,
	})
}

// DeleteJob handles DELETE /api/v1/jobs/{id}
func (h *Handlers) DeleteJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	jobID := vars["id"]

	if h.k8sClient == nil {
		h.respondError(w, r,http.StatusServiceUnavailable, "k8s client not available", errors.New("k8s client not configured"))
		return
	}

	if err := h.k8sClient.DeleteJob(ctx, jobID); err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "failed to delete job", err)
		return
	}

	h.logger.Info("job deleted", "job_id", jobID)
	w.WriteHeader(http.StatusNoContent)
}

// --- RunStore Diagnostics ---

// RunStoreInfo handles GET /api/v1/runstore/info
func (h *Handlers) RunStoreInfo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	info, err := h.store.AdapterInfo(ctx)
	if err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "failed to get runstore info", err)
		return
	}

	h.respondJSON(w, http.StatusOK, info)
}

// RunStoreSelfCheck handles GET /api/v1/runstore/selfcheck
func (h *Handlers) RunStoreSelfCheck(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Simple self-check: create a run, append event, read it back, delete it
	start := time.Now()

	runID, err := h.store.CreateRun(ctx, "_selfcheck", nil, "")
	if err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "selfcheck failed: create", err)
		return
	}

	_, err = h.store.AppendEvent(ctx, runID, &types.EventInput{
		Type: types.EventTypeLog,
		Data: map[string]string{"message": "selfcheck"},
	})
	if err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "selfcheck failed: append", err)
		return
	}

	events, err := h.store.GetEventsSince(ctx, runID, "")
	if err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "selfcheck failed: read", err)
		return
	}

	if err := h.store.CancelRun(ctx, runID); err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "selfcheck failed: cleanup", err)
		return
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "ok",
		"latency_ms":  time.Since(start).Milliseconds(),
		"event_count": len(events),
	})
}
