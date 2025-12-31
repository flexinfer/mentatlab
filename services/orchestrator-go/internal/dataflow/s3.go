package dataflow

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// S3Backend provides S3/MinIO storage for artifacts.
type S3Backend struct {
	client     *s3.Client
	presigner  *s3.PresignClient
	bucket     string
	pathPrefix string
}

// S3Config holds S3/MinIO connection configuration.
type S3Config struct {
	// Endpoint for MinIO (e.g., "minio.mentatlab.svc:9000")
	// Leave empty for AWS S3
	Endpoint string

	// Bucket name
	Bucket string

	// Region (required for AWS S3, optional for MinIO)
	Region string

	// Credentials
	AccessKeyID     string
	SecretAccessKey string

	// UseSSL enables HTTPS (default: false for internal MinIO)
	UseSSL bool

	// PathPrefix is prepended to all artifact paths
	PathPrefix string
}

// NewS3Backend creates a new S3/MinIO backend.
func NewS3Backend(cfg *S3Config) (*S3Backend, error) {
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("bucket name is required")
	}

	region := cfg.Region
	if region == "" {
		region = "us-east-1" // Default region for MinIO
	}

	// Build custom endpoint resolver for MinIO
	var opts []func(*config.LoadOptions) error
	opts = append(opts, config.WithRegion(region))

	// Add credentials
	if cfg.AccessKeyID != "" && cfg.SecretAccessKey != "" {
		opts = append(opts, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(
				cfg.AccessKeyID,
				cfg.SecretAccessKey,
				"", // session token (not used for MinIO)
			),
		))
	}

	awsCfg, err := config.LoadDefaultConfig(context.Background(), opts...)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	// Create S3 client with custom endpoint for MinIO
	var s3Opts []func(*s3.Options)

	if cfg.Endpoint != "" {
		scheme := "http"
		if cfg.UseSSL {
			scheme = "https"
		}
		endpoint := fmt.Sprintf("%s://%s", scheme, cfg.Endpoint)

		s3Opts = append(s3Opts, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(endpoint)
			o.UsePathStyle = true // Required for MinIO
		})
	}

	client := s3.NewFromConfig(awsCfg, s3Opts...)
	presigner := s3.NewPresignClient(client)

	return &S3Backend{
		client:     client,
		presigner:  presigner,
		bucket:     cfg.Bucket,
		pathPrefix: cfg.PathPrefix,
	}, nil
}

// fullPath returns the full S3 key for an artifact path.
func (b *S3Backend) fullPath(path string) string {
	if b.pathPrefix == "" {
		return path
	}
	return b.pathPrefix + "/" + path
}

// Put stores data and returns an artifact reference.
func (b *S3Backend) Put(ctx context.Context, path string, data io.Reader, contentType string) (*ArtifactRef, error) {
	key := b.fullPath(path)

	// Read all data to calculate checksum and size
	content, err := io.ReadAll(data)
	if err != nil {
		return nil, fmt.Errorf("read data: %w", err)
	}

	// Calculate SHA256 checksum
	hash := sha256.Sum256(content)
	checksum := hex.EncodeToString(hash[:])

	// Default content type
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Upload to S3
	_, err = b.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(b.bucket),
		Key:           aws.String(key),
		Body:          strings.NewReader(string(content)),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(int64(len(content))),
	})
	if err != nil {
		return nil, fmt.Errorf("put object: %w", err)
	}

	return &ArtifactRef{
		URI:         fmt.Sprintf("s3://%s/%s", b.bucket, key),
		ContentType: contentType,
		Size:        int64(len(content)),
		Checksum:    checksum,
		CreatedAt:   time.Now().UTC(),
	}, nil
}

// Get retrieves data for an artifact.
func (b *S3Backend) Get(ctx context.Context, ref *ArtifactRef) (io.ReadCloser, error) {
	key := b.extractKey(ref.URI)

	result, err := b.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("get object: %w", err)
	}

	return result.Body, nil
}

// Delete removes an artifact.
func (b *S3Backend) Delete(ctx context.Context, ref *ArtifactRef) error {
	key := b.extractKey(ref.URI)

	_, err := b.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete object: %w", err)
	}

	return nil
}

// List lists artifacts with a prefix.
func (b *S3Backend) List(ctx context.Context, prefix string) ([]*ArtifactRef, error) {
	fullPrefix := b.fullPath(prefix)

	var refs []*ArtifactRef
	paginator := s3.NewListObjectsV2Paginator(b.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(b.bucket),
		Prefix: aws.String(fullPrefix),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list objects: %w", err)
		}

		for _, obj := range page.Contents {
			refs = append(refs, &ArtifactRef{
				URI:       fmt.Sprintf("s3://%s/%s", b.bucket, *obj.Key),
				Size:      *obj.Size,
				CreatedAt: *obj.LastModified,
			})
		}
	}

	return refs, nil
}

// PresignGet generates a presigned URL for download.
func (b *S3Backend) PresignGet(ctx context.Context, ref *ArtifactRef, expiry time.Duration) (string, error) {
	key := b.extractKey(ref.URI)

	result, err := b.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("presign get: %w", err)
	}

	return result.URL, nil
}

// PresignPut generates a presigned URL for upload.
func (b *S3Backend) PresignPut(ctx context.Context, path string, contentType string, expiry time.Duration) (string, error) {
	key := b.fullPath(path)

	if contentType == "" {
		contentType = "application/octet-stream"
	}

	result, err := b.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(b.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("presign put: %w", err)
	}

	return result.URL, nil
}

// extractKey extracts the S3 key from an artifact URI.
func (b *S3Backend) extractKey(uri string) string {
	// URI format: s3://bucket/key
	uri = strings.TrimPrefix(uri, "s3://")
	parts := strings.SplitN(uri, "/", 2)
	if len(parts) < 2 {
		return uri
	}
	return parts[1]
}
