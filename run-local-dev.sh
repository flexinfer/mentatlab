#!/bin/bash

# Local Development Build and Run Script
# This script builds and runs all services locally for development testing

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Mentat Lab Local Development Environment...${NC}"
echo "============================================="

# Detect pdm availability
if command -v pdm >/dev/null 2>&1; then
    PDM_AVAILABLE=true
    echo -e "${GREEN}✓ pdm detected${NC}"
else
    PDM_AVAILABLE=false
    echo -e "${YELLOW}⚠ pdm not found - some features may be limited${NC}"
fi

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

# Function to wait for a service to be ready with better health checks
wait_for_service() {
    local service_name=$1
    local url=$2
    local max_attempts=30
    local attempt=0
    
    echo -e "${YELLOW}⏳ Waiting for $service_name to be ready...${NC}"
    while [ $attempt -lt $max_attempts ]; do
        # More robust health check: accept 200, 404 (for root), or any 2xx/3xx response
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
    
    # Kill all background processes started by this script
    jobs -p | xargs -r kill 2>/dev/null || true
    
    # Kill any remaining services on our ports
    lsof -ti:8080 | xargs -r kill 2>/dev/null || true
    lsof -ti:8081 | xargs -r kill 2>/dev/null || true
    lsof -ti:5173 | xargs -r kill 2>/dev/null || true
    
    # Clean up any temp files
    rm -f /tmp/mentat_manifest_*.json /tmp/mentat_schedule_*.json 2>/dev/null || true
    
    echo -e "${GREEN}✓ All services stopped${NC}"
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Check required ports
echo -e "\n${BLUE}=== Checking Port Availability ===${NC}"
PORTS_OK=true
if ! check_port 8080; then
    echo "  Gateway service requires port 8080"
    PORTS_OK=false
fi
if ! check_port 8081; then
    echo "  Orchestrator service requires port 8081"
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

# Install Python dependencies for manifest conversion
echo -e "\n${BLUE}=== Checking Python Dependencies ===${NC}"

# Function to ensure PyYAML is available
ensure_pyyaml() {
    # First try with system python3
    if python3 -c "import yaml" 2>/dev/null; then
        echo -e "${GREEN}✓ PyYAML is available in system Python${NC}"
        return 0
    fi
    
    # Try installing PyYAML
    echo -e "${YELLOW}Installing PyYAML...${NC}"
    if pip3 install --user PyYAML >/dev/null 2>&1; then
        echo -e "${GREEN}✓ PyYAML installed successfully${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}⚠ PyYAML not available - will use JSON fallback${NC}"
    return 1
}

ensure_pyyaml
PYYAML_AVAILABLE=$?

# Install dependencies for each service
echo -e "\n${BLUE}=== Installing Service Dependencies ===${NC}"

# Gateway
echo -e "\n${YELLOW}Setting up Gateway...${NC}"
cd services/gateway
if [ -f "pyproject.toml" ]; then
    if [ "$PDM_AVAILABLE" = true ]; then
        echo "  Installing dependencies with pdm..."
        pdm install --no-lock 2>&1 | tail -3
        
        # Ensure redis is available
        if ! pdm run python -c "import redis" 2>/dev/null; then
            echo "  Adding redis dependency..."
            pdm add "redis>=4.7.1" --no-lock >/dev/null 2>&1 || true
        fi
        echo -e "${GREEN}  ✓ Gateway dependencies installed${NC}"
    else
        echo -e "${YELLOW}  ⚠ Skipping pdm install (pdm not available)${NC}"
    fi
fi
cd ../..

# Orchestrator
echo -e "\n${YELLOW}Setting up Orchestrator...${NC}"
cd services/orchestrator
if [ -f "pyproject.toml" ]; then
    if [ "$PDM_AVAILABLE" = true ]; then
        echo "  Installing dependencies with pdm..."
        pdm install --no-lock 2>&1 | tail -3
        
        # Ensure PyYAML is available in orchestrator's pdm environment
        if ! pdm run python -c "import yaml" 2>/dev/null; then
            echo "  Adding PyYAML dependency..."
            pdm add PyYAML --no-lock >/dev/null 2>&1 || true
        fi
        echo -e "${GREEN}  ✓ Orchestrator dependencies installed${NC}"
    else
        echo -e "${YELLOW}  ⚠ Skipping pdm install (pdm not available)${NC}"
    fi
fi
cd ../..

# Frontend
echo -e "\n${YELLOW}Setting up Frontend...${NC}"
cd services/frontend
if [ -f "package.json" ]; then
    echo "  Installing npm dependencies..."
    npm install --silent 2>&1 | tail -3
    echo -e "${GREEN}  ✓ Frontend dependencies installed${NC}"
else
    echo -e "${RED}  ✗ No package.json found${NC}"
fi
cd ../..

# Start services
echo -e "\n${BLUE}=== Starting Services ===${NC}"

# Create logs directory
mkdir -p logs

# Set up environment
export PYTHONPATH=$PWD
export PYTHONUNBUFFERED=1

# Frontend environment variables - CRITICAL for proper operation
export VITE_GATEWAY_URL="http://127.0.0.1:8080"
export VITE_ORCHESTRATOR_URL="http://127.0.0.1:8081"
export VITE_API_URL="http://127.0.0.1:8081"
export VITE_WS_URL="ws://127.0.0.1:8080"
export VITE_CONNECT_WS="true"

# Ensure ORCHESTRATOR_BASE_URL is set for local FastAPI development (default if unset)
ORCHESTRATOR_BASE_URL="${ORCHESTRATOR_BASE_URL:-http://127.0.0.1:8081}"
export ORCHESTRATOR_BASE_URL

# Gateway environment for local agent forwarding
export GATEWAY_BASE_URL="http://127.0.0.1:8080"

# Start Orchestrator (port 8081)
echo -e "\n${YELLOW}Starting Orchestrator on port 8081...${NC}"
cd services/orchestrator
if [ "$PDM_AVAILABLE" = true ]; then
    PYTHONPATH=$PWD/../.. pdm run uvicorn app.main:app \
        --host 0.0.0.0 --port 8081 --reload \
        --log-level info > ../../logs/orchestrator.log 2>&1 &
else
    PYTHONPATH=$PWD/../.. python3 -m uvicorn app.main:app \
        --host 0.0.0.0 --port 8081 --reload \
        --log-level info > ../../logs/orchestrator.log 2>&1 &
fi
ORCHESTRATOR_PID=$!
cd ../..

# Start Gateway (port 8080)
echo -e "\n${YELLOW}Starting Gateway on port 8080...${NC}"
cd services/gateway
if [ "$PDM_AVAILABLE" = true ]; then
    PYTHONPATH=$PWD/../.. pdm run uvicorn app.main:app \
        --host 0.0.0.0 --port 8080 --reload \
        --log-level info > ../../logs/gateway.log 2>&1 &
else
    PYTHONPATH=$PWD/../.. python3 -m uvicorn app.main:app \
        --host 0.0.0.0 --port 8080 --reload \
        --log-level info > ../../logs/gateway.log 2>&1 &
fi
GATEWAY_PID=$!
cd ../..

# Start Frontend (port 5173)
echo -e "\n${YELLOW}Starting Frontend on port 5173...${NC}"
cd services/frontend
# Ensure environment variables are passed to npm
VITE_GATEWAY_URL="$VITE_GATEWAY_URL" \
VITE_ORCHESTRATOR_URL="$VITE_ORCHESTRATOR_URL" \
VITE_API_URL="$VITE_API_URL" \
VITE_WS_URL="$VITE_WS_URL" \
VITE_CONNECT_WS="$VITE_CONNECT_WS" \
npm run dev > ../../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
cd ../..

# Wait for services to be ready
echo -e "\n${BLUE}=== Waiting for Services to Start ===${NC}"

# More robust health checks
wait_for_service "Orchestrator" "http://localhost:8081/healthz" || \
    wait_for_service "Orchestrator (fallback)" "http://localhost:8081/"

wait_for_service "Gateway" "http://localhost:8080/healthz" || \
    wait_for_service "Gateway (fallback)" "http://localhost:8080/"

wait_for_service "Frontend" "http://localhost:5173"

# Function to schedule and run an agent
schedule_agent() {
    local agent_name=$1
    local manifest_path=$2
    local prompt=${3:-"Local demo run"}
    
    echo -e "\n${BLUE}=== Scheduling $agent_name Agent ===${NC}"
    
    # Check if manifest exists
    if [ ! -f "$manifest_path" ]; then
        echo -e "${YELLOW}  ⚠ Manifest not found at $manifest_path${NC}"
        return 1
    fi
    
    # Create temporary files
    MANIFEST_JSON=$(mktemp /tmp/mentat_manifest_XXXXXX.json)
    SCHEDULE_RESP=$(mktemp /tmp/mentat_schedule_XXXXXX.json)
    
    # Convert YAML to JSON
    echo -e "${YELLOW}  Converting manifest to JSON...${NC}"
    
    # Try different methods to convert YAML to JSON
    converted=false
    
    # Method 1: Use orchestrator's pdm environment
    if [ "$PDM_AVAILABLE" = true ] && [ -f "services/orchestrator/pyproject.toml" ]; then
        if (cd services/orchestrator && pdm run python -c "
import json, yaml, sys
with open('../../$manifest_path') as f:
    data = yaml.safe_load(f)
print(json.dumps(data))
" > "$MANIFEST_JSON" 2>/dev/null); then
            converted=true
            echo -e "${GREEN}  ✓ Converted using orchestrator environment${NC}"
        fi
    fi
    
    # Method 2: Use system Python with PyYAML
    if [ "$converted" = false ] && [ $PYYAML_AVAILABLE -eq 0 ]; then
        if python3 -c "
import json, yaml
with open('$manifest_path') as f:
    data = yaml.safe_load(f)
print(json.dumps(data))
" > "$MANIFEST_JSON" 2>/dev/null; then
            converted=true
            echo -e "${GREEN}  ✓ Converted using system Python${NC}"
        fi
    fi
    
    # Method 3: Fallback to hardcoded JSON
    if [ "$converted" = false ]; then
        echo -e "${YELLOW}  Using fallback JSON manifest${NC}"
        if [ "$agent_name" = "psyche-sim" ]; then
            cat > "$MANIFEST_JSON" <<'EOF'
{
  "id": "mentatlab.psyche-sim",
  "version": "0.1.0",
  "image": "mentatlab/psyche-sim:local-dev",
  "runtime": "python3.12",
  "description": "Psyche-inspired sample Cog‑Pak",
  "longRunning": false,
  "inputs": [
    {"name": "spec", "type": "json"},
    {"name": "context", "type": "json"}
  ],
  "outputs": [
    {"name": "result", "type": "json"},
    {"name": "mentat_meta", "type": "json"}
  ]
}
EOF
        elif [ "$agent_name" = "ctm-cogpack" ]; then
            cat > "$MANIFEST_JSON" <<'EOF'
{
  "id": "mentatlab.ctm-cogpack",
  "version": "0.1.0",
  "image": "mentatlab/ctm-cogpack:local-dev",
  "runtime": "python3.12",
  "description": "Continuous Thought Machine (CTM) Cogpack",
  "longRunning": false,
  "inputs": [
    {"name": "spec", "type": "json"},
    {"name": "context", "type": "json"}
  ],
  "outputs": [
    {"name": "output", "type": "stream"},
    {"name": "stats", "type": "json"}
  ]
}
EOF
        fi
    fi
    
    # Create schedule payload
    EXECUTION_ID="${agent_name}-demo-$(date +%s)"
    echo -e "${YELLOW}  Creating schedule request (execution_id=$EXECUTION_ID)...${NC}"
    
    cat > /tmp/schedule_payload.json <<EOF
{
  "agent_manifest": $(cat "$MANIFEST_JSON"),
  "inputs": {
    "spec": {
      "prompt": "$prompt",
      "mode": "stream",
      "chunk_delay": 0.02,
      "agent_id": "mentatlab.$agent_name"
    },
    "context": {}
  },
  "execution_id": "$EXECUTION_ID",
  "skip_validation": true
}
EOF
    
    # Schedule the agent
    echo -e "${YELLOW}  Sending schedule request to orchestrator...${NC}"
    if curl -sS -X POST http://127.0.0.1:8081/api/v1/agents/schedule \
        -H "Content-Type: application/json" \
        -d @/tmp/schedule_payload.json \
        > "$SCHEDULE_RESP" 2>/dev/null; then
        
        # Parse response
        RESOURCE_ID=$(python3 -c "
import json, sys
try:
    with open('$SCHEDULE_RESP') as f:
        data = json.load(f)
    print(data.get('resource_id', ''))
except:
    pass
" 2>/dev/null)
        
        if [ -n "$RESOURCE_ID" ]; then
            echo -e "${GREEN}  ✓ Agent scheduled successfully!${NC}"
            echo -e "${BLUE}    Resource ID: $RESOURCE_ID${NC}"
            echo -e "${BLUE}    Execution ID: $EXECUTION_ID${NC}"
            
            # Monitor job status
            echo -e "${YELLOW}  Monitoring job status...${NC}"
            for i in {1..10}; do
                sleep 1
                STATUS=$(curl -sS "http://127.0.0.1:8081/jobs/$RESOURCE_ID/status" 2>/dev/null | \
                    python3 -c "import json,sys; print(json.load(sys.stdin).get('status',{}).get('status','unknown'))" 2>/dev/null || echo "unknown")
                echo -e "    Status: $STATUS"
                if [ "$STATUS" != "scheduled" ] && [ "$STATUS" != "unknown" ]; then
                    break
                fi
            done
            
            return 0
        else
            echo -e "${RED}  ✗ Failed to schedule agent${NC}"
            echo -e "${YELLOW}  Response:${NC}"
            cat "$SCHEDULE_RESP" 2>/dev/null || echo "    (no response)"
        fi
    else
        echo -e "${RED}  ✗ Failed to contact orchestrator${NC}"
    fi
    
    # Cleanup temp files
    rm -f "$MANIFEST_JSON" "$SCHEDULE_RESP" /tmp/schedule_payload.json
    return 1
}

# Try to build and schedule demo agents
echo -e "\n${BLUE}=== Preparing Demo Agents ===${NC}"

# Check for Docker (optional)
if command -v docker >/dev/null 2>&1; then
    echo -e "${YELLOW}Building Docker images for agents (optional)...${NC}"
    
    # Build psyche-sim
    if [ -d "agents/psyche-sim" ]; then
        echo "  Building psyche-sim..."
        if docker build -t mentatlab/psyche-sim:local-dev agents/psyche-sim >/dev/null 2>&1; then
            echo -e "${GREEN}  ✓ psyche-sim image built${NC}"
        else
            echo -e "${YELLOW}  ⚠ psyche-sim build failed (will run locally)${NC}"
        fi
    fi
    
    # Build ctm-cogpack
    if [ -d "agents/ctm-cogpack" ]; then
        echo "  Building ctm-cogpack..."
        if docker build -t mentatlab/ctm-cogpack:local-dev agents/ctm-cogpack >/dev/null 2>&1; then
            echo -e "${GREEN}  ✓ ctm-cogpack image built${NC}"
        else
            echo -e "${YELLOW}  ⚠ ctm-cogpack build failed (will run locally)${NC}"
        fi
    fi
else
    echo -e "${YELLOW}⚠ Docker not available - agents will run locally${NC}"
fi

# Schedule a demo agent
sleep 2  # Give services a moment to stabilize

# Try psyche-sim first
if [ -f "agents/psyche-sim/manifest.yaml" ]; then
    schedule_agent "psyche-sim" "agents/psyche-sim/manifest.yaml" "Hello from local development!"
fi

# Display service status and information
echo -e "\n${GREEN}=====================================${NC}"
echo -e "${GREEN}   All Services Running! 🚀${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo -e "${BLUE}Service URLs:${NC}"
echo "  • Gateway:      http://localhost:8080"
echo "  • Orchestrator: http://localhost:8081"
echo "  • Frontend:     http://localhost:5173"
echo ""
echo -e "${BLUE}API Documentation:${NC}"
echo "  • Gateway API:      http://localhost:8080/docs"
echo "  • Orchestrator API: http://localhost:8081/docs"
echo ""
echo -e "${BLUE}Available Agents:${NC}"
if [ -f "agents/psyche-sim/manifest.yaml" ]; then
    echo "  • psyche-sim: Psyche-inspired simulation agent"
fi
if [ -f "agents/ctm-cogpack/manifest.yaml" ]; then
    echo "  • ctm-cogpack: Continuous Thought Machine agent"
fi
if [ -d "services/agents/echo" ]; then
    echo "  • echo: Simple echo agent (stdin/stdout)"
fi
echo ""
echo -e "${BLUE}Logs:${NC}"
echo "  • Gateway:      tail -f logs/gateway.log"
echo "  • Orchestrator: tail -f logs/orchestrator.log"
echo "  • Frontend:     tail -f logs/frontend.log"
echo ""
echo -e "${YELLOW}Commands:${NC}"
echo "  • View logs:    tail -f logs/*.log"
echo "  • Stop all:     Press Ctrl+C"
echo "  • Schedule agent manually:"
echo "    curl -X POST http://localhost:8081/api/v1/agents/schedule \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"agent_manifest\": {...}, \"inputs\": {...}}'"
echo ""
echo -e "${GREEN}Frontend should now be accessible at http://localhost:5173${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Function to show live logs
show_logs() {
    echo -e "\n${BLUE}=== Live Service Logs ===${NC}"
    echo -e "${YELLOW}(Press Ctrl+C to stop)${NC}\n"
    tail -f logs/*.log 2>/dev/null | while IFS= read -r line; do
        # Color code logs by service
        if [[ $line == *"orchestrator.log"* ]]; then
            echo -e "${BLUE}[ORCH]${NC} ${line#*==> }"
        elif [[ $line == *"gateway.log"* ]]; then
            echo -e "${GREEN}[GATE]${NC} ${line#*==> }"
        elif [[ $line == *"frontend.log"* ]]; then
            echo -e "${YELLOW}[FRONT]${NC} ${line#*==> }"
        else
            echo "$line"
        fi
    done
}

# Keep script running and optionally show logs
while true; do
    sleep 5
    
    # Check if services are still running
    if ! kill -0 $ORCHESTRATOR_PID 2>/dev/null; then
        echo -e "${RED}⚠ Orchestrator stopped unexpectedly!${NC}"
        echo "Check logs/orchestrator.log for details"
    fi
    if ! kill -0 $GATEWAY_PID 2>/dev/null; then
        echo -e "${RED}⚠ Gateway stopped unexpectedly!${NC}"
        echo "Check logs/gateway.log for details"
    fi
    if ! kill -0 $FRONTEND_PID 2>/dev/null; then
        echo -e "${RED}⚠ Frontend stopped unexpectedly!${NC}"
        echo "Check logs/frontend.log for details"
    fi
done