// Package dataflow provides data transfer and artifact management for agent I/O.
package dataflow

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"
)

// ArtifactRef represents a reference to an artifact in storage.
type ArtifactRef struct {
	// URI is the full artifact path (e.g., "s3://bucket/path/to/artifact")
	URI string `json:"uri"`

	// ContentType is the MIME type
	ContentType string `json:"content_type,omitempty"`

	// Size in bytes
	Size int64 `json:"size,omitempty"`

	// Checksum (SHA256)
	Checksum string `json:"checksum,omitempty"`

	// CreatedAt timestamp
	CreatedAt time.Time `json:"created_at,omitempty"`

	// Metadata
	Metadata map[string]string `json:"metadata,omitempty"`
}

// Service provides data flow operations for artifacts.
type Service struct {
	backend Backend
}

// Backend defines the storage backend interface.
type Backend interface {
	// Put stores data and returns an artifact reference
	Put(ctx context.Context, path string, data io.Reader, contentType string) (*ArtifactRef, error)

	// Get retrieves data for an artifact
	Get(ctx context.Context, ref *ArtifactRef) (io.ReadCloser, error)

	// Delete removes an artifact
	Delete(ctx context.Context, ref *ArtifactRef) error

	// List lists artifacts with a prefix
	List(ctx context.Context, prefix string) ([]*ArtifactRef, error)

	// PresignGet generates a presigned URL for download
	PresignGet(ctx context.Context, ref *ArtifactRef, expiry time.Duration) (string, error)

	// PresignPut generates a presigned URL for upload
	PresignPut(ctx context.Context, path string, contentType string, expiry time.Duration) (string, error)
}

// Config holds dataflow service configuration.
type Config struct {
	// Backend type: "memory", "s3", "minio"
	Type string

	// S3/MinIO configuration
	Endpoint        string
	Bucket          string
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	UseSSL          bool

	// Path prefix for all artifacts
	PathPrefix string
}

// DefaultConfig returns sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		Type:       "memory",
		PathPrefix: "artifacts",
	}
}

// New creates a new dataflow service.
func New(cfg *Config) (*Service, error) {
	if cfg == nil {
		cfg = DefaultConfig()
	}

	var backend Backend
	switch cfg.Type {
	case "memory":
		backend = NewMemoryBackend()
	case "s3", "minio":
		s3Cfg := &S3Config{
			Endpoint:        cfg.Endpoint,
			Bucket:          cfg.Bucket,
			Region:          cfg.Region,
			AccessKeyID:     cfg.AccessKeyID,
			SecretAccessKey: cfg.SecretAccessKey,
			UseSSL:          cfg.UseSSL,
			PathPrefix:      cfg.PathPrefix,
		}
		s3Backend, err := NewS3Backend(s3Cfg)
		if err != nil {
			return nil, fmt.Errorf("create s3 backend: %w", err)
		}
		backend = s3Backend
	default:
		return nil, fmt.Errorf("unknown backend type: %s", cfg.Type)
	}

	return &Service{backend: backend}, nil
}

// GenerateArtifactPath generates a path for an artifact.
func (s *Service) GenerateArtifactPath(runID, nodeID, name string) string {
	return fmt.Sprintf("runs/%s/nodes/%s/%s", runID, nodeID, name)
}

// StoreArtifact stores an artifact and returns its reference.
func (s *Service) StoreArtifact(ctx context.Context, runID, nodeID, name string, data io.Reader, contentType string) (*ArtifactRef, error) {
	path := s.GenerateArtifactPath(runID, nodeID, name)
	return s.backend.Put(ctx, path, data, contentType)
}

// GetArtifact retrieves an artifact.
func (s *Service) GetArtifact(ctx context.Context, ref *ArtifactRef) (io.ReadCloser, error) {
	return s.backend.Get(ctx, ref)
}

// DeleteArtifact removes an artifact.
func (s *Service) DeleteArtifact(ctx context.Context, ref *ArtifactRef) error {
	return s.backend.Delete(ctx, ref)
}

// ListRunArtifacts lists all artifacts for a run.
func (s *Service) ListRunArtifacts(ctx context.Context, runID string) ([]*ArtifactRef, error) {
	prefix := fmt.Sprintf("runs/%s/", runID)
	return s.backend.List(ctx, prefix)
}

// GetDownloadURL generates a presigned download URL.
func (s *Service) GetDownloadURL(ctx context.Context, ref *ArtifactRef, expiry time.Duration) (string, error) {
	return s.backend.PresignGet(ctx, ref, expiry)
}

// GetUploadURL generates a presigned upload URL.
func (s *Service) GetUploadURL(ctx context.Context, runID, nodeID, name, contentType string, expiry time.Duration) (string, error) {
	path := s.GenerateArtifactPath(runID, nodeID, name)
	return s.backend.PresignPut(ctx, path, contentType, expiry)
}

// MemoryBackend provides an in-memory storage backend for testing.
type MemoryBackend struct {
	artifacts map[string]*memoryArtifact
}

type memoryArtifact struct {
	ref  *ArtifactRef
	data []byte
}

// NewMemoryBackend creates a new in-memory backend.
func NewMemoryBackend() *MemoryBackend {
	return &MemoryBackend{
		artifacts: make(map[string]*memoryArtifact),
	}
}

func (m *MemoryBackend) Put(ctx context.Context, path string, data io.Reader, contentType string) (*ArtifactRef, error) {
	content, err := io.ReadAll(data)
	if err != nil {
		return nil, err
	}

	ref := &ArtifactRef{
		URI:         fmt.Sprintf("memory://%s", path),
		ContentType: contentType,
		Size:        int64(len(content)),
		CreatedAt:   time.Now().UTC(),
	}

	m.artifacts[path] = &memoryArtifact{ref: ref, data: content}
	return ref, nil
}

func (m *MemoryBackend) Get(ctx context.Context, ref *ArtifactRef) (io.ReadCloser, error) {
	path := strings.TrimPrefix(ref.URI, "memory://")
	artifact, ok := m.artifacts[path]
	if !ok {
		return nil, fmt.Errorf("artifact not found: %s", ref.URI)
	}
	return io.NopCloser(strings.NewReader(string(artifact.data))), nil
}

func (m *MemoryBackend) Delete(ctx context.Context, ref *ArtifactRef) error {
	path := strings.TrimPrefix(ref.URI, "memory://")
	delete(m.artifacts, path)
	return nil
}

func (m *MemoryBackend) List(ctx context.Context, prefix string) ([]*ArtifactRef, error) {
	var refs []*ArtifactRef
	for path, artifact := range m.artifacts {
		if strings.HasPrefix(path, prefix) {
			refs = append(refs, artifact.ref)
		}
	}
	return refs, nil
}

func (m *MemoryBackend) PresignGet(ctx context.Context, ref *ArtifactRef, expiry time.Duration) (string, error) {
	// Memory backend doesn't support presigned URLs
	return "", fmt.Errorf("presigned URLs not supported for memory backend")
}

func (m *MemoryBackend) PresignPut(ctx context.Context, path string, contentType string, expiry time.Duration) (string, error) {
	// Memory backend doesn't support presigned URLs
	return "", fmt.Errorf("presigned URLs not supported for memory backend")
}
