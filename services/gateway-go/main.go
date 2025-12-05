package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"

	"github.com/flexinfer/mentatlab/services/gateway-go/hub"

	"github.com/gorilla/mux"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	orchURLStr := os.Getenv("ORCHESTRATOR_BASE_URL")
	if orchURLStr == "" {
		orchURLStr = "http://localhost:7070"
	}

	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}

	orchURL, err := url.Parse(orchURLStr)
	if err != nil {
		log.Fatalf("Invalid orchestrator URL: %v", err)
	}

	// Initialize Hub
	wsHub := hub.NewHub(redisAddr)
	go wsHub.Run()

	r := mux.NewRouter()

	// Health check
	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// WebSocket endpoint
	r.HandleFunc("/ws/streams/{stream_id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		streamID := vars["stream_id"]
		hub.ServeWs(wsHub, w, r, streamID)
	})

	// Reverse Proxy for API requests
	proxy := httputil.NewSingleHostReverseProxy(orchURL)
	r.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("Proxying request: %s %s", r.Method, r.URL.Path)
		proxy.ServeHTTP(w, r)
	})

	// CORS Middleware
	r.Use(mux.CORSMethodMiddleware(r))
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	log.Printf("Gateway (Go) listening on port %s", port)
	log.Printf("Proxying to Orchestrator: %s", orchURLStr)
	log.Printf("Redis: %s", redisAddr)

	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
