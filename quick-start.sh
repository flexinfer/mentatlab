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
    if command -v docker >/dev/null 2>&1; then
        if docker compose version >/dev/null 2>&1; then
            docker compose stop redis >/dev/null 2>&1 || true
        elif command -v docker-compose >/dev/null 2>&1; then
            docker-compose stop redis >/dev/null 2>&1 || true
        fi
    fi
    lsof -ti:8080 | xargs -r kill 2>/dev/null || true
    lsof -ti:7070 | xargs -r kill 2>/dev/null || true
    lsof -ti:5173 | xargs -r kill 2>/dev/null || true
    echo -e "${GREEN}Services stopped${NC}"
}

trap cleanup EXIT INT TERM

wait_for_port() {
    local service_name=$1
    local host=$2
    local port=$3
    local max_attempts=30
    local attempt=0

    echo -e "${YELLOW}Waiting for $service_name on $host:$port...${NC}"
    while [ $attempt -lt $max_attempts ]; do
        if (echo > "/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
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

mkdir -p logs

echo -e "\n${YELLOW}Starting Redis (port 6379)...${NC}"
if lsof -Pi :6379 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    if command -v redis-cli >/dev/null 2>&1; then
        if redis-cli -h 127.0.0.1 -p 6379 PING >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Redis already listening on port 6379${NC}"
        else
            echo -e "${RED}✗ Port 6379 is in use but it does not look like Redis${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}✓ Redis already listening on port 6379${NC}"
    fi
else
    if command -v docker >/dev/null 2>&1; then
        if docker compose version >/dev/null 2>&1; then
            docker compose up -d redis
        elif command -v docker-compose >/dev/null 2>&1; then
            docker-compose up -d redis
        else
            echo -e "${RED}✗ Docker Compose is not available${NC}"
            exit 1
        fi
    elif command -v redis-server >/dev/null 2>&1; then
        (redis-server --bind 127.0.0.1 --port 6379 --save "" --appendonly no) > logs/redis.log 2>&1 &
    else
        echo -e "${RED}✗ Neither Docker Compose nor redis-server is available to start Redis${NC}"
        exit 1
    fi

    if ! wait_for_port "Redis" "127.0.0.1" "6379"; then
        echo -e "${RED}✗ Redis failed to start${NC}"
        exit 1
    fi
fi

# Start Orchestrator (Go, port 7070)
echo -e "${YELLOW}Starting Orchestrator (port 7070)...${NC}"
(cd services/orchestrator-go && ORCH_RUNSTORE="${ORCH_RUNSTORE:-redis}" REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}" go run ./cmd/orchestrator/) &

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
