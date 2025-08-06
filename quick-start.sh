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
    pkill -f "uvicorn.*8080" 2>/dev/null || true
    pkill -f "uvicorn.*8081" 2>/dev/null || true
    pkill -f "vite.*3000" 2>/dev/null || true
    echo -e "${GREEN}Services stopped${NC}"
}

trap cleanup EXIT INT TERM

# Start Gateway
echo -e "${YELLOW}Starting Gateway (port 8080)...${NC}"
(cd services/gateway && pdm run uvicorn app.main:app --port 8080 --reload) &

# Start Orchestrator
echo -e "${YELLOW}Starting Orchestrator (port 8081)...${NC}"
(cd services/orchestrator && pdm run uvicorn app.main:app --port 8081 --reload) &

# Start Frontend
echo -e "${YELLOW}Starting Frontend (port 3000)...${NC}"
(cd services/frontend && npm run dev) &

echo -e "\n${GREEN}Services starting...${NC}"
echo "Gateway:      http://localhost:8080/docs"
echo "Orchestrator: http://localhost:8081/docs"
echo "Frontend:     http://localhost:3000"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"

# Keep running
wait