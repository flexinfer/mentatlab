#!/bin/bash

# Quick Start Script - Minimal setup to run core services
# For full setup with dependency installation, use run-local-dev.sh

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Quick Start - Mentat Lab Services${NC}"
echo "================================="

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Stopping services...${NC}"
    jobs -p | xargs -r kill 2>/dev/null || true
    lsof -ti:8080 | xargs -r kill 2>/dev/null || true
    lsof -ti:7070 | xargs -r kill 2>/dev/null || true
    lsof -ti:5173 | xargs -r kill 2>/dev/null || true
    echo -e "${GREEN}Services stopped${NC}"
}

trap cleanup EXIT INT TERM

# Start Orchestrator (Go, port 7070)
echo -e "${YELLOW}Starting Orchestrator (port 7070)...${NC}"
(cd services/orchestrator-go && go run ./cmd/orchestrator/) &

# Start Gateway (Go, port 8080)
echo -e "${YELLOW}Starting Gateway (port 8080)...${NC}"
(cd services/gateway-go && go run main.go) &

# Start Frontend (port 5173)
echo -e "${YELLOW}Starting Frontend (port 5173)...${NC}"
(cd services/frontend && npm run dev) &

echo -e "\n${GREEN}Services starting...${NC}"
echo "  Gateway:      http://localhost:8080"
echo "  Orchestrator: http://localhost:7070"
echo "  Frontend:     http://localhost:5173"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"

# Keep running
wait
