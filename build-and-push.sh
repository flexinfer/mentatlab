#!/usr/bin/env bash
set -euo pipefail

# Defaults
REGISTRY_TARGET=${REGISTRY_TARGET:-"registry.harbor.lan/library"}
PLATFORMS=${PLATFORMS:-"linux/amd64,linux/arm64"}
SINGLE_PLATFORM=${SINGLE_PLATFORM:-""}
USE_BUILDX=false
INSECURE_REGISTRY=false
BUILDER_NAME=${BUILDER_NAME:-"harbor"}

usage() {
  cat <<USAGE
Usage: $0 [--registry <host/namespace>] [--multiarch] [--platforms <list>] [--insecure]

  --registry   Target registry path (default: $REGISTRY_TARGET)
  --multiarch  Build with buildx and push multi-arch images ($PLATFORMS)
  --platforms  Comma-separated platforms for --multiarch (default: $PLATFORMS)
  --platform   Single platform for classic docker build (e.g., linux/amd64)
  --insecure   Mark the target registry as insecure for buildx (dev only)
USAGE
}

# Parse args
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --registry)
      REGISTRY_TARGET="$2"; shift ;;
    --multiarch)
      USE_BUILDX=true ;;
    --platforms)
      PLATFORMS="$2"; shift ;;
    --platform)
      SINGLE_PLATFORM="$2"; shift ;;
    --insecure)
      INSECURE_REGISTRY=true ;;
    -h|--help)
      usage; exit 0 ;;
    *) echo "Unknown flag: $1"; usage; exit 1 ;;
  esac
  shift
done

echo "Registry: $REGISTRY_TARGET"
echo "Multiarch: $USE_BUILDX (platforms=$PLATFORMS)"
if [[ -n "$SINGLE_PLATFORM" && "$USE_BUILDX" != true ]]; then
  echo "Single-arch build: $SINGLE_PLATFORM"
fi

# Helper to optionally use buildx
bx_build_push() {
  local context="$1" image="$2"
  if [[ "$USE_BUILDX" == true ]]; then
    docker buildx build --platform "$PLATFORMS" -t "$image" --push "$context"
  else
    if [[ -n "$SINGLE_PLATFORM" ]]; then
      docker build --platform "$SINGLE_PLATFORM" -t "$image" "$context"
    else
      docker build -t "$image" "$context"
    fi
    docker push "$image"
  fi
}

# Setup buildx builder when needed
if [[ "$USE_BUILDX" == true ]]; then
  if docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
    docker buildx use "$BUILDER_NAME" >/dev/null
  else
    if [[ "$INSECURE_REGISTRY" == true ]]; then
      mkdir -p ~/.docker/buildx
      cat > ~/.docker/buildx/buildkitd.toml <<EOF
[registry."${REGISTRY_TARGET%%/*}"]
  insecure = true
EOF
      docker buildx create --name "$BUILDER_NAME" --driver docker-container --config ~/.docker/buildx/buildkitd.toml --use >/dev/null
    else
      docker buildx create --name "$BUILDER_NAME" --driver docker-container --use >/dev/null
    fi
  fi
  docker buildx inspect --bootstrap >/dev/null
fi

echo "--- Building & pushing images ---"

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

IMAGE_FRONTEND="$REGISTRY_TARGET/mentatlab-frontend:latest"
bx_build_push services/frontend "$IMAGE_FRONTEND"

IMAGE_ECHOAGENT="$REGISTRY_TARGET/mentatlab-echoagent:latest"
bx_build_push services/agents/echo "$IMAGE_ECHOAGENT"

IMAGE_PSYCHESIM="$REGISTRY_TARGET/mentatlab-psyche-sim:latest"
bx_build_push agents/psyche-sim "$IMAGE_PSYCHESIM"

IMAGE_CTM="$REGISTRY_TARGET/mentatlab-ctm-cogpack:latest"
bx_build_push agents/ctm-cogpack "$IMAGE_CTM"

echo "All Docker images built and pushed successfully!"
