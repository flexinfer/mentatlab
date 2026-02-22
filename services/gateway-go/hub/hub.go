package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/flexinfer/mentatlab/services/gateway-go/metrics"
	"github.com/flexinfer/mentatlab/services/gateway-go/middleware"
	"github.com/redis/go-redis/v9"
)

// streamMessage represents a message with stream routing info.
type streamMessage struct {
	StreamID string          `json:"stream_id,omitempty"`
	RunID    string          `json:"run_id,omitempty"`
	Type     string          `json:"type,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
	Raw      []byte          `json:"-"`
}

// Hub maintains the set of active clients and broadcasts messages to the
// clients, filtering by stream subscription.
type Hub struct {
	// Registered clients by stream ID
	clients map[string]map[*Client]bool

	// Global clients (subscribed to all streams)
	globalClients map[*Client]bool

	// Mutex for client maps
	mu sync.RWMutex

	// Inbound messages from Redis
	messages chan *streamMessage

	// Register requests from the clients.
	register chan *Client

	// Unregister requests from clients.
	unregister chan *Client

	// Redis client for subscribing to updates
	redisClient *redis.Client

	// Logger
	logger *slog.Logger

	// Allowed WebSocket origins
	allowedOrigins map[string]bool

	// Auth validator for WebSocket connections
	authValidator AuthValidator

	// Configurable ping/pong timing
	pongWait   time.Duration
	pingPeriod time.Duration

	// Stop channel
	stopCh chan struct{}
}

// AuthValidator validates WebSocket authentication and returns user info.
// Returns nil user and nil error if auth is disabled.
// Returns nil user and error if auth fails.
type AuthValidator func(r *http.Request) (userEmail, userType string, err error)

// HubConfig holds Hub configuration.
type HubConfig struct {
	RedisAddr      string
	Logger         *slog.Logger
	AllowedOrigins []string      // Allowed WebSocket origins (empty allows all - not recommended)
	AuthValidator  AuthValidator // Optional: validates WebSocket connections
	PongWait       time.Duration // Time allowed to read the next pong (default 60s)
	PingPeriod     time.Duration // Send pings at this interval; must be < PongWait (default 90% of PongWait)
}

// HubOption is a functional option for configuring the Hub.
type HubOption func(*Hub)

// WithLogger sets the logger for the hub.
func WithLogger(logger *slog.Logger) HubOption {
	return func(h *Hub) {
		if logger != nil {
			h.logger = logger
		}
	}
}

// WithAllowedOrigins sets the allowed WebSocket origins.
func WithAllowedOrigins(origins []string) HubOption {
	return func(h *Hub) {
		h.allowedOrigins = make(map[string]bool)
		for _, origin := range origins {
			h.allowedOrigins[origin] = true
		}
	}
}

// WithAuthValidator sets the authentication validator for WebSocket connections.
func WithAuthValidator(validator AuthValidator) HubOption {
	return func(h *Hub) {
		h.authValidator = validator
	}
}

// WithPongWait sets the time allowed to read the next pong.
func WithPongWait(d time.Duration) HubOption {
	return func(h *Hub) {
		if d > 0 {
			h.pongWait = d
			// Also update pingPeriod to 90% of pongWait if it was at default
			h.pingPeriod = (d * 9) / 10
		}
	}
}

// WithPingPeriod sets the interval at which pings are sent.
func WithPingPeriod(d time.Duration) HubOption {
	return func(h *Hub) {
		if d > 0 {
			h.pingPeriod = d
		}
	}
}

// NewHubWithAddress creates a new Hub with the given Redis address and options.
func NewHubWithAddress(redisAddr string, opts ...HubOption) *Hub {
	h := &Hub{
		clients:       make(map[string]map[*Client]bool),
		globalClients: make(map[*Client]bool),
		messages:      make(chan *streamMessage, 256),
		register:      make(chan *Client),
		unregister:    make(chan *Client),
		redisClient: redis.NewClient(&redis.Options{
			Addr: redisAddr,
		}),
		logger:         slog.Default(),
		allowedOrigins: make(map[string]bool),
		pongWait:       60 * time.Second,
		pingPeriod:     54 * time.Second, // 90% of pongWait
		stopCh:         make(chan struct{}),
	}

	for _, opt := range opts {
		opt(h)
	}

	return h
}

// NewHub creates a new Hub with the given Redis address and default configuration.
// Deprecated: Use NewHubWithAddress with Options instead.
func NewHub(redisAddr string) *Hub {
	return NewHubWithAddress(redisAddr)
}

// NewHubWithConfig creates a new Hub with full configuration struct.
// Deprecated: Use NewHubWithAddress with Options instead.
func NewHubWithConfig(cfg *HubConfig) *Hub {
	var opts []HubOption
	if cfg != nil {
		opts = append(opts, WithLogger(cfg.Logger))
		opts = append(opts, WithAllowedOrigins(cfg.AllowedOrigins))
		opts = append(opts, WithAuthValidator(cfg.AuthValidator))
		opts = append(opts, WithPongWait(cfg.PongWait))
		opts = append(opts, WithPingPeriod(cfg.PingPeriod))
	}

	return NewHubWithAddress(cfg.RedisAddr, opts...)
}

// Run starts the hub's main loop.
func (h *Hub) Run() {
	// Start Redis subscriber
	go h.subscribeToRedis()

	for {
		select {
		case client := <-h.register:
			h.registerClient(client)

		case client := <-h.unregister:
			h.unregisterClient(client)

		case msg := <-h.messages:
			h.broadcastMessage(msg)

		case <-h.stopCh:
			return
		}
	}
}

// Stop gracefully stops the hub.
func (h *Hub) Stop() {
	close(h.stopCh)
	h.redisClient.Close()
}

// registerClient adds a client to the appropriate stream subscription.
func (h *Hub) registerClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if client.streamID == "" || client.streamID == "*" {
		// Subscribe to all streams
		h.globalClients[client] = true
		h.logger.Info("client registered for all streams",
			slog.String("user", client.userEmail),
			slog.String("user_type", client.userType),
		)
	} else {
		// Subscribe to specific stream
		if h.clients[client.streamID] == nil {
			h.clients[client.streamID] = make(map[*Client]bool)
		}
		h.clients[client.streamID][client] = true
		h.logger.Info("client registered for stream",
			slog.String("stream_id", client.streamID),
			slog.String("user", client.userEmail),
			slog.String("user_type", client.userType),
		)
	}
}

// unregisterClient removes a client from subscriptions.
func (h *Hub) unregisterClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Check global clients
	if _, ok := h.globalClients[client]; ok {
		delete(h.globalClients, client)
		close(client.send)
		return
	}

	// Check stream-specific clients
	if clients, ok := h.clients[client.streamID]; ok {
		if _, ok := clients[client]; ok {
			delete(clients, client)
			close(client.send)

			// Clean up empty stream maps
			if len(clients) == 0 {
				delete(h.clients, client.streamID)
			}
		}
	}
}

// broadcastMessage sends a message to subscribed clients.
func (h *Hub) broadcastMessage(msg *streamMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	// Determine which stream this message belongs to
	streamID := msg.StreamID
	if streamID == "" {
		streamID = msg.RunID // Fall back to run_id
	}

	// Get message type for metrics/logging
	msgType := msg.Type
	if msgType == "" {
		msgType = "unknown"
	}

	// Send to global clients
	for client := range h.globalClients {
		h.sendToClient(client, msg.Raw, msgType)
	}

	// Send to stream-specific clients
	if streamID != "" {
		if clients, ok := h.clients[streamID]; ok {
			for client := range clients {
				h.sendToClient(client, msg.Raw, msgType)
			}
		}
	}
}

// sendToClient sends a message to a single client.
func (h *Hub) sendToClient(client *Client, message []byte, msgType string) {
	select {
	case client.send <- message:
		// Message sent successfully
	default:
		// Client buffer full - record metric and log with details
		metrics.WebSocketMessagesDropped.WithLabelValues(msgType).Inc()
		h.logger.Warn("client buffer full, dropping message",
			slog.String("stream_id", client.streamID),
			slog.String("message_type", msgType),
			slog.String("user", client.userEmail),
			slog.Int("message_size", len(message)),
		)
	}
}

// redisChannels are the pub/sub channels the hub subscribes to.
var redisChannels = []string{
	"stream:events",
	"orchestrator_ui_events",
	"mentatlab_streaming_events",
}

// subscribeToRedis subscribes to Redis pub/sub channels for events.
// On disconnection, it retries with exponential backoff (1s → 30s cap).
func (h *Hub) subscribeToRedis() {
	var attempt int
	for {
		select {
		case <-h.stopCh:
			return
		default:
		}

		if attempt > 0 {
			delay := redisBackoff(attempt)
			h.logger.Warn("reconnecting to Redis pub/sub",
				slog.Int("attempt", attempt),
				slog.Duration("delay", delay),
			)
			select {
			case <-time.After(delay):
			case <-h.stopCh:
				return
			}
		}

		err := h.runRedisSubscription()
		if err != nil {
			h.logger.Error("Redis subscription failed", slog.String("error", err.Error()))
			attempt++
			continue
		}

		// runRedisSubscription only returns nil on hub stop
		return
	}
}

// redisBackoff returns the delay for a reconnection attempt (1s, 2s, 4s, … capped at 30s).
func redisBackoff(attempt int) time.Duration {
	const maxDelay = 30 * time.Second
	delay := time.Duration(math.Pow(2, float64(attempt-1))) * time.Second
	if delay > maxDelay {
		delay = maxDelay
	}
	return delay
}

// runRedisSubscription performs one subscribe-and-read cycle.
// Returns nil only when stopCh is closed. Returns an error on any Redis failure.
func (h *Hub) runRedisSubscription() error {
	ctx := context.Background()

	pubsub := h.redisClient.Subscribe(ctx, redisChannels...)
	defer pubsub.Close()

	// Wait for subscription confirmation
	if _, err := pubsub.Receive(ctx); err != nil {
		return err
	}

	h.logger.Info("subscribed to Redis channels", slog.Any("channels", redisChannels))

	ch := pubsub.Channel()

	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return fmt.Errorf("Redis channel closed unexpectedly")
			}

			// Parse message to extract stream_id
			var streamMsg streamMessage
			if err := json.Unmarshal([]byte(msg.Payload), &streamMsg); err != nil {
				// If parsing fails, broadcast to all
				streamMsg = streamMessage{Raw: []byte(msg.Payload)}
			} else {
				streamMsg.Raw = []byte(msg.Payload)
			}

			// Send to message handler
			select {
			case h.messages <- &streamMsg:
			default:
				h.logger.Warn("message queue full, dropping message")
			}

		case <-h.stopCh:
			return nil
		}
	}
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	count := len(h.globalClients)
	for _, clients := range h.clients {
		count += len(clients)
	}
	return count
}

// RedisHealthy checks if Redis connection is healthy.
func (h *Hub) RedisHealthy(ctx context.Context) bool {
	return h.redisClient.Ping(ctx).Err() == nil
}

// ServeWs handles websocket requests from the peer.
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request, streamID string) {
	// Validate authentication before upgrading connection
	var userEmail, userType string
	if hub.authValidator != nil {
		var err error
		userEmail, userType, err = hub.authValidator(r)
		if err != nil {
			hub.logger.Warn("websocket auth failed",
				slog.String("error", err.Error()),
				slog.String("stream_id", streamID),
				slog.String("remote_addr", r.RemoteAddr),
			)
			middleware.RespondErrorWithDetails(w, r, http.StatusUnauthorized, middleware.ErrCodeAuthRequired, "WebSocket authentication failed", map[string]interface{}{
				"stream_id": streamID,
				"reason":    err.Error(),
			})
			return
		}
	}

	// Configure origin validation
	upgrader.CheckOrigin = func(r *http.Request) bool {
		origin := r.Header.Get("Origin")

		// If no origin header (same-origin request), allow
		if origin == "" {
			return true
		}

		// If no allowed origins configured, allow all (with warning logged at startup)
		if len(hub.allowedOrigins) == 0 {
			return true
		}

		// Check if origin is in allowed list or if wildcard is configured
		if hub.allowedOrigins["*"] || hub.allowedOrigins[origin] {
			return true
		}

		hub.logger.Warn("websocket origin rejected",
			slog.String("origin", origin),
			slog.String("stream_id", streamID),
			slog.String("user", userEmail),
		)
		return false
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		hub.logger.Error("websocket upgrade failed", slog.String("error", err.Error()))
		return
	}

	client := &Client{
		hub:       hub,
		conn:      conn,
		send:      make(chan []byte, 256),
		streamID:  streamID,
		userEmail: userEmail,
		userType:  userType,
	}
	client.hub.register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}
