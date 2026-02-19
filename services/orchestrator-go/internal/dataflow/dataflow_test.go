package dataflow

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

// --- Service construction tests ---

func TestNew_DefaultConfig(t *testing.T) {
	svc, err := New(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if svc == nil {
		t.Fatal("expected non-nil service")
	}
}

func TestNew_MemoryBackend(t *testing.T) {
	svc, err := New(&Config{Type: "memory"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if svc == nil {
		t.Fatal("expected non-nil service")
	}
}

func TestNew_UnknownBackend(t *testing.T) {
	_, err := New(&Config{Type: "unknown"})
	if err == nil {
		t.Fatal("expected error for unknown backend type")
	}
	if !strings.Contains(err.Error(), "unknown backend type") {
		t.Errorf("error: got %q, want to contain 'unknown backend type'", err.Error())
	}
}

func TestNew_S3MissingBucket(t *testing.T) {
	_, err := New(&Config{Type: "s3"})
	if err == nil {
		t.Fatal("expected error for s3 without bucket")
	}
}

func TestDefaultConfig_Values(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.Type != "memory" {
		t.Errorf("Type: got %q, want %q", cfg.Type, "memory")
	}
	if cfg.PathPrefix != "artifacts" {
		t.Errorf("PathPrefix: got %q, want %q", cfg.PathPrefix, "artifacts")
	}
}

// --- GenerateArtifactPath tests ---

func TestGenerateArtifactPath(t *testing.T) {
	svc, _ := New(nil)
	path := svc.GenerateArtifactPath("run1", "node1", "output.json")
	expected := "runs/run1/nodes/node1/output.json"
	if path != expected {
		t.Errorf("path: got %q, want %q", path, expected)
	}
}

// --- MemoryBackend CRUD tests ---

func TestMemoryBackend_PutAndGet(t *testing.T) {
	backend := NewMemoryBackend()
	ctx := context.Background()

	content := "hello world"
	ref, err := backend.Put(ctx, "test/file.txt", strings.NewReader(content), "text/plain")
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if ref.URI != "memory://test/file.txt" {
		t.Errorf("URI: got %q, want %q", ref.URI, "memory://test/file.txt")
	}
	if ref.ContentType != "text/plain" {
		t.Errorf("ContentType: got %q, want %q", ref.ContentType, "text/plain")
	}
	if ref.Size != int64(len(content)) {
		t.Errorf("Size: got %d, want %d", ref.Size, len(content))
	}
	if ref.CreatedAt.IsZero() {
		t.Error("CreatedAt: expected non-zero timestamp")
	}

	// Get
	reader, err := backend.Get(ctx, ref)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	defer reader.Close()
	data, _ := io.ReadAll(reader)
	if string(data) != content {
		t.Errorf("Get content: got %q, want %q", string(data), content)
	}
}

func TestMemoryBackend_GetNotFound(t *testing.T) {
	backend := NewMemoryBackend()
	ref := &ArtifactRef{URI: "memory://nonexistent"}
	_, err := backend.Get(context.Background(), ref)
	if err == nil {
		t.Fatal("expected error for nonexistent artifact")
	}
}

func TestMemoryBackend_Delete(t *testing.T) {
	backend := NewMemoryBackend()
	ctx := context.Background()

	ref, _ := backend.Put(ctx, "test/file.txt", strings.NewReader("data"), "text/plain")
	err := backend.Delete(ctx, ref)
	if err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Should be gone
	_, err = backend.Get(ctx, ref)
	if err == nil {
		t.Error("expected error after delete")
	}
}

func TestMemoryBackend_List(t *testing.T) {
	backend := NewMemoryBackend()
	ctx := context.Background()

	backend.Put(ctx, "runs/run1/nodes/a/out.txt", strings.NewReader("a"), "text/plain")
	backend.Put(ctx, "runs/run1/nodes/b/out.txt", strings.NewReader("b"), "text/plain")
	backend.Put(ctx, "runs/run2/nodes/a/out.txt", strings.NewReader("c"), "text/plain")

	refs, err := backend.List(ctx, "runs/run1/")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(refs) != 2 {
		t.Errorf("List count: got %d, want 2", len(refs))
	}
}

func TestMemoryBackend_PresignNotSupported(t *testing.T) {
	backend := NewMemoryBackend()
	ctx := context.Background()

	_, err := backend.PresignGet(ctx, &ArtifactRef{URI: "memory://x"}, time.Hour)
	if err == nil {
		t.Error("expected error for PresignGet on memory backend")
	}

	_, err = backend.PresignPut(ctx, "x", "text/plain", time.Hour)
	if err == nil {
		t.Error("expected error for PresignPut on memory backend")
	}
}

// --- Service integration tests (memory backend) ---

func TestService_StoreAndRetrieve(t *testing.T) {
	svc, _ := New(&Config{Type: "memory"})
	ctx := context.Background()

	ref, err := svc.StoreArtifact(ctx, "run1", "node1", "result.json", strings.NewReader(`{"result": 42}`), "application/json")
	if err != nil {
		t.Fatalf("StoreArtifact: %v", err)
	}

	reader, err := svc.GetArtifact(ctx, ref)
	if err != nil {
		t.Fatalf("GetArtifact: %v", err)
	}
	defer reader.Close()

	data, _ := io.ReadAll(reader)
	if string(data) != `{"result": 42}` {
		t.Errorf("content: got %q", string(data))
	}
}

func TestService_ListRunArtifacts(t *testing.T) {
	svc, _ := New(&Config{Type: "memory"})
	ctx := context.Background()

	svc.StoreArtifact(ctx, "run1", "node1", "a.txt", strings.NewReader("a"), "text/plain")
	svc.StoreArtifact(ctx, "run1", "node2", "b.txt", strings.NewReader("b"), "text/plain")
	svc.StoreArtifact(ctx, "run2", "node1", "c.txt", strings.NewReader("c"), "text/plain")

	refs, err := svc.ListRunArtifacts(ctx, "run1")
	if err != nil {
		t.Fatalf("ListRunArtifacts: %v", err)
	}
	if len(refs) != 2 {
		t.Errorf("count: got %d, want 2", len(refs))
	}
}

func TestService_DeleteArtifact(t *testing.T) {
	svc, _ := New(&Config{Type: "memory"})
	ctx := context.Background()

	ref, _ := svc.StoreArtifact(ctx, "run1", "node1", "tmp.txt", strings.NewReader("temp"), "text/plain")
	err := svc.DeleteArtifact(ctx, ref)
	if err != nil {
		t.Fatalf("DeleteArtifact: %v", err)
	}

	_, err = svc.GetArtifact(ctx, ref)
	if err == nil {
		t.Error("expected error after delete")
	}
}

// --- S3Backend path helper tests ---

func TestS3Backend_FullPath(t *testing.T) {
	b := &S3Backend{pathPrefix: "artifacts"}
	if got := b.fullPath("runs/r1/out.txt"); got != "artifacts/runs/r1/out.txt" {
		t.Errorf("fullPath: got %q, want %q", got, "artifacts/runs/r1/out.txt")
	}
}

func TestS3Backend_FullPathNoPrefix(t *testing.T) {
	b := &S3Backend{pathPrefix: ""}
	if got := b.fullPath("runs/r1/out.txt"); got != "runs/r1/out.txt" {
		t.Errorf("fullPath: got %q, want %q", got, "runs/r1/out.txt")
	}
}

func TestS3Backend_ExtractKey(t *testing.T) {
	b := &S3Backend{bucket: "test-bucket"}

	tests := []struct {
		uri  string
		want string
	}{
		{"s3://test-bucket/artifacts/run1/out.txt", "artifacts/run1/out.txt"},
		{"s3://test-bucket/file.txt", "file.txt"},
		{"malformed", "malformed"},
	}

	for _, tt := range tests {
		got := b.extractKey(tt.uri)
		if got != tt.want {
			t.Errorf("extractKey(%q): got %q, want %q", tt.uri, got, tt.want)
		}
	}
}
