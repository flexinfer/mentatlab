#!/usr/bin/env bash

set -euo pipefail

# MentatLab k3s deploy helper
# - Builds and pushes images (optional)
# - Applies manifests
# - Updates Deployment images to a specific tag
# - Waits for rollouts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults (override via flags or env)
NAMESPACE="${NAMESPACE:-mentatlab}"
REGISTRY="${REGISTRY:-registry.harbor.lan/library}"
TAG="${TAG:-}"
IMAGES="orchestrator,gateway,frontend" # echoagent optional
INGRESS_CLASS_OVERRIDE="${INGRESS_CLASS:-}"
FRONTEND_GATEWAY_URL="${FRONTEND_GATEWAY_URL:-}"
FRONTEND_ORCH_URL="${FRONTEND_ORCH_URL:-}"
FRONTEND_DEBUG=false
APPLY_ONLY=false
SKIP_INGRESS=false
SKIP_BUILD=false
SKIP_PUSH=false
FAST=false
DRY_RUN=false

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  -n, --namespace   Kubernetes namespace (default: $NAMESPACE)
  -r, --registry    Container registry (default: $REGISTRY)
  -t, --tag         Image tag (default: git SHA or timestamp)
  -i, --images      Comma list: orchestrator,gateway,frontend[,echoagent]
  --ingress-class CLASS         Force a specific IngressClass (overrides auto-detect)
  --frontend-gateway-url URL   Build-time VITE_GATEWAY_BASE_URL for frontend
  --frontend-orch-url URL      Build-time VITE_ORCHESTRATOR_URL for frontend
  --debug-frontend             Build frontend with sourcemaps and no minify
  --apply-only      Apply manifests and set image if TAG given (no build/push)
  --skip-build      Skip docker build
  --skip-push       Skip docker push
  --fast            Don’t wait for rollout
  --dry-run         Print actions without executing
  -h, --help        Show this help
EOF
}

log() { echo -e "\033[1;34m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
err() { echo -e "\033[1;31m[error]\033[0m $*"; }

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace) NAMESPACE="$2"; shift 2;;
    -r|--registry) REGISTRY="$2"; shift 2;;
    -t|--tag) TAG="$2"; shift 2;;
    -i|--images) IMAGES="$2"; shift 2;;
    --apply-only) APPLY_ONLY=true; shift;;
    --skip-build) SKIP_BUILD=true; shift;;
    --skip-push) SKIP_PUSH=true; shift;;
    --fast) FAST=true; shift;;
    --dry-run) DRY_RUN=true; shift;;
    --ingress-class) INGRESS_CLASS_OVERRIDE="$2"; shift 2;;
    --frontend-gateway-url) FRONTEND_GATEWAY_URL="$2"; shift 2;;
    --frontend-orch-url) FRONTEND_ORCH_URL="$2"; shift 2;;
    --debug-frontend) FRONTEND_DEBUG=true; shift;;
    --skip-ingress) SKIP_INGRESS=true; shift;;
    -h|--help) usage; exit 0;;
    *) err "Unknown arg: $1"; usage; exit 1;;
  esac
done

# Compute default tag
if [[ -z "$TAG" ]]; then
  if git -C "$REPO_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
    TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  else
    TAG="dev-$(date +%Y%m%d%H%M%S)"
  fi
fi

# Helpers
run() { if $DRY_RUN; then echo "+ $*"; else eval "$*"; fi }

build_image() {
  local name="$1"; shift
  local ctx="$1"; shift
  local df="$1"; shift
  local extra_args=("$@")
  local img="$REGISTRY/mentatlab-$name:$TAG"

  # When using set -u, expanding an empty array triggers an error. Guard the expansion.
  if ! $SKIP_BUILD; then
    if ((${#extra_args[@]})); then
      run docker build -t "$img" -f "$df" "$ctx" "${extra_args[@]}"
    else
      run docker build -t "$img" -f "$df" "$ctx"
    fi
  fi
  if ! $SKIP_PUSH; then run docker push "$img"; fi
}

set_image() {
  local deploy="$1"; local container="$2"; local name="$3";
  local img="$REGISTRY/mentatlab-$name:$TAG"
  run kubectl -n "$NAMESPACE" set image "deployment/$deploy" "$container=$img" --record
  if ! $FAST; then
    run kubectl -n "$NAMESPACE" rollout status "deployment/$deploy" --timeout=300s
  fi
}

log "Namespace: $NAMESPACE | Registry: $REGISTRY | Tag: $TAG"
log "Images: $IMAGES"

# 1) Build & push (unless apply-only)
if ! $APPLY_ONLY; then
  IFS=',' read -r -a arr <<< "$IMAGES"
  for svc in "${arr[@]}"; do
    case "$svc" in
      orchestrator)
        build_image orchestrator "$REPO_ROOT" "$REPO_ROOT/services/orchestrator/Dockerfile"
        ;;
      gateway)
        build_image gateway "$REPO_ROOT" "$REPO_ROOT/services/gateway/Dockerfile"
        ;;
      frontend)
        # Build-time URLs (prefer overrides passed via flags)
        gw_url="${FRONTEND_GATEWAY_URL:-http://gateway:8080}"
        orch_url="${FRONTEND_ORCH_URL:-http://orchestrator:7070}"
        build_image frontend "$REPO_ROOT/services/frontend" "$REPO_ROOT/services/frontend/Dockerfile" \
          --build-arg VITE_GATEWAY_BASE_URL="$gw_url" \
          --build-arg VITE_ORCHESTRATOR_URL="$orch_url" \
          --build-arg VITE_DEBUG_BUILD="$FRONTEND_DEBUG"
        ;;
      echoagent)
        if [[ -f "$REPO_ROOT/agents/echo/Dockerfile" ]]; then
          build_image echoagent "$REPO_ROOT/agents/echo" "$REPO_ROOT/agents/echo/Dockerfile"
        else
          warn "echoagent Dockerfile not found; skipping"
        fi
        ;;
      *) warn "Unknown service in --images: $svc";;
    esac
  done
fi

# 2) Apply manifests (idempotent)
log "Applying Kubernetes manifests"
run kubectl apply -f "$SCRIPT_DIR/namespace.yaml"
  # Create/patch Cloudflare Access service token secret when provided via env
  if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
    log "Ensuring cloudflare-access secret exists"
    run "kubectl -n '$NAMESPACE' create secret generic cloudflare-access \
      --from-literal=CF_ACCESS_CLIENT_ID='$CF_ACCESS_CLIENT_ID' \
      --from-literal=CF_ACCESS_CLIENT_SECRET='$CF_ACCESS_CLIENT_SECRET' \
      --dry-run=client -o yaml | kubectl apply -f -"
  fi
run kubectl apply -f "$SCRIPT_DIR/redis.yaml"
run kubectl apply -f "$SCRIPT_DIR/orchestrator.yaml"
run kubectl apply -f "$SCRIPT_DIR/orchestrator-rbac.yaml"
run kubectl apply -f "$SCRIPT_DIR/gateway.yaml"
run kubectl apply -f "$SCRIPT_DIR/frontend.yaml"
if [[ -f "$SCRIPT_DIR/echoagent.yaml" ]]; then
  run kubectl apply -f "$SCRIPT_DIR/echoagent.yaml"
fi
if [[ -f "$SCRIPT_DIR/ingress.yaml" && "$SKIP_INGRESS" != true ]]; then
  # Detect ingress class: prefer default, then traefik, then first available
  DEFAULT_CLASS=$(kubectl get ingressclass -o jsonpath='{.items[?(@.metadata.annotations["ingressclass.kubernetes.io/is-default-class"]=="true")].metadata.name}' 2>/dev/null || true)
  ALL_CLASSES=$(kubectl get ingressclass -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
  INGRESS_CLASS="${INGRESS_CLASS_OVERRIDE:-}"
  # Prefer nginx (cluster convention), then the default class, then traefik, then any
  if [[ -z "$INGRESS_CLASS" ]]; then
    if echo "$ALL_CLASSES" | grep -q "^nginx$"; then
      INGRESS_CLASS="nginx"
    elif [[ -n "$DEFAULT_CLASS" ]]; then
      INGRESS_CLASS="$DEFAULT_CLASS"
    elif echo "$ALL_CLASSES" | grep -q "^traefik$"; then
      INGRESS_CLASS="traefik"
    else
      INGRESS_CLASS="$(echo "$ALL_CLASSES" | head -n1)"
    fi
  fi
  if [[ -z "$INGRESS_CLASS" ]]; then
    warn "No IngressClass found; applying as-is (controller may choose default)."
    ( run kubectl apply -f "$SCRIPT_DIR/ingress.yaml" ) || warn "Ingress apply failed; continuing"
  else
    log "Using IngressClass: $INGRESS_CLASS"
    # Apply ingress with substituted class. Do not abort deploy on failure.
    if $DRY_RUN; then
      echo "+ sed 's/__INGRESS_CLASS__/$INGRESS_CLASS/g' '$SCRIPT_DIR/ingress.yaml' | kubectl apply -f -"
    else
      ( sed "s/__INGRESS_CLASS__/$INGRESS_CLASS/g" "$SCRIPT_DIR/ingress.yaml" | kubectl apply -f - ) || warn "Ingress apply failed; continuing"
    fi
  fi
fi

# 3) Update Deployment images to the new tag
IFS=',' read -r -a arr2 <<< "$IMAGES"
for svc in "${arr2[@]}"; do
  case "$svc" in
    orchestrator) set_image orchestrator orchestrator orchestrator;;
    gateway) set_image gateway gateway gateway;;
    frontend) set_image frontend frontend frontend;;
    echoagent) set_image echoagent echoagent echoagent;;
  esac
done

# 4) Summary
log "Deploy complete"
run kubectl get deploy,svc -n "$NAMESPACE"
if ! $FAST; then
  echo ""
  echo "Frontend URL (LoadBalancer):"
  run kubectl get service frontend -n "$NAMESPACE" -o wide
fi
