#!/bin/bash

# Local Development Build and Run Script
# This script builds and runs all services locally for development testing

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Mentat Lab Local Development Environment...${NC}"
echo "============================================="

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${RED}Port $port is already in use${NC}"
        return 1
    fi
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
        if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200\|404"; then
            echo -e "${GREEN}$service_name is ready!${NC}"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    echo -e "${RED}$service_name failed to start${NC}"
    return 1
}

# Kill function to cleanup processes
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    
    # Kill all background processes started by this script
    jobs -p | xargs -r kill 2>/dev/null || true
    
    # Kill any remaining services on our ports
    lsof -ti:8080 | xargs -r kill 2>/dev/null || true
    lsof -ti:8081 | xargs -r kill 2>/dev/null || true
    lsof -ti:3000 | xargs -r kill 2>/dev/null || true
    lsof -ti:8082 | xargs -r kill 2>/dev/null || true
    
    echo -e "${GREEN}All services stopped${NC}"
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Check required ports
echo -e "\n${YELLOW}Checking port availability...${NC}"
PORTS_OK=true
if ! check_port 8080; then
    echo "Gateway service requires port 8080"
    PORTS_OK=false
fi
if ! check_port 8081; then
    echo "Orchestrator service requires port 8081"
    PORTS_OK=false
fi
if ! check_port 3000; then
    echo "Frontend service requires port 3000"
    PORTS_OK=false
fi
if ! check_port 8082; then
    echo "Echo agent service requires port 8082"
    PORTS_OK=false
fi

if [ "$PORTS_OK" = false ]; then
    echo -e "${RED}Please free up the required ports before running this script${NC}"
    exit 1
fi

# Install dependencies for each service
echo -e "\n${GREEN}Installing dependencies...${NC}"
echo "------------------------"

# Gateway
echo -e "${YELLOW}Setting up Gateway...${NC}"
cd services/gateway
if [ -f "pyproject.toml" ]; then
    pdm install
else
    echo -e "${RED}No pyproject.toml found for Gateway${NC}"
fi
cd ../..

# Orchestrator
echo -e "\n${YELLOW}Setting up Orchestrator...${NC}"
cd services/orchestrator
if [ -f "pyproject.toml" ]; then
    pdm install
else
    echo -e "${RED}No pyproject.toml found for Orchestrator${NC}"
fi
cd ../..

# Frontend
echo -e "\n${YELLOW}Setting up Frontend...${NC}"
cd services/frontend
if [ -f "package.json" ]; then
    npm install
else
    echo -e "${RED}No package.json found for Frontend${NC}"
fi
cd ../..

# Echo Agent
echo -e "\n${YELLOW}Setting up Echo Agent...${NC}"
cd services/agents/echo
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
else
    echo -e "${RED}No requirements.txt found for Echo Agent${NC}"
fi
cd ../../..

# Start services
echo -e "\n${GREEN}Starting services...${NC}"
echo "===================="

# Start Orchestrator (port 8081)
echo -e "\n${YELLOW}Starting Orchestrator on port 8081...${NC}"
cd services/orchestrator
pdm run uvicorn app.main:app --host 0.0.0.0 --port 8081 --reload > ../../logs/orchestrator.log 2>&1 &
ORCHESTRATOR_PID=$!
cd ../..

# Start Gateway (port 8080)
echo -e "\n${YELLOW}Starting Gateway on port 8080...${NC}"
cd services/gateway
pdm run uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload > ../../logs/gateway.log 2>&1 &
GATEWAY_PID=$!
cd ../..

# Start Echo Agent (port 8082)
echo -e "\n${YELLOW}Starting Echo Agent on port 8082...${NC}"
cd services/agents/echo
python app/main.py > ../../logs/echo-agent.log 2>&1 &
ECHO_AGENT_PID=$!
cd ../../..

# Start Frontend (port 3000)
echo -e "\n${YELLOW}Starting Frontend on port 3000...${NC}"
cd services/frontend
npm run dev > ../../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
cd ../..

# Wait for services to be ready
echo -e "\n${GREEN}Waiting for services to start...${NC}"
wait_for_service "Orchestrator" "http://localhost:8081/health"
wait_for_service "Gateway" "http://localhost:8080/healthz"
wait_for_service "Echo Agent" "http://localhost:8082/health"
wait_for_service "Frontend" "http://localhost:3000"

# Display service status
echo -e "\n${GREEN}=====================================${NC}"
echo -e "${GREEN}All services are running!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo "Service URLs:"
echo "  Gateway:      http://localhost:8080"
echo "  Orchestrator: http://localhost:8081"
echo "  Echo Agent:   http://localhost:8082"
echo "  Frontend:     http://localhost:3000"
echo ""
echo "API Documentation:"
echo "  Gateway API:      http://localhost:8080/docs"
echo "  Orchestrator API: http://localhost:8081/docs"
echo ""
echo "Logs are being written to:"
echo "  Gateway:      logs/gateway.log"
echo "  Orchestrator: logs/orchestrator.log"
echo "  Echo Agent:   logs/echo-agent.log"
echo "  Frontend:     logs/frontend.log"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Keep script running
while true; do
    sleep 1
done