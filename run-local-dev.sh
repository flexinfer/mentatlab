#!/bin/bash

# Local Development Build and Run Script
# Starts Go gateway, Go orchestrator, Redis, and frontend for local development

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}Starting Mentat Lab Local Development Environment...${NC}"
echo "============================================="

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${RED}✗ Port $port is already in use${NC}"
        return 1
    fi
    echo -e "${GREEN}✓ Port $port is available${NC}"
    return 0
}

# Function to wait for a service to be ready
wait_for_service() {
    local service_name=$1
    local url=$2
    local max_attempts=30
    local attempt=0

    echo -e "${YELLOW}Waiting for $service_name to be ready...${NC}"
    while [ $attempt -lt $max_attempts ]; do
        if curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null | grep -qE "^[23][0-9]{2}$"; then
            echo -e "${GREEN}✓ $service_name is ready!${NC}"
            return 0
        fi
        printf "."
        sleep 1
        attempt=$((attempt + 1))
    done
    echo ""
    echo -e "${RED}✗ $service_name failed to start after $max_attempts seconds${NC}"
    return 1
}

# Kill function to cleanup processes
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    jobs -p | xargs -r kill 2>/dev/null || true
    lsof -ti:8080 | xargs -r kill 2>/dev/null || true
    lsof -ti:7070 | xargs -r kill 2>/dev/null || true
    lsof -ti:5173 | xargs -r kill 2>/dev/null || true
    echo -e "${GREEN}✓ All services stopped${NC}"
}

trap cleanup EXIT INT TERM

# Check required tools
echo -e "\n${BLUE}=== Checking Prerequisites ===${NC}"

if ! command -v go >/dev/null 2>&1; then
    echo -e "${RED}✗ Go is required but not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Go $(go version | awk '{print $3}')${NC}"

if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}✗ Node.js is required but not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node $(node --version)${NC}"

# Check required ports
echo -e "\n${BLUE}=== Checking Port Availability ===${NC}"
PORTS_OK=true
if ! check_port 7070; then
    echo "  Orchestrator service requires port 7070"
    PORTS_OK=false
fi
if ! check_port 8080; then
    echo "  Gateway service requires port 8080"
    PORTS_OK=false
fi
if ! check_port 5173; then
    echo "  Frontend service requires port 5173"
    PORTS_OK=false
fi

if [ "$PORTS_OK" = false ]; then
    echo -e "${RED}Please free up the required ports before running this script${NC}"
    echo "You can stop services using: lsof -ti:PORT | xargs kill"
    exit 1
fi

# Install frontend dependencies
echo -e "\n${BLUE}=== Installing Dependencies ===${NC}"

echo -e "${YELLOW}Installing frontend npm dependencies...${NC}"
(cd services/frontend && npm install --silent 2>&1 | tail -3)
echo -e "${GREEN}✓ Frontend dependencies installed${NC}"

echo -e "${YELLOW}Downloading Go module dependencies...${NC}"
(cd services/orchestrator-go && go mod download) &
(cd services/gateway-go && go mod download) &
wait
echo -e "${GREEN}✓ Go dependencies downloaded${NC}"

# Create logs directory
mkdir -p logs

# Start services
echo -e "\n${BLUE}=== Starting Services ===${NC}"

# Start Orchestrator (Go, port 7070)
echo -e "\n${YELLOW}Starting Go Orchestrator on port 7070...${NC}"
(cd services/orchestrator-go && go run ./cmd/orchestrator/) > logs/orchestrator.log 2>&1 &
ORCHESTRATOR_PID=$!

# Start Gateway (Go, port 8080)
echo -e "${YELLOW}Starting Go Gateway on port 8080...${NC}"
(cd services/gateway-go && go run main.go) > logs/gateway.log 2>&1 &
GATEWAY_PID=$!

# Start Frontend (port 5173)
echo -e "${YELLOW}Starting Frontend on port 5173...${NC}"
(cd services/frontend && \
    VITE_GATEWAY_URL="http://127.0.0.1:8080" \
    VITE_GATEWAY_BASE_URL="http://127.0.0.1:8080" \
    VITE_ORCHESTRATOR_URL="http://127.0.0.1:7070" \
    VITE_API_URL="http://127.0.0.1:7070" \
    VITE_WS_URL="ws://127.0.0.1:8080" \
    VITE_CONNECT_WS="true" \
    npm run dev) > logs/frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait for services to be ready
echo -e "\n${BLUE}=== Waiting for Services to Start ===${NC}"

wait_for_service "Orchestrator" "http://localhost:7070/healthz" || \
    wait_for_service "Orchestrator (fallback)" "http://localhost:7070/"

wait_for_service "Gateway" "http://localhost:8080/healthz" || \
    wait_for_service "Gateway (fallback)" "http://localhost:8080/"

wait_for_service "Frontend" "http://localhost:5173"

# Display service status
echo -e "\n${GREEN}=====================================${NC}"
echo -e "${GREEN}   All Services Running!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo -e "${BLUE}Service URLs:${NC}"
echo "  Gateway:      http://localhost:8080"
echo "  Orchestrator: http://localhost:7070"
echo "  Frontend:     http://localhost:5173"
echo ""
echo -e "${BLUE}Logs:${NC}"
echo "  Gateway:      tail -f logs/gateway.log"
echo "  Orchestrator: tail -f logs/orchestrator.log"
echo "  Frontend:     tail -f logs/frontend.log"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

# Keep script running, check service health
while true; do
    sleep 5
    if ! kill -0 $ORCHESTRATOR_PID 2>/dev/null; then
        echo -e "${RED}Orchestrator stopped unexpectedly! Check logs/orchestrator.log${NC}"
    fi
    if ! kill -0 $GATEWAY_PID 2>/dev/null; then
        echo -e "${RED}Gateway stopped unexpectedly! Check logs/gateway.log${NC}"
    fi
    if ! kill -0 $FRONTEND_PID 2>/dev/null; then
        echo -e "${RED}Frontend stopped unexpectedly! Check logs/frontend.log${NC}"
    fi
done
