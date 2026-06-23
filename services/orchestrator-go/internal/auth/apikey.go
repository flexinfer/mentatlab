package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	apikeyPrefix = "apikey:"
	apikeyList   = "apikeys"
)

// APIKey represents a stored API key (never includes the plaintext key).
type APIKey struct {
	ID        string    `json:"id"`        // sha256 of plaintext key (first 12 chars)
	Name      string    `json:"name"`
	Owner     string    `json:"owner"`     // Owner email
	KeyHash   string    `json:"key_hash"`  // Full sha256 hex of plaintext key
	Scopes    []string  `json:"scopes,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	LastUsed  time.Time `json:"last_used,omitempty"`
}

// APIKeyStore manages API key persistence in Redis.
type APIKeyStore struct {
	client *redis.Client
}

// NewAPIKeyStore creates a new API key store backed by Redis.
func NewAPIKeyStore(client *redis.Client) *APIKeyStore {
	return &APIKeyStore{client: client}
}

// GenerateKey creates a new API key, stores it, and returns the plaintext key (once).
func (s *APIKeyStore) GenerateKey(ctx context.Context, name, owner string, scopes []string) (plaintext string, key *APIKey, err error) {
	// Generate 32 random bytes → 64-char hex string
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("generate random bytes: %w", err)
	}
	plaintext = "mlk_" + hex.EncodeToString(raw) // mlk_ prefix for MentatLab Key

	hash := sha256.Sum256([]byte(plaintext))
	keyHash := hex.EncodeToString(hash[:])
	id := keyHash[:12]

	now := time.Now().UTC()
	key = &APIKey{
		ID:        id,
		Name:      name,
		Owner:     owner,
		KeyHash:   keyHash,
		Scopes:    scopes,
		CreatedAt: now,
	}

	data, err := json.Marshal(key)
	if err != nil {
		return "", nil, fmt.Errorf("marshal key: %w", err)
	}

	pipe := s.client.TxPipeline()
	pipe.Set(ctx, apikeyPrefix+keyHash, data, 0)
	pipe.SAdd(ctx, apikeyList, keyHash)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", nil, fmt.Errorf("store key: %w", err)
	}

	return plaintext, key, nil
}

// ValidateKey checks a plaintext key against the store. Returns the key metadata if valid.
func (s *APIKeyStore) ValidateKey(ctx context.Context, plaintext string) (*APIKey, error) {
	hash := sha256.Sum256([]byte(plaintext))
	keyHash := hex.EncodeToString(hash[:])

	data, err := s.client.Get(ctx, apikeyPrefix+keyHash).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("invalid api key")
	}
	if err != nil {
		return nil, fmt.Errorf("lookup key: %w", err)
	}

	var key APIKey
	if err := json.Unmarshal(data, &key); err != nil {
		return nil, fmt.Errorf("unmarshal key: %w", err)
	}

	// Update last_used asynchronously (best-effort)
	go func() {
		key.LastUsed = time.Now().UTC()
		if updated, err := json.Marshal(&key); err == nil {
			s.client.Set(context.Background(), apikeyPrefix+keyHash, updated, 0)
		}
	}()

	return &key, nil
}

// RevokeKey deletes an API key by its hash.
func (s *APIKeyStore) RevokeKey(ctx context.Context, keyHash string) error {
	pipe := s.client.TxPipeline()
	pipe.Del(ctx, apikeyPrefix+keyHash)
	pipe.SRem(ctx, apikeyList, keyHash)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("revoke key: %w", err)
	}
	return nil
}

// ListKeys returns all API keys, optionally filtered by owner.
func (s *APIKeyStore) ListKeys(ctx context.Context, owner string) ([]*APIKey, error) {
	hashes, err := s.client.SMembers(ctx, apikeyList).Result()
	if err != nil {
		return nil, fmt.Errorf("list key hashes: %w", err)
	}

	var keys []*APIKey
	for _, h := range hashes {
		data, err := s.client.Get(ctx, apikeyPrefix+h).Bytes()
		if err != nil {
			continue
		}
		var key APIKey
		if err := json.Unmarshal(data, &key); err != nil {
			continue
		}
		if owner != "" && !strings.EqualFold(key.Owner, owner) {
			continue
		}
		keys = append(keys, &key)
	}
	return keys, nil
}

// IsAPIKey returns true if the token looks like a MentatLab API key (mlk_ prefix).
func IsAPIKey(token string) bool {
	return strings.HasPrefix(token, "mlk_")
}
