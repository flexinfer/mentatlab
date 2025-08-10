#!/bin/bash

# Psyche Simulation Kubernetes Deployment Script
# This script automates the deployment of the Psyche Simulation to Kubernetes

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="${SCRIPT_DIR}/k8s"
DOCKER_DIR="${SCRIPT_DIR}/docker"
NAMESPACE="psyche-simulation"
APP_NAME="psyche-simulation"
IMAGE_NAME="psyche-simulation"
REGISTRY_URL="${REGISTRY_URL:-localhost:5000}"
BUILD_VERSION="${BUILD_VERSION:-$(date +%Y%m%d-%H%M%S)}"
VCS_REF="${VCS_REF:-$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
Psyche Simulation Deployment Script

Usage: $0 [OPTIONS]

Options:
    -h, --help              Show this help message
    -n, --namespace NAME    Kubernetes namespace (default: psyche-simulation)
    -v, --version VERSION   Build version tag (default: timestamp)
    -r, --registry URL      Container registry URL (default: localhost:5000)
    -e, --environment ENV   Environment (dev/staging/prod) (default: prod)
    --skip-build           Skip Docker build step
    --skip-push            Skip Docker push step
    --dry-run              Show what would be done without executing
    --force                Force deployment without confirmation
    --cleanup              Clean up existing deployment first

Examples:
    $0                                          # Deploy with defaults
    $0 -e dev --skip-push                      # Deploy to dev without pushing
    $0 -v v1.2.3 -r your-registry.com         # Deploy specific version
    $0 --cleanup --force                       # Clean and redeploy
    $0 --dry-run                               # Preview deployment

EOF
}

# Parse command line arguments
ENVIRONMENT="prod"
SKIP_BUILD=false
SKIP_PUSH=false
DRY_RUN=false
FORCE=false
CLEANUP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -v|--version)
            BUILD_VERSION="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY_URL="$2"
            shift 2
            ;;
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-push)
            SKIP_PUSH=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --cleanup)
            CLEANUP=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Set environment-specific configurations
case $ENVIRONMENT in
    dev|development)
        NAMESPACE="${NAMESPACE}-dev"
        REPLICAS=1
        RESOURCES_REQUESTS_CPU="100m"
        RESOURCES_REQUESTS_MEMORY="256Mi"
        RESOURCES_LIMITS_CPU="500m"
        RESOURCES_LIMITS_MEMORY="512Mi"
        ;;
    staging|stage)
        NAMESPACE="${NAMESPACE}-staging"
        REPLICAS=2
        RESOURCES_REQUESTS_CPU="200m"
        RESOURCES_REQUESTS_MEMORY="512Mi"
        RESOURCES_LIMITS_CPU="800m"
        RESOURCES_LIMITS_MEMORY="1Gi"
        ;;
    prod|production)
        NAMESPACE="${NAMESPACE}"
        REPLICAS=3
        RESOURCES_REQUESTS_CPU="250m"
        RESOURCES_REQUESTS_MEMORY="512Mi"
        RESOURCES_LIMITS_CPU="1000m"
        RESOURCES_LIMITS_MEMORY="1Gi"
        ;;
    *)
        log_error "Invalid environment: $ENVIRONMENT"
        exit 1
        ;;
esac

FULL_IMAGE_NAME="${REGISTRY_URL}/${IMAGE_NAME}:${BUILD_VERSION}"

# Validation functions
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing_tools=()
    
    # Check required tools
    command -v kubectl >/dev/null 2>&1 || missing_tools+=("kubectl")
    command -v docker >/dev/null 2>&1 || missing_tools+=("docker")
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        exit 1
    fi
    
    # Check Kubernetes connection
    if ! kubectl cluster-info >/dev/null 2>&1; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    # Check Docker daemon
    if ! docker info >/dev/null 2>&1; then
        log_error "Cannot connect to Docker daemon"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Build Docker image
build_image() {
    if [ "$SKIP_BUILD" = true ]; then
        log_info "Skipping Docker build"
        return 0
    fi
    
    log_info "Building Docker image: $FULL_IMAGE_NAME"
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would build: docker build -t $FULL_IMAGE_NAME $DOCKER_DIR"
        return 0
    fi
    
    docker build \
        --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
        --build-arg BUILD_VERSION="$BUILD_VERSION" \
        --build-arg VCS_REF="$VCS_REF" \
        -t "$FULL_IMAGE_NAME" \
        -f "$DOCKER_DIR/Dockerfile" \
        "$SCRIPT_DIR"
    
    log_success "Docker image built successfully"
}

# Push Docker image
push_image() {
    if [ "$SKIP_PUSH" = true ]; then
        log_info "Skipping Docker push"
        return 0
    fi
    
    log_info "Pushing Docker image: $FULL_IMAGE_NAME"
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would push: docker push $FULL_IMAGE_NAME"
        return 0
    fi
    
    docker push "$FULL_IMAGE_NAME"
    log_success "Docker image pushed successfully"
}

# Apply Kubernetes manifests
apply_manifests() {
    log_info "Applying Kubernetes manifests to namespace: $NAMESPACE"
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would apply manifests:"
        for manifest in "$K8S_DIR"/*.yaml; do
            echo "  - $(basename "$manifest")"
        done
        return 0
    fi
    
    # Create namespace if it doesn't exist
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    
    # Apply manifests in order
    local manifests=(
        "namespace.yaml"
        "secrets.yaml"
        "configmap.yaml"
        "redis-deployment.yaml"
        "deployment.yaml"
        "service.yaml"
        "ingress.yaml"
        "hpa.yaml"
    )
    
    for manifest in "${manifests[@]}"; do
        local manifest_path="$K8S_DIR/$manifest"
        if [ -f "$manifest_path" ]; then
            log_info "Applying $manifest..."
            
            # Replace placeholders in manifest
            sed -e "s|{{IMAGE_NAME}}|$FULL_IMAGE_NAME|g" \
                -e "s|{{BUILD_VERSION}}|$BUILD_VERSION|g" \
                -e "s|{{NAMESPACE}}|$NAMESPACE|g" \
                -e "s|{{REPLICAS}}|$REPLICAS|g" \
                -e "s|{{RESOURCES_REQUESTS_CPU}}|$RESOURCES_REQUESTS_CPU|g" \
                -e "s|{{RESOURCES_REQUESTS_MEMORY}}|$RESOURCES_REQUESTS_MEMORY|g" \
                -e "s|{{RESOURCES_LIMITS_CPU}}|$RESOURCES_LIMITS_CPU|g" \
                -e "s|{{RESOURCES_LIMITS_MEMORY}}|$RESOURCES_LIMITS_MEMORY|g" \
                "$manifest_path" | kubectl apply -f -
        else
            log_warning "Manifest not found: $manifest"
        fi
    done
    
    log_success "Kubernetes manifests applied successfully"
}

# Wait for deployment
wait_for_deployment() {
    log_info "Waiting for deployment to be ready..."
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would wait for deployment rollout"
        return 0
    fi
    
    # Wait for Redis deployment
    kubectl rollout status deployment/redis -n "$NAMESPACE" --timeout=300s
    
    # Wait for main application deployment
    kubectl rollout status deployment/psyche-simulation -n "$NAMESPACE" --timeout=600s
    
    log_success "Deployment is ready"
}

# Health check
perform_health_check() {
    log_info "Performing health check..."
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would perform health check"
        return 0
    fi
    
    # Get service endpoint
    local service_ip
    service_ip=$(kubectl get service psyche-simulation-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}')
    
    if [ -z "$service_ip" ]; then
        log_error "Could not get service IP"
        return 1
    fi
    
    # Perform health check using kubectl port-forward
    log_info "Testing health endpoint..."
    kubectl port-forward service/psyche-simulation-service 18080:80 -n "$NAMESPACE" &
    local port_forward_pid=$!
    
    sleep 5
    
    if curl -f -s http://localhost:18080/health/live >/dev/null 2>&1; then
        log_success "Health check passed"
        kill $port_forward_pid 2>/dev/null || true
        return 0
    else
        log_error "Health check failed"
        kill $port_forward_pid 2>/dev/null || true
        return 1
    fi
}

# Cleanup function
cleanup_deployment() {
    if [ "$CLEANUP" != true ]; then
        return 0
    fi
    
    log_info "Cleaning up existing deployment..."
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would cleanup existing deployment"
        return 0
    fi
    
    # Delete deployments
    kubectl delete deployment psyche-simulation redis -n "$NAMESPACE" --ignore-not-found=true
    
    # Delete services
    kubectl delete service psyche-simulation-service psyche-simulation-headless psyche-simulation-nodeport psyche-simulation-lb redis-service redis-headless -n "$NAMESPACE" --ignore-not-found=true
    
    # Delete HPA
    kubectl delete hpa psyche-simulation-hpa redis-hpa -n "$NAMESPACE" --ignore-not-found=true
    
    # Delete ingress
    kubectl delete ingress psyche-simulation-ingress psyche-simulation-internal-ingress psyche-simulation-dev-ingress -n "$NAMESPACE" --ignore-not-found=true
    
    log_success "Cleanup completed"
}

# Confirmation prompt
confirm_deployment() {
    if [ "$FORCE" = true ] || [ "$DRY_RUN" = true ]; then
        return 0
    fi
    
    echo
    log_info "Deployment Summary:"
    echo "  Environment:  $ENVIRONMENT"
    echo "  Namespace:    $NAMESPACE"
    echo "  Image:        $FULL_IMAGE_NAME"
    echo "  Replicas:     $REPLICAS"
    echo "  Resources:    ${RESOURCES_REQUESTS_CPU}/${RESOURCES_LIMITS_CPU} CPU, ${RESOURCES_REQUESTS_MEMORY}/${RESOURCES_LIMITS_MEMORY} Memory"
    echo
    
    read -p "Continue with deployment? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Deployment cancelled"
        exit 0
    fi
}

# Main deployment function
main() {
    log_info "Starting Psyche Simulation deployment..."
    log_info "Environment: $ENVIRONMENT"
    log_info "Namespace: $NAMESPACE"
    log_info "Image: $FULL_IMAGE_NAME"
    
    check_prerequisites
    confirm_deployment
    cleanup_deployment
    build_image
    push_image
    apply_manifests
    wait_for_deployment
    perform_health_check
    
    log_success "Deployment completed successfully!"
    
    # Show useful information
    echo
    log_info "Useful commands:"
    echo "  kubectl get pods -n $NAMESPACE"
    echo "  kubectl logs -f deployment/psyche-simulation -n $NAMESPACE"
    echo "  kubectl port-forward service/psyche-simulation-service 8080:80 -n $NAMESPACE"
    echo "  kubectl get ingress -n $NAMESPACE"
}

# Handle script interruption
trap 'log_error "Deployment interrupted"; exit 130' INT TERM

# Run main function
main "$@"