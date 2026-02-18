package scheduler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// CallbackPayload is the JSON body POSTed to webhook URLs on run completion.
type CallbackPayload struct {
	RunID      string          `json:"run_id"`
	Name       string          `json:"name,omitempty"`
	Owner      string          `json:"owner,omitempty"`
	Status     types.RunStatus `json:"status"`
	FinishedAt string          `json:"finished_at"`
	Error      string          `json:"error,omitempty"`
}

// fireWebhookCallback sends a POST to the run's webhook URL if configured.
// Called asynchronously after checkRunCompletion marks a run as terminal.
func (s *Scheduler) fireWebhookCallback(ctx context.Context, runID string) {
	_, span := tracer.Start(ctx, "scheduler.fireWebhookCallback",
		trace.WithAttributes(attribute.String("run_id", runID)),
	)
	defer span.End()

	run, err := s.store.GetRun(ctx, runID)
	if err != nil || run.WebhookURL == "" {
		span.SetAttributes(attribute.Bool("webhook_configured", false))
		return
	}
	span.SetAttributes(
		attribute.Bool("webhook_configured", true),
		attribute.String("webhook_url", run.WebhookURL),
	)

	payload := CallbackPayload{
		RunID:  run.ID,
		Name:   run.Name,
		Owner:  run.Owner,
		Status: run.Status,
		Error:  run.Error,
	}
	if run.FinishedAt != nil {
		payload.FinishedAt = run.FinishedAt.Format(time.RFC3339)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		s.logger.Error("webhook: failed to marshal payload", slog.String("run_id", runID), slog.Any("error", err))
		return
	}

	// Fire with retries in a goroutine
	go s.deliverWebhook(run.WebhookURL, run.WebhookSecret, body, runID)
}

// deliverWebhook sends the webhook with up to 3 retries and exponential backoff.
func (s *Scheduler) deliverWebhook(url, secret string, body []byte, runID string) {
	_, span := tracer.Start(context.Background(), "scheduler.deliverWebhook",
		trace.WithAttributes(
			attribute.String("run_id", runID),
			attribute.String("webhook_url", url),
		),
	)
	defer span.End()

	client := &http.Client{Timeout: 10 * time.Second}
	maxRetries := 3
	backoff := 2 * time.Second

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(backoff)
			backoff *= 2
		}

		req, err := http.NewRequest("POST", url, bytes.NewReader(body))
		if err != nil {
			s.logger.Error("webhook: failed to create request",
				slog.String("run_id", runID),
				slog.String("url", url),
				slog.Any("error", err),
			)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "MentatLab-Orchestrator/1.0")
		req.Header.Set("X-MentatLab-Event", "run.completed")

		// Sign with HMAC-SHA256 if secret is provided
		if secret != "" {
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write(body)
			sig := hex.EncodeToString(mac.Sum(nil))
			req.Header.Set("X-MentatLab-Signature", fmt.Sprintf("sha256=%s", sig))
		}

		resp, err := client.Do(req)
		if err != nil {
			s.logger.Warn("webhook: delivery failed",
				slog.String("run_id", runID),
				slog.Int("attempt", attempt+1),
				slog.Any("error", err),
			)
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			span.SetAttributes(
				attribute.Int("attempts", attempt+1),
				attribute.Int("status_code", resp.StatusCode),
			)
			s.logger.Info("webhook: delivered",
				slog.String("run_id", runID),
				slog.String("url", url),
				slog.Int("status", resp.StatusCode),
			)
			return
		}

		s.logger.Warn("webhook: non-2xx response",
			slog.String("run_id", runID),
			slog.Int("attempt", attempt+1),
			slog.Int("status", resp.StatusCode),
		)
	}

	span.SetAttributes(
		attribute.Int("attempts", maxRetries+1),
		attribute.Bool("delivery_failed", true),
	)
	s.logger.Error("webhook: delivery failed after retries",
		slog.String("run_id", runID),
		slog.String("url", url),
		slog.Int("max_retries", maxRetries),
	)
}
