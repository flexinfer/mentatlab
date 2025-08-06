#!/bin/bash
# Script to run tests locally with PDM environments

set -e  # Exit on error

echo "Running tests locally with PDM environments..."
echo "============================================="

# Function to run tests for a service
run_service_tests() {
    local service_path=$1
    local service_name=$2
    
    echo ""
    echo "Testing $service_name..."
    echo "------------------------"
    
    if [ -d "$service_path" ]; then
        cd "$service_path"
        
        # Install dependencies if needed
        if [ -f "pyproject.toml" ]; then
            echo "Installing dependencies for $service_name..."
            pdm install
            
            echo "Running tests for $service_name..."
            pdm run pytest -v || echo "Tests failed for $service_name"
        else
            echo "No pyproject.toml found in $service_path, skipping..."
        fi
        
        cd - > /dev/null
    else
        echo "Service directory not found: $service_path"
    fi
}

# Get the script directory (project root)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Run tests for each service
run_service_tests "services/gateway" "Gateway"
run_service_tests "services/orchestrator" "Orchestrator"
run_service_tests "services/agents/echo" "Echo Agent"

echo ""
echo "============================================="
echo "Test run complete!"
echo ""
echo "To run tests for a specific service, use:"
echo "  cd services/<service-name> && pdm run pytest"
echo ""
echo "To run tests in VSCode with proper environment:"
echo "  1. Open the service directory in terminal"
echo "  2. Run: pdm run pytest"
echo "  3. Or configure VSCode to use PDM's Python interpreter"