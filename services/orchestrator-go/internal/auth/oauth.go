// Package auth provides OAuth2/OIDC authentication for the orchestrator API.
package auth

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// Provider wraps OIDC provider functionality.
type Provider struct {
	provider     *oidc.Provider
	verifier     *oidc.IDTokenVerifier
	oauth2Config *oauth2.Config
	config       *Config
}

// Config holds OIDC provider configuration.
type Config struct {
	// Issuer is the OIDC provider URL (e.g., https://auth.example.com)
	Issuer string

	// ClientID is the OAuth2 client ID
	ClientID string

	// ClientSecret is the OAuth2 client secret (optional for public clients)
	ClientSecret string

	// RedirectURL for OAuth2 code flow
	RedirectURL string

	// Scopes to request
	Scopes []string

	// Audience for token validation (optional)
	Audience string

	// SkipIssuerCheck disables issuer validation (use only for testing)
	SkipIssuerCheck bool

	// SkipExpiryCheck disables expiry validation (use only for testing)
	SkipExpiryCheck bool
}

// DefaultConfig returns a minimal configuration.
func DefaultConfig() *Config {
	return &Config{
		Scopes: []string{oidc.ScopeOpenID, "profile", "email"},
	}
}

// NewProvider creates a new OIDC provider.
func NewProvider(ctx context.Context, cfg *Config) (*Provider, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}
	if cfg.Issuer == "" {
		return nil, fmt.Errorf("issuer is required")
	}
	if cfg.ClientID == "" {
		return nil, fmt.Errorf("client_id is required")
	}

	// Create OIDC provider (fetches discovery document)
	provider, err := oidc.NewProvider(ctx, cfg.Issuer)
	if err != nil {
		return nil, fmt.Errorf("create oidc provider: %w", err)
	}

	// Configure verifier
	verifierConfig := &oidc.Config{
		ClientID:          cfg.ClientID,
		SkipIssuerCheck:   cfg.SkipIssuerCheck,
		SkipExpiryCheck:   cfg.SkipExpiryCheck,
		SkipClientIDCheck: false,
	}
	verifier := provider.Verifier(verifierConfig)

	// Configure OAuth2
	scopes := cfg.Scopes
	if len(scopes) == 0 {
		scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	}

	oauth2Config := &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  cfg.RedirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       scopes,
	}

	return &Provider{
		provider:     provider,
		verifier:     verifier,
		oauth2Config: oauth2Config,
		config:       cfg,
	}, nil
}

// VerifyToken verifies an ID token and returns claims.
func (p *Provider) VerifyToken(ctx context.Context, rawToken string) (*Claims, error) {
	// Remove "Bearer " prefix if present
	rawToken = strings.TrimPrefix(rawToken, "Bearer ")
	rawToken = strings.TrimPrefix(rawToken, "bearer ")

	idToken, err := p.verifier.Verify(ctx, rawToken)
	if err != nil {
		return nil, fmt.Errorf("verify token: %w", err)
	}

	// Extract standard claims
	var claims Claims
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("extract claims: %w", err)
	}

	claims.Raw = idToken

	return &claims, nil
}

// VerifyAccessToken verifies an access token using the userinfo endpoint.
// Use this for opaque access tokens that aren't JWTs.
func (p *Provider) VerifyAccessToken(ctx context.Context, accessToken string) (*Claims, error) {
	// Remove "Bearer " prefix if present
	accessToken = strings.TrimPrefix(accessToken, "Bearer ")
	accessToken = strings.TrimPrefix(accessToken, "bearer ")

	// Call userinfo endpoint
	userInfo, err := p.provider.UserInfo(ctx, oauth2.StaticTokenSource(&oauth2.Token{
		AccessToken: accessToken,
	}))
	if err != nil {
		return nil, fmt.Errorf("userinfo: %w", err)
	}

	claims := &Claims{
		Subject: userInfo.Subject,
		Email:   userInfo.Email,
	}

	// Extract additional claims
	var extra map[string]interface{}
	if err := userInfo.Claims(&extra); err == nil {
		if name, ok := extra["name"].(string); ok {
			claims.Name = name
		}
		if groups, ok := extra["groups"].([]interface{}); ok {
			for _, g := range groups {
				if gs, ok := g.(string); ok {
					claims.Groups = append(claims.Groups, gs)
				}
			}
		}
	}

	return claims, nil
}

// AuthCodeURL generates an authorization URL for the code flow.
func (p *Provider) AuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	return p.oauth2Config.AuthCodeURL(state, opts...)
}

// Exchange exchanges an authorization code for tokens.
func (p *Provider) Exchange(ctx context.Context, code string) (*oauth2.Token, error) {
	return p.oauth2Config.Exchange(ctx, code)
}

// Claims represents the standard OIDC claims.
type Claims struct {
	Subject       string    `json:"sub"`
	Name          string    `json:"name,omitempty"`
	Email         string    `json:"email,omitempty"`
	EmailVerified bool      `json:"email_verified,omitempty"`
	Picture       string    `json:"picture,omitempty"`
	Groups        []string  `json:"groups,omitempty"`
	Roles         []string  `json:"roles,omitempty"`
	Issuer        string    `json:"iss,omitempty"`
	Audience      []string  `json:"aud,omitempty"`
	Expiry        time.Time `json:"exp,omitempty"`
	IssuedAt      time.Time `json:"iat,omitempty"`

	// Raw is the underlying ID token
	Raw *oidc.IDToken `json:"-"`
}

// HasRole checks if the user has a specific role.
func (c *Claims) HasRole(role string) bool {
	for _, r := range c.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// HasGroup checks if the user is in a specific group.
func (c *Claims) HasGroup(group string) bool {
	for _, g := range c.Groups {
		if g == group {
			return true
		}
	}
	return false
}

// IsExpired checks if the token has expired.
func (c *Claims) IsExpired() bool {
	if c.Expiry.IsZero() {
		return false
	}
	return time.Now().After(c.Expiry)
}
