package dataflow

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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

// --- Additional MemoryBackend tests not in dataflow_service_test.go ---

func TestMemoryBackend_ListAllPrefix(t *testing.T) {
	backend := NewMemoryBackend()
	ctx := context.Background()

	backend.Put(ctx, "a/1.txt", strings.NewReader("1"), "text/plain")
	backend.Put(ctx, "b/2.txt", strings.NewReader("2"), "text/plain")
	backend.Put(ctx, "a/3.txt", strings.NewReader("3"), "text/plain")

	// Empty prefix should match all
	refs, err := backend.List(ctx, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(refs) != 3 {
		t.Errorf("count: got %d, want 3", len(refs))
	}
}

func TestMemoryBackend_PutEmptyContent(t *testing.T) {
	backend := NewMemoryBackend()
	ctx := context.Background()

	ref, err := backend.Put(ctx, "empty.txt", strings.NewReader(""), "text/plain")
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if ref.Size != 0 {
		t.Errorf("Size: got %d, want 0", ref.Size)
	}

	reader, err := backend.Get(ctx, ref)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	defer reader.Close()
	data, _ := io.ReadAll(reader)
	if len(data) != 0 {
		t.Errorf("content length: got %d, want 0", len(data))
	}
}

// --- Service method coverage: presign errors on memory backend ---

func TestService_GetDownloadURL_MemoryBackend(t *testing.T) {
	svc, _ := New(&Config{Type: "memory"})
	ctx := context.Background()

	ref, _ := svc.StoreArtifact(ctx, "run1", "node1", "file.txt", strings.NewReader("data"), "text/plain")

	_, err := svc.GetDownloadURL(ctx, ref, time.Hour)
	if err == nil {
		t.Fatal("expected error for presigned URL on memory backend")
	}
	if !strings.Contains(err.Error(), "not supported") {
		t.Errorf("error: got %q, want to contain 'not supported'", err.Error())
	}
}

func TestService_GetUploadURL_MemoryBackend(t *testing.T) {
	svc, _ := New(&Config{Type: "memory"})
	ctx := context.Background()

	_, err := svc.GetUploadURL(ctx, "run1", "node1", "upload.bin", "application/octet-stream", time.Hour)
	if err == nil {
		t.Fatal("expected error for presigned URL on memory backend")
	}
}

func TestS3Backend_ExtractKey_NoBucketSlash(t *testing.T) {
	b := &S3Backend{bucket: "test-bucket"}

	// URI with bucket but no trailing slash
	got := b.extractKey("s3://test-bucket")
	if got != "test-bucket" {
		t.Errorf("extractKey (no path): got %q, want %q", got, "test-bucket")
	}
}

// --- Mock S3 HTTP server for S3Backend integration tests ---

// mockS3Store is an in-memory object store for the mock S3 HTTP server.
type mockS3Store struct {
	mu      sync.Mutex
	objects map[string]mockS3Object
}

type mockS3Object struct {
	data        []byte
	contentType string
	lastMod     time.Time
}

// setupMockS3 creates a mock S3 HTTP server and returns an S3Backend pointed at it.
func setupMockS3(t *testing.T, pathPrefix string) *S3Backend {
	t.Helper()
	store := &mockS3Store{objects: make(map[string]mockS3Object)}
	bucket := "test-bucket"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bucketPrefix := "/" + bucket
		if !strings.HasPrefix(r.URL.Path, bucketPrefix) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		key := strings.TrimPrefix(r.URL.Path, bucketPrefix)
		key = strings.TrimPrefix(key, "/")

		switch r.Method {
		case http.MethodPut:
			body, _ := io.ReadAll(r.Body)
			ct := r.Header.Get("Content-Type")
			if ct == "" {
				ct = "application/octet-stream"
			}
			store.mu.Lock()
			store.objects[key] = mockS3Object{
				data:        body,
				contentType: ct,
				lastMod:     time.Now().UTC(),
			}
			store.mu.Unlock()
			w.WriteHeader(http.StatusOK)

		case http.MethodGet:
			if r.URL.Query().Get("list-type") == "2" {
				prefix := r.URL.Query().Get("prefix")
				type xmlContent struct {
					Key          string `xml:"Key"`
					Size         int64  `xml:"Size"`
					LastModified string `xml:"LastModified"`
				}
				type xmlListResult struct {
					XMLName     xml.Name     `xml:"ListBucketResult"`
					Name        string       `xml:"Name"`
					Prefix      string       `xml:"Prefix"`
					KeyCount    int          `xml:"KeyCount"`
					MaxKeys     int          `xml:"MaxKeys"`
					IsTruncated bool         `xml:"IsTruncated"`
					Contents    []xmlContent `xml:"Contents"`
				}
				result := xmlListResult{
					Name:        bucket,
					Prefix:      prefix,
					MaxKeys:     1000,
					IsTruncated: false,
				}
				store.mu.Lock()
				for k, obj := range store.objects {
					if strings.HasPrefix(k, prefix) {
						result.Contents = append(result.Contents, xmlContent{
							Key:          k,
							Size:         int64(len(obj.data)),
							LastModified: obj.lastMod.Format(time.RFC3339),
						})
					}
				}
				result.KeyCount = len(result.Contents)
				store.mu.Unlock()
				w.Header().Set("Content-Type", "application/xml")
				xml.NewEncoder(w).Encode(result)
				return
			}
			store.mu.Lock()
			obj, ok := store.objects[key]
			store.mu.Unlock()
			if !ok {
				w.Header().Set("Content-Type", "application/xml")
				w.WriteHeader(http.StatusNotFound)
				fmt.Fprint(w, `<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>`)
				return
			}
			w.Header().Set("Content-Type", obj.contentType)
			w.Write(obj.data)

		case http.MethodDelete:
			store.mu.Lock()
			delete(store.objects, key)
			store.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)

		case http.MethodHead:
			store.mu.Lock()
			_, ok := store.objects[key]
			store.mu.Unlock()
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)

		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(srv.Close)

	endpoint := strings.TrimPrefix(srv.URL, "http://")
	backend, err := NewS3Backend(&S3Config{
		Endpoint:       endpoint,
		Bucket:         bucket,
		Region:         "us-east-1",
		AccessKeyID:    "test-key",
		SecretAccessKey: "test-secret",
		UseSSL:         false,
		PathPrefix:     pathPrefix,
	})
	if err != nil {
		t.Fatalf("NewS3Backend: %v", err)
	}
	return backend
}

func TestS3Backend_PutAndGet(t *testing.T) {
	backend := setupMockS3(t, "")
	ctx := context.Background()

	content := "hello s3 world"
	ref, err := backend.Put(ctx, "test/file.txt", strings.NewReader(content), "text/plain")
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if ref.ContentType != "text/plain" {
		t.Errorf("ContentType: got %q, want %q", ref.ContentType, "text/plain")
	}
	if ref.Size != int64(len(content)) {
		t.Errorf("Size: got %d, want %d", ref.Size, len(content))
	}
	if ref.Checksum == "" {
		t.Error("Checksum: expected non-empty")
	}

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

func TestS3Backend_PutDefaultContentType(t *testing.T) {
	backend := setupMockS3(t, "")
	ctx := context.Background()

	ref, err := backend.Put(ctx, "test/binary.dat", strings.NewReader("data"), "")
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if ref.ContentType != "application/octet-stream" {
		t.Errorf("ContentType: got %q, want %q", ref.ContentType, "application/octet-stream")
	}
}

func TestS3Backend_GetNotFound_MockServer(t *testing.T) {
	backend := setupMockS3(t, "")
	ctx := context.Background()

	_, err := backend.Get(ctx, &ArtifactRef{URI: "s3://test-bucket/nonexistent"})
	if err == nil {
		t.Fatal("expected error for nonexistent key")
	}
}

func TestS3Backend_DeleteObject(t *testing.T) {
	backend := setupMockS3(t, "")
	ctx := context.Background()

	ref, _ := backend.Put(ctx, "test/del.txt", strings.NewReader("delete me"), "text/plain")
	err := backend.Delete(ctx, ref)
	if err != nil {
		t.Fatalf("Delete: %v", err)
	}
	_, err = backend.Get(ctx, ref)
	if err == nil {
		t.Error("expected error after delete")
	}
}

func TestS3Backend_ListObjects(t *testing.T) {
	backend := setupMockS3(t, "")
	ctx := context.Background()

	backend.Put(ctx, "runs/r1/a.txt", strings.NewReader("a"), "text/plain")
	backend.Put(ctx, "runs/r1/b.txt", strings.NewReader("b"), "text/plain")
	backend.Put(ctx, "runs/r2/c.txt", strings.NewReader("c"), "text/plain")

	refs, err := backend.List(ctx, "runs/r1/")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(refs) != 2 {
		t.Errorf("List count: got %d, want 2", len(refs))
	}
	for _, ref := range refs {
		if !strings.HasPrefix(ref.URI, "s3://test-bucket/runs/r1/") {
			t.Errorf("URI: got %q, expected s3://test-bucket/runs/r1/ prefix", ref.URI)
		}
	}
}

func TestS3Backend_PresignGetURL(t *testing.T) {
	backend := setupMockS3(t, "")
	ctx := context.Background()

	ref := &ArtifactRef{URI: "s3://test-bucket/test/file.txt"}
	url, err := backend.PresignGet(ctx, ref, time.Hour)
	if err != nil {
		t.Fatalf("PresignGet: %v", err)
	}
	if url == "" {
		t.Error("expected non-empty presigned URL")
	}
}

func TestS3Backend_PresignPutURL(t *testing.T) {
	backend := setupMockS3(t, "")
	ctx := context.Background()

	url, err := backend.PresignPut(ctx, "test/upload.bin", "application/octet-stream", time.Hour)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if url == "" {
		t.Error("expected non-empty presigned URL")
	}
}

func TestS3Backend_PresignPutDefaultContentType(t *testing.T) {
	backend := setupMockS3(t, "")
	ctx := context.Background()

	url, err := backend.PresignPut(ctx, "test/upload.bin", "", time.Hour)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if url == "" {
		t.Error("expected non-empty presigned URL")
	}
}

func TestS3Backend_PutWithPathPrefix(t *testing.T) {
	backend := setupMockS3(t, "artifacts")
	ctx := context.Background()

	ref, err := backend.Put(ctx, "test/file.txt", strings.NewReader("data"), "text/plain")
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if !strings.Contains(ref.URI, "artifacts/test/file.txt") {
		t.Errorf("URI: got %q, expected to contain 'artifacts/test/file.txt'", ref.URI)
	}
}
