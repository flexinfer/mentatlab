#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Default registry target
REGISTRY_TARGET="registry.harbor.lan/library"

# Parse command line arguments for registry target
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --registry) REGISTRY_TARGET="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

echo "Building and pushing Docker images to registry: $REGISTRY_TARGET"

# Build orchestrator (needs repo root context for services/ imports)
echo "--- Building orchestrator image ---"
IMAGE_ORCHESTRATOR="$REGISTRY_TARGET/mentatlab-orchestrator:latest"
docker build -t "$IMAGE_ORCHESTRATOR" -f services/orchestrator/Dockerfile .
echo "--- Pushing orchestrator image ---"
docker push "$IMAGE_ORCHESTRATOR"
echo ""

# Build gateway (needs repo root context for services/ imports)
echo "--- Building gateway image ---"
IMAGE_GATEWAY="$REGISTRY_TARGET/mentatlab-gateway:latest"
docker build -t "$IMAGE_GATEWAY" -f services/gateway/Dockerfile .
echo "--- Pushing gateway image ---"
docker push "$IMAGE_GATEWAY"
echo ""

# Build frontend (builds from its own directory)
echo "--- Building frontend image ---"
IMAGE_FRONTEND="$REGISTRY_TARGET/mentatlab-frontend:latest"
docker build -t "$IMAGE_FRONTEND" services/frontend
echo "--- Pushing frontend image ---"
docker push "$IMAGE_FRONTEND"
echo ""

# Build echoagent (builds from its own directory)
echo "--- Building echoagent image ---"
IMAGE_ECHOAGENT="$REGISTRY_TARGET/mentatlab-echoagent:latest"
docker build -t "$IMAGE_ECHOAGENT" services/agents/echo
echo "--- Pushing echoagent image ---"
docker push "$IMAGE_ECHOAGENT"
echo ""

echo "All Docker images built and pushed successfully!"