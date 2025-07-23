#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Default registry target
REGISTRY_TARGET="ghcr.io/flexinfer/mentatlab"

# Parse command line arguments for registry target
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --registry) REGISTRY_TARGET="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

echo "Building and pushing Docker images to registry: $REGISTRY_TARGET"

# Services and their paths
declare -A services
services["orchestrator"]="services/orchestrator"
services["gateway"]="services/gateway"
services["echoagent"]="services/agents/echo"
services["frontend"]="services/frontend"

# Loop through services, build, and push images
for service_name in "${!services[@]}"; do
    service_path="${services[$service_name]}"
    image_name="$REGISTRY_TARGET/$service_name:latest"

    echo "--- Building $service_name image: $image_name ---"
    docker build -t "$image_name" "$service_path"

    echo "--- Pushing $service_name image: $image_name ---"
    docker push "$image_name"
    echo ""
done

echo "All Docker images built and pushed successfully!"