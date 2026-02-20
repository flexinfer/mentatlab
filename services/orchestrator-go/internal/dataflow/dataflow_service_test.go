package dataflow

import (
	"context"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"
)

// mockBackend implements Backend for testing Service methods without S3 dependency.
type mockBackend struct {
	artifacts map[string]*mockArtifact
}

type mockArtifact struct {
	ref  *ArtifactRef
	data []byte
}

func newMockBackend() *mockBackend {
	return &mockBackend{artifacts: make(map[string]*mockArtifact)}
}

func (m *mockBackend) Put(ctx context.Context, path string, data io.Reader, contentType string) (*ArtifactRef, error) {
	content, err := io.ReadAll(data)
	if err != nil {
		return nil, err
	}
	ref := &ArtifactRef{
		URI:         fmt.Sprintf("mock://%s", path),
		ContentType: contentType,
		Size:        int64(len(content)),
		CreatedAt:   time.Now().UTC(),
	}
	m.artifacts[path] = &mockArtifact{ref: ref, data: content}
	return ref, nil
}

func (m *mockBackend) Get(ctx context.Context, ref *ArtifactRef) (io.ReadCloser, error) {
	path := strings.TrimPrefix(ref.URI, "mock://")
	art, ok := m.artifacts[path]
	if !ok {
		return nil, fmt.Errorf("not found: %s", ref.URI)
	}
	return io.NopCloser(strings.NewReader(string(art.data))), nil
}

func (m *mockBackend) Delete(ctx context.Context, ref *ArtifactRef) error {
	path := strings.TrimPrefix(ref.URI, "mock://")
	delete(m.artifacts, path)
	return nil
}

func (m *mockBackend) List(ctx context.Context, prefix string) ([]*ArtifactRef, error) {
	var refs []*ArtifactRef
	for path, art := range m.artifacts {
		if strings.HasPrefix(path, prefix) {
			refs = append(refs, art.ref)
		}
	}
	return refs, nil
}

func (m *mockBackend) PresignGet(ctx context.Context, ref *ArtifactRef, expiry time.Duration) (string, error) {
	return fmt.Sprintf("https://mock.s3/download?uri=%s&expiry=%s", ref.URI, expiry), nil
}

func (m *mockBackend) PresignPut(ctx context.Context, path string, contentType string, expiry time.Duration) (string, error) {
	return fmt.Sprintf("https://mock.s3/upload?path=%s&type=%s&expiry=%s", path, contentType, expiry), nil
}

// --- Service with mock backend tests ---

func TestService_GetDownloadURL(t *testing.T) {
	svc := &Service{backend: newMockBackend()}
	ctx := context.Background()

	ref, err := svc.StoreArtifact(ctx, "run1", "node1", "output.bin", strings.NewReader("data"), "application/octet-stream")
	if err != nil {
		t.Fatalf("StoreArtifact: %v", err)
	}

	url, err := svc.GetDownloadURL(ctx, ref, 15*time.Minute)
	if err != nil {
		t.Fatalf("GetDownloadURL: %v", err)
	}
	if !strings.Contains(url, "download") {
		t.Errorf("URL: got %q, want to contain 'download'", url)
	}
	if !strings.Contains(url, "15m0s") {
		t.Errorf("URL: got %q, want to contain expiry", url)
	}
}

func TestService_GetUploadURL(t *testing.T) {
	svc := &Service{backend: newMockBackend()}
	ctx := context.Background()

	url, err := svc.GetUploadURL(ctx, "run1", "node1", "input.json", "application/json", 10*time.Minute)
	if err != nil {
		t.Fatalf("GetUploadURL: %v", err)
	}
	if !strings.Contains(url, "upload") {
		t.Errorf("URL: got %q, want to contain 'upload'", url)
	}
	if !strings.Contains(url, "application/json") {
		t.Errorf("URL: got %q, want to contain content type", url)
	}
}

func TestService_StoreAndRetrieve_MockBackend(t *testing.T) {
	svc := &Service{backend: newMockBackend()}
	ctx := context.Background()

	content := `{"result": "hello"}`
	ref, err := svc.StoreArtifact(ctx, "run1", "node1", "result.json", strings.NewReader(content), "application/json")
	if err != nil {
		t.Fatalf("StoreArtifact: %v", err)
	}
	if ref.ContentType != "application/json" {
		t.Errorf("ContentType: got %q, want %q", ref.ContentType, "application/json")
	}
	if ref.Size != int64(len(content)) {
		t.Errorf("Size: got %d, want %d", ref.Size, len(content))
	}

	reader, err := svc.GetArtifact(ctx, ref)
	if err != nil {
		t.Fatalf("GetArtifact: %v", err)
	}
	defer func() { _ = reader.Close() }()
	data, _ := io.ReadAll(reader)
	if string(data) != content {
		t.Errorf("content: got %q, want %q", string(data), content)
	}
}

func TestService_DeleteArtifact_MockBackend(t *testing.T) {
	svc := &Service{backend: newMockBackend()}
	ctx := context.Background()

	ref, _ := svc.StoreArtifact(ctx, "run1", "node1", "temp.txt", strings.NewReader("temp"), "text/plain")
	if err := svc.DeleteArtifact(ctx, ref); err != nil {
		t.Fatalf("DeleteArtifact: %v", err)
	}
	_, err := svc.GetArtifact(ctx, ref)
	if err == nil {
		t.Error("expected error after delete")
	}
}

func TestService_ListRunArtifacts_MockBackend(t *testing.T) {
	svc := &Service{backend: newMockBackend()}
	ctx := context.Background()

	_, _ = svc.StoreArtifact(ctx, "run1", "node1", "a.txt", strings.NewReader("a"), "text/plain")
	_, _ = svc.StoreArtifact(ctx, "run1", "node2", "b.txt", strings.NewReader("b"), "text/plain")
	_, _ = svc.StoreArtifact(ctx, "run2", "node1", "c.txt", strings.NewReader("c"), "text/plain")

	refs, err := svc.ListRunArtifacts(ctx, "run1")
	if err != nil {
		t.Fatalf("ListRunArtifacts: %v", err)
	}
	if len(refs) != 2 {
		t.Errorf("count: got %d, want 2", len(refs))
	}
}

// --- GenerateArtifactPath edge cases ---

func TestGenerateArtifactPath_SpecialChars(t *testing.T) {
	svc, _ := New(nil)
	path := svc.GenerateArtifactPath("run-123", "node_456", "my output.json")
	expected := "runs/run-123/nodes/node_456/my output.json"
	if path != expected {
		t.Errorf("path: got %q, want %q", path, expected)
	}
}

func TestGenerateArtifactPath_EmptyName(t *testing.T) {
	svc, _ := New(nil)
	path := svc.GenerateArtifactPath("r1", "n1", "")
	expected := "runs/r1/nodes/n1/"
	if path != expected {
		t.Errorf("path: got %q, want %q", path, expected)
	}
}

// --- NewS3Backend validation and construction ---

func TestNewS3Backend_MissingBucket(t *testing.T) {
	_, err := NewS3Backend(&S3Config{})
	if err == nil {
		t.Fatal("expected error for missing bucket")
	}
	if !strings.Contains(err.Error(), "bucket name is required") {
		t.Errorf("error: got %q", err.Error())
	}
}

func TestNewS3Backend_DefaultRegion(t *testing.T) {
	backend, err := NewS3Backend(&S3Config{
		Bucket:         "test-bucket",
		AccessKeyID:    "test-key",
		SecretAccessKey: "test-secret",
	})
	if err != nil {
		t.Fatalf("NewS3Backend: %v", err)
	}
	if backend.bucket != "test-bucket" {
		t.Errorf("bucket: got %q, want %q", backend.bucket, "test-bucket")
	}
}

func TestNewS3Backend_CustomEndpoint(t *testing.T) {
	backend, err := NewS3Backend(&S3Config{
		Bucket:          "artifacts",
		Region:          "eu-west-1",
		Endpoint:        "minio.local:9000",
		AccessKeyID:     "minioadmin",
		SecretAccessKey:  "minioadmin",
		PathPrefix:      "data",
	})
	if err != nil {
		t.Fatalf("NewS3Backend: %v", err)
	}
	if backend.bucket != "artifacts" {
		t.Errorf("bucket: got %q, want %q", backend.bucket, "artifacts")
	}
	if backend.pathPrefix != "data" {
		t.Errorf("pathPrefix: got %q, want %q", backend.pathPrefix, "data")
	}
}

func TestNewS3Backend_WithSSL(t *testing.T) {
	backend, err := NewS3Backend(&S3Config{
		Bucket:          "secure-bucket",
		Endpoint:        "s3.amazonaws.com",
		UseSSL:          true,
		AccessKeyID:     "key",
		SecretAccessKey:  "secret",
	})
	if err != nil {
		t.Fatalf("NewS3Backend: %v", err)
	}
	if backend.bucket != "secure-bucket" {
		t.Errorf("bucket: got %q, want %q", backend.bucket, "secure-bucket")
	}
}

func TestNewS3Backend_NoCredentials(t *testing.T) {
	// Should succeed using default credential chain
	backend, err := NewS3Backend(&S3Config{
		Bucket: "default-creds-bucket",
	})
	if err != nil {
		t.Fatalf("NewS3Backend: %v", err)
	}
	if backend.client == nil {
		t.Error("expected non-nil S3 client")
	}
	if backend.presigner == nil {
		t.Error("expected non-nil presigner")
	}
}

// --- MemoryBackend additional edge cases ---

func TestMemoryBackend_DeleteNonexistent(t *testing.T) {
	backend := NewMemoryBackend()
	// Deleting a nonexistent artifact should not error
	err := backend.Delete(context.Background(), &ArtifactRef{URI: "memory://nonexistent"})
	if err != nil {
		t.Errorf("Delete nonexistent: %v", err)
	}
}

func TestMemoryBackend_ListEmpty(t *testing.T) {
	backend := NewMemoryBackend()
	refs, err := backend.List(context.Background(), "prefix/")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(refs) != 0 {
		t.Errorf("count: got %d, want 0", len(refs))
	}
}

func TestMemoryBackend_PutOverwrite(t *testing.T) {
	backend := NewMemoryBackend()
	ctx := context.Background()

	_, _ = backend.Put(ctx, "test/file.txt", strings.NewReader("original"), "text/plain")
	ref, err := backend.Put(ctx, "test/file.txt", strings.NewReader("updated"), "text/plain")
	if err != nil {
		t.Fatalf("Put: %v", err)
	}

	reader, err := backend.Get(ctx, ref)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	defer func() { _ = reader.Close() }()
	data, _ := io.ReadAll(reader)
	if string(data) != "updated" {
		t.Errorf("content: got %q, want %q", string(data), "updated")
	}
}

// --- New with minio type alias ---

func TestNew_MinIOType(t *testing.T) {
	// "minio" is an alias for "s3", but needs a bucket
	_, err := New(&Config{Type: "minio"})
	if err == nil {
		t.Fatal("expected error for minio without bucket")
	}
	// Should fail on bucket validation, not unknown backend
	if strings.Contains(err.Error(), "unknown backend type") {
		t.Errorf("error: got %q, expected s3/bucket validation error not unknown type", err.Error())
	}
}

// --- S3Backend fullPath and extractKey additional edge cases ---

func TestS3Backend_FullPathTrailingSlash(t *testing.T) {
	b := &S3Backend{pathPrefix: "artifacts/"}
	got := b.fullPath("file.txt")
	expected := "artifacts//file.txt"
	if got != expected {
		t.Errorf("fullPath: got %q, want %q", got, expected)
	}
}

func TestS3Backend_ExtractKey_NoScheme(t *testing.T) {
	b := &S3Backend{bucket: "b"}
	got := b.extractKey("just-a-key")
	if got != "just-a-key" {
		t.Errorf("extractKey: got %q, want %q", got, "just-a-key")
	}
}

func TestS3Backend_ExtractKey_EmptyAfterBucket(t *testing.T) {
	b := &S3Backend{bucket: "b"}
	got := b.extractKey("s3://b/")
	if got != "" {
		t.Errorf("extractKey: got %q, want empty", got)
	}
}
