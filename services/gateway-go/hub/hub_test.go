package hub

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// testLogger returns a silent logger for tests.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(&discardWriter{}, nil))
}

type discardWriter struct{}

func (d *discardWriter) Write(p []byte) (n int, err error) {
	return len(p), nil
}

func TestNewHub(t *testing.T) {
	hub := NewHub("localhost:6379")
	if hub == nil {
		t.Fatal("NewHub returned nil")
	}
	if hub.clients == nil {
		t.Error("clients map not initialized")
	}
	if hub.globalClients == nil {
		t.Error("globalClients map not initialized")
	}
	if hub.messages == nil {
		t.Error("messages channel not initialized")
	}
}

func TestNewHubWithConfig(t *testing.T) {
	logger := testLogger()
	hub := NewHubWithConfig(&HubConfig{
		RedisAddr: "localhost:6379",
		Logger:    logger,
	})
	if hub == nil {
		t.Fatal("NewHubWithConfig returned nil")
	}
	if hub.logger != logger {
		t.Error("logger not set correctly")
	}
}

func TestHubClientRegistration(t *testing.T) {
	hub := NewHubWithConfig(&HubConfig{
		RedisAddr: "localhost:6379",
		Logger:    testLogger(),
	})

	// Start hub in background (will stop when we close stopCh)
	go func() {
		for {
			select {
			case client := <-hub.register:
				hub.registerClient(client)
			case client := <-hub.unregister:
				hub.unregisterClient(client)
			case <-hub.stopCh:
				return
			}
		}
	}()
	defer hub.Stop()

	t.Run("register stream-specific client", func(t *testing.T) {
		client := &Client{
			hub:      hub,
			send:     make(chan []byte, 256),
			streamID: "stream-123",
		}

		hub.register <- client
		time.Sleep(10 * time.Millisecond) // Allow registration to process

		hub.mu.RLock()
		defer hub.mu.RUnlock()

		if _, ok := hub.clients["stream-123"]; !ok {
			t.Error("client not registered to stream")
		}
		if len(hub.clients["stream-123"]) != 1 {
			t.Errorf("expected 1 client in stream, got %d", len(hub.clients["stream-123"]))
		}
	})

	t.Run("register global client with wildcard", func(t *testing.T) {
		client := &Client{
			hub:      hub,
			send:     make(chan []byte, 256),
			streamID: "*",
		}

		hub.register <- client
		time.Sleep(10 * time.Millisecond)

		hub.mu.RLock()
		defer hub.mu.RUnlock()

		if _, ok := hub.globalClients[client]; !ok {
			t.Error("global client not registered")
		}
	})

	t.Run("register global client with empty stream", func(t *testing.T) {
		client := &Client{
			hub:      hub,
			send:     make(chan []byte, 256),
			streamID: "",
		}

		hub.register <- client
		time.Sleep(10 * time.Millisecond)

		hub.mu.RLock()
		defer hub.mu.RUnlock()

		if _, ok := hub.globalClients[client]; !ok {
			t.Error("empty stream client not registered as global")
		}
	})
}

func TestHubClientUnregistration(t *testing.T) {
	hub := NewHubWithConfig(&HubConfig{
		RedisAddr: "localhost:6379",
		Logger:    testLogger(),
	})

	go func() {
		for {
			select {
			case client := <-hub.register:
				hub.registerClient(client)
			case client := <-hub.unregister:
				hub.unregisterClient(client)
			case <-hub.stopCh:
				return
			}
		}
	}()
	defer hub.Stop()

	t.Run("unregister stream client", func(t *testing.T) {
		client := &Client{
			hub:      hub,
			send:     make(chan []byte, 256),
			streamID: "stream-456",
		}

		hub.register <- client
		time.Sleep(10 * time.Millisecond)

		hub.unregister <- client
		time.Sleep(10 * time.Millisecond)

		hub.mu.RLock()
		defer hub.mu.RUnlock()

		if _, ok := hub.clients["stream-456"]; ok {
			t.Error("stream should be cleaned up when empty")
		}
	})

	t.Run("unregister global client", func(t *testing.T) {
		client := &Client{
			hub:      hub,
			send:     make(chan []byte, 256),
			streamID: "*",
		}

		hub.register <- client
		time.Sleep(10 * time.Millisecond)

		hub.unregister <- client
		time.Sleep(10 * time.Millisecond)

		hub.mu.RLock()
		defer hub.mu.RUnlock()

		if _, ok := hub.globalClients[client]; ok {
			t.Error("global client should be unregistered")
		}
	})
}

func TestHubBroadcastMessage(t *testing.T) {
	hub := NewHubWithConfig(&HubConfig{
		RedisAddr: "localhost:6379",
		Logger:    testLogger(),
	})

	t.Run("broadcast to stream-specific clients", func(t *testing.T) {
		client1 := &Client{
			hub:      hub,
			send:     make(chan []byte, 256),
			streamID: "stream-789",
		}
		client2 := &Client{
			hub:      hub,
			send:     make(chan []byte, 256),
			streamID: "stream-other",
		}

		hub.registerClient(client1)
		hub.registerClient(client2)
		defer func() {
			hub.unregisterClient(client1)
			hub.unregisterClient(client2)
		}()

		msg := &streamMessage{
			StreamID: "stream-789",
			Raw:      []byte(`{"event": "test"}`),
		}

		hub.broadcastMessage(msg)

		// client1 should receive message
		select {
		case received := <-client1.send:
			if string(received) != `{"event": "test"}` {
				t.Errorf("unexpected message: %s", received)
			}
		case <-time.After(100 * time.Millisecond):
			t.Error("client1 should have received message")
		}

		// client2 should NOT receive message
		select {
		case <-client2.send:
			t.Error("client2 should not have received message")
		case <-time.After(50 * time.Millisecond):
			// Expected - no message
		}
	})

	t.Run("broadcast to global clients", func(t *testing.T) {
		globalClient := &Client{
			hub:      hub,
			send:     make(chan []byte, 256),
			streamID: "*",
		}

		hub.registerClient(globalClient)
		defer hub.unregisterClient(globalClient)

		msg := &streamMessage{
			StreamID: "any-stream",
			Raw:      []byte(`{"event": "global"}`),
		}

		hub.broadcastMessage(msg)

		select {
		case received := <-globalClient.send:
			if string(received) != `{"event": "global"}` {
				t.Errorf("unexpected message: %s", received)
			}
		case <-time.After(100 * time.Millisecond):
			t.Error("global client should have received message")
		}
	})

	t.Run("broadcast with run_id fallback", func(t *testing.T) {
		client := &Client{
			hub:      hub,
			send:     make(chan []byte, 256),
			streamID: "run-123",
		}

		hub.registerClient(client)
		defer hub.unregisterClient(client)

		// Message with run_id but no stream_id
		msg := &streamMessage{
			RunID: "run-123",
			Raw:   []byte(`{"event": "fallback"}`),
		}

		hub.broadcastMessage(msg)

		select {
		case received := <-client.send:
			if string(received) != `{"event": "fallback"}` {
				t.Errorf("unexpected message: %s", received)
			}
		case <-time.After(100 * time.Millisecond):
			t.Error("client should have received message via run_id")
		}
	})
}

func TestHubClientCount(t *testing.T) {
	hub := NewHubWithConfig(&HubConfig{
		RedisAddr: "localhost:6379",
		Logger:    testLogger(),
	})

	if hub.ClientCount() != 0 {
		t.Error("initial client count should be 0")
	}

	client1 := &Client{hub: hub, send: make(chan []byte, 256), streamID: "s1"}
	client2 := &Client{hub: hub, send: make(chan []byte, 256), streamID: "s2"}
	globalClient := &Client{hub: hub, send: make(chan []byte, 256), streamID: "*"}

	hub.registerClient(client1)
	hub.registerClient(client2)
	hub.registerClient(globalClient)

	if count := hub.ClientCount(); count != 3 {
		t.Errorf("expected 3 clients, got %d", count)
	}

	hub.unregisterClient(client1)

	if count := hub.ClientCount(); count != 2 {
		t.Errorf("expected 2 clients after unregister, got %d", count)
	}
}

func TestStreamMessageParsing(t *testing.T) {
	tests := []struct {
		name     string
		payload  string
		streamID string
		runID    string
	}{
		{
			name:     "with stream_id",
			payload:  `{"stream_id": "abc123", "type": "event"}`,
			streamID: "abc123",
		},
		{
			name:    "with run_id",
			payload: `{"run_id": "run-456", "type": "event"}`,
			runID:   "run-456",
		},
		{
			name:     "with both",
			payload:  `{"stream_id": "stream-1", "run_id": "run-1", "type": "event"}`,
			streamID: "stream-1",
			runID:    "run-1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var msg streamMessage
			if err := json.Unmarshal([]byte(tt.payload), &msg); err != nil {
				t.Fatalf("failed to parse: %v", err)
			}

			if msg.StreamID != tt.streamID {
				t.Errorf("expected stream_id %q, got %q", tt.streamID, msg.StreamID)
			}
			if msg.RunID != tt.runID {
				t.Errorf("expected run_id %q, got %q", tt.runID, msg.RunID)
			}
		})
	}
}

func TestServeWs(t *testing.T) {
	hub := NewHubWithConfig(&HubConfig{
		RedisAddr: "localhost:6379",
		Logger:    testLogger(),
	})

	// Start a simplified hub loop
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case client := <-hub.register:
				hub.registerClient(client)
			case client := <-hub.unregister:
				hub.unregisterClient(client)
			case <-hub.stopCh:
				return
			}
		}
	}()

	// Create test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract stream_id from path
		parts := strings.Split(r.URL.Path, "/")
		streamID := parts[len(parts)-1]
		ServeWs(hub, w, r, streamID)
	}))
	defer server.Close()

	// Connect WebSocket client
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/streams/test-stream"
	ws, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect: %v (response: %v)", err, resp)
	}
	defer ws.Close()

	// Give time for registration
	time.Sleep(50 * time.Millisecond)

	// Verify client was registered
	if hub.ClientCount() != 1 {
		t.Errorf("expected 1 client, got %d", hub.ClientCount())
	}

	// Verify it's registered to correct stream
	hub.mu.RLock()
	if _, ok := hub.clients["test-stream"]; !ok {
		t.Error("client not registered to test-stream")
	}
	hub.mu.RUnlock()

	// Close and verify cleanup
	ws.Close()
	time.Sleep(100 * time.Millisecond)

	hub.Stop()
	wg.Wait()
}

func TestRedisHealthy(t *testing.T) {
	hub := NewHubWithConfig(&HubConfig{
		RedisAddr: "localhost:6379", // May not be running
		Logger:    testLogger(),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Just test it doesn't panic - actual result depends on Redis availability
	_ = hub.RedisHealthy(ctx)
}

func TestAllowedOriginsConfiguration(t *testing.T) {
	t.Run("no origins configured allows all", func(t *testing.T) {
		hub := NewHubWithConfig(&HubConfig{
			RedisAddr:      "localhost:6379",
			Logger:         testLogger(),
			AllowedOrigins: nil,
		})
		if len(hub.allowedOrigins) != 0 {
			t.Error("expected empty allowed origins map")
		}
	})

	t.Run("origins are stored in map", func(t *testing.T) {
		hub := NewHubWithConfig(&HubConfig{
			RedisAddr:      "localhost:6379",
			Logger:         testLogger(),
			AllowedOrigins: []string{"https://app.example.com", "https://admin.example.com"},
		})
		if len(hub.allowedOrigins) != 2 {
			t.Errorf("expected 2 allowed origins, got %d", len(hub.allowedOrigins))
		}
		if !hub.allowedOrigins["https://app.example.com"] {
			t.Error("expected https://app.example.com to be allowed")
		}
		if !hub.allowedOrigins["https://admin.example.com"] {
			t.Error("expected https://admin.example.com to be allowed")
		}
	})

	t.Run("wildcard origin", func(t *testing.T) {
		hub := NewHubWithConfig(&HubConfig{
			RedisAddr:      "localhost:6379",
			Logger:         testLogger(),
			AllowedOrigins: []string{"*"},
		})
		if !hub.allowedOrigins["*"] {
			t.Error("expected wildcard to be in allowed origins")
		}
	})
}

func TestWebSocketAuthentication(t *testing.T) {
	t.Run("auth validator called when configured", func(t *testing.T) {
		validatorCalled := false
		hub := NewHubWithConfig(&HubConfig{
			RedisAddr: "localhost:6379",
			Logger:    testLogger(),
			AuthValidator: func(r *http.Request) (string, string, error) {
				validatorCalled = true
				return "test@example.com", "user", nil
			},
		})

		go func() {
			for {
				select {
				case client := <-hub.register:
					hub.registerClient(client)
				case client := <-hub.unregister:
					hub.unregisterClient(client)
				case <-hub.stopCh:
					return
				}
			}
		}()
		defer hub.Stop()

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ServeWs(hub, w, r, "test-stream")
		}))
		defer server.Close()

		wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/streams/test-stream"
		ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			t.Fatalf("failed to connect: %v", err)
		}
		defer ws.Close()

		if !validatorCalled {
			t.Error("auth validator should have been called")
		}
	})

	t.Run("auth failure rejects connection", func(t *testing.T) {
		hub := NewHubWithConfig(&HubConfig{
			RedisAddr: "localhost:6379",
			Logger:    testLogger(),
			AuthValidator: func(r *http.Request) (string, string, error) {
				return "", "", errors.New("authentication required")
			},
		})
		defer hub.Stop()

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ServeWs(hub, w, r, "test-stream")
		}))
		defer server.Close()

		wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/streams/test-stream"
		_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err == nil {
			t.Error("expected connection to fail due to auth")
		}
		if resp != nil && resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("expected 401 status, got %d", resp.StatusCode)
		}
	})

	t.Run("user info stored in client", func(t *testing.T) {
		hub := NewHubWithConfig(&HubConfig{
			RedisAddr: "localhost:6379",
			Logger:    testLogger(),
			AuthValidator: func(r *http.Request) (string, string, error) {
				return "alice@example.com", "user", nil
			},
		})

		go func() {
			for {
				select {
				case client := <-hub.register:
					hub.registerClient(client)
				case client := <-hub.unregister:
					hub.unregisterClient(client)
				case <-hub.stopCh:
					return
				}
			}
		}()
		defer hub.Stop()

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ServeWs(hub, w, r, "test-stream")
		}))
		defer server.Close()

		wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/streams/test-stream"
		ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			t.Fatalf("failed to connect: %v", err)
		}
		defer ws.Close()

		time.Sleep(50 * time.Millisecond)

		hub.mu.RLock()
		defer hub.mu.RUnlock()

		clients := hub.clients["test-stream"]
		if len(clients) != 1 {
			t.Fatalf("expected 1 client, got %d", len(clients))
		}

		for client := range clients {
			if client.userEmail != "alice@example.com" {
				t.Errorf("expected user email 'alice@example.com', got '%s'", client.userEmail)
			}
			if client.userType != "user" {
				t.Errorf("expected user type 'user', got '%s'", client.userType)
			}
		}
	})

	t.Run("no auth validator allows all", func(t *testing.T) {
		hub := NewHubWithConfig(&HubConfig{
			RedisAddr:     "localhost:6379",
			Logger:        testLogger(),
			AuthValidator: nil, // No auth configured
		})

		go func() {
			for {
				select {
				case client := <-hub.register:
					hub.registerClient(client)
				case client := <-hub.unregister:
					hub.unregisterClient(client)
				case <-hub.stopCh:
					return
				}
			}
		}()
		defer hub.Stop()

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ServeWs(hub, w, r, "test-stream")
		}))
		defer server.Close()

		wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/streams/test-stream"
		ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			t.Errorf("connection should succeed without auth validator: %v", err)
		}
		if ws != nil {
			ws.Close()
		}
	})
}

func TestWebSocketOriginValidation(t *testing.T) {
	tests := []struct {
		name           string
		allowedOrigins []string
		requestOrigin  string
		shouldConnect  bool
	}{
		{
			name:           "no origins configured allows any",
			allowedOrigins: nil,
			requestOrigin:  "https://evil.com",
			shouldConnect:  true,
		},
		{
			name:           "allowed origin connects",
			allowedOrigins: []string{"https://app.example.com"},
			requestOrigin:  "https://app.example.com",
			shouldConnect:  true,
		},
		{
			name:           "disallowed origin rejected",
			allowedOrigins: []string{"https://app.example.com"},
			requestOrigin:  "https://evil.com",
			shouldConnect:  false,
		},
		{
			name:           "wildcard allows any",
			allowedOrigins: []string{"*"},
			requestOrigin:  "https://any.domain.com",
			shouldConnect:  true,
		},
		{
			name:           "no origin header same-origin allowed",
			allowedOrigins: []string{"https://app.example.com"},
			requestOrigin:  "",
			shouldConnect:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hub := NewHubWithConfig(&HubConfig{
				RedisAddr:      "localhost:6379",
				Logger:         testLogger(),
				AllowedOrigins: tt.allowedOrigins,
			})

			// Start hub loop
			go func() {
				for {
					select {
					case client := <-hub.register:
						hub.registerClient(client)
					case client := <-hub.unregister:
						hub.unregisterClient(client)
					case <-hub.stopCh:
						return
					}
				}
			}()
			defer hub.Stop()

			// Create test server
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ServeWs(hub, w, r, "test-stream")
			}))
			defer server.Close()

			// Prepare WebSocket dial with origin header
			wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/streams/test-stream"
			dialer := websocket.Dialer{}
			header := http.Header{}
			if tt.requestOrigin != "" {
				header.Set("Origin", tt.requestOrigin)
			}

			ws, _, err := dialer.Dial(wsURL, header)
			connected := err == nil

			if connected != tt.shouldConnect {
				t.Errorf("expected connect=%v, got %v (err=%v)", tt.shouldConnect, connected, err)
			}

			if ws != nil {
				ws.Close()
			}
		})
	}
}
