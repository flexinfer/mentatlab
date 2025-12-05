package hub

import (
	"context"
	"log"
	"net/http"

	"github.com/redis/go-redis/v9"
)

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	// Registered clients.
	clients map[*Client]bool

	// Inbound messages from the clients.
	broadcast chan []byte

	// Register requests from the clients.
	register chan *Client

	// Unregister requests from clients.
	unregister chan *Client

	// Redis client for subscribing to updates
	redisClient *redis.Client
}

func NewHub(redisAddr string) *Hub {
	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	return &Hub{
		broadcast:   make(chan []byte),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		clients:     make(map[*Client]bool),
		redisClient: rdb,
	}
}

func (h *Hub) Run() {
	// Start Redis subscriber
	go h.subscribeToRedis()

	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
		case message := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

func (h *Hub) subscribeToRedis() {
	ctx := context.Background()
	// Subscribe to a pattern or specific channel.
	// For now, let's assume we subscribe to "stream:events" which carries all stream events.
	// In a real scenario, we might want to subscribe to specific channels based on client interest,
	// but for simplicity (and given the Python implementation broadcasted everything), we'll start with a global subscription.
	pubsub := h.redisClient.Subscribe(ctx, "stream:events")
	defer pubsub.Close()

	ch := pubsub.Channel()

	for msg := range ch {
		// Broadcast the message to all connected clients
		// In a more advanced version, we would filter by streamID here.
		h.broadcast <- []byte(msg.Payload)
	}
}

// ServeWs handles websocket requests from the peer.
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request, streamID string) {
	upgrader.CheckOrigin = func(r *http.Request) bool { return true } // Allow all origins for now
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256), streamID: streamID}
	client.hub.register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}
