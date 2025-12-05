package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/engine"

	"github.com/gorilla/mux"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "7070"
	}

	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}

	// Initialize Engine
	eng := engine.NewEngine(redisAddr)

	r := mux.NewRouter()

	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	r.HandleFunc("/api/v1/runs", func(w http.ResponseWriter, r *http.Request) {
		var graph engine.Graph
		if err := json.NewDecoder(r.Body).Decode(&graph); err != nil {
			// If no body, create a demo graph
			graph = engine.Graph{
				ID: "demo-graph",
				Nodes: []engine.Node{
					{ID: "Source", Type: "agent"},
					{ID: "Process", Type: "agent", Inputs: []string{"Source"}},
					{ID: "Sink", Type: "agent", Inputs: []string{"Process"}},
				},
			}
		}

		run, err := eng.StartRun(graph)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"run_id": run.ID,
			"status": string(run.Status),
		})
	}).Methods("POST")

	r.HandleFunc("/api/v1/runs/{id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		runID := vars["id"]
		run, ok := eng.GetRun(runID)
		if !ok {
			http.Error(w, "Run not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(run)
	}).Methods("GET")

	log.Printf("Orchestrator (Go) listening on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
