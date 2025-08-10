#!/bin/bash

# Health check script for Docker container
# This script performs basic health checks for the Psyche Simulation application

set -e

# Configuration
HEALTH_URL="http://localhost:8080/health/live"
TIMEOUT=10
MAX_RETRIES=3
RETRY_DELAY=2

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Retry function
retry() {
    local retries=$1
    local cmd="$2"
    local count=0
    
    while [ $count -lt $retries ]; do
        if eval "$cmd"; then
            return 0
        fi
        count=$((count + 1))
        if [ $count -lt $retries ]; then
            log "${YELLOW}Attempt $count failed, retrying in ${RETRY_DELAY}s...${NC}"
            sleep $RETRY_DELAY
        fi
    done
    return 1
}

# Main health check function
health_check() {
    log "Starting health check..."
    
    # Check if curl is available
    if ! command -v curl &> /dev/null; then
        log "${RED}ERROR: curl is not available${NC}"
        return 1
    fi
    
    # Perform HTTP health check
    local http_check="curl -f -s --max-time $TIMEOUT $HEALTH_URL"
    
    if retry $MAX_RETRIES "$http_check"; then
        log "${GREEN}✓ HTTP health check passed${NC}"
        
        # Parse response if possible
        response=$(curl -s --max-time $TIMEOUT $HEALTH_URL 2>/dev/null || echo "")
        if [ -n "$response" ]; then
            # Check if it's JSON and contains status
            if echo "$response" | grep -q '"status"'; then
                status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
                log "Health status: $status"
            fi
        fi
        
        return 0
    else
        log "${RED}✗ HTTP health check failed after $MAX_RETRIES attempts${NC}"
        return 1
    fi
}

# Process check (optional additional check)
process_check() {
    if pgrep -f "python.*psyche_simulation.py" > /dev/null; then
        log "${GREEN}✓ Application process is running${NC}"
        return 0
    else
        log "${YELLOW}⚠ Application process not found${NC}"
        return 1
    fi
}

# Port check
port_check() {
    if netstat -tln 2>/dev/null | grep -q ":8080 "; then
        log "${GREEN}✓ Port 8080 is listening${NC}"
        return 0
    elif ss -tln 2>/dev/null | grep -q ":8080 "; then
        log "${GREEN}✓ Port 8080 is listening${NC}"
        return 0
    else
        log "${YELLOW}⚠ Port 8080 is not listening${NC}"
        return 1
    fi
}

# Main execution
main() {
    local exit_code=0
    
    # Core health check (required)
    if ! health_check; then
        exit_code=1
    fi
    
    # Additional checks (optional, don't fail on these)
    process_check || true
    port_check || true
    
    if [ $exit_code -eq 0 ]; then
        log "${GREEN}All health checks passed${NC}"
    else
        log "${RED}Health check failed${NC}"
    fi
    
    exit $exit_code
}

# Run health check
main "$@"