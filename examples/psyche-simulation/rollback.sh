#!/bin/bash

# Psyche Simulation Kubernetes Rollback Script
# This script provides safe rollback functionality for the Psyche Simulation deployment

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="psyche-simulation"
APP_NAME="psyche-simulation"

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
Psyche Simulation Rollback Script

Usage: $0 [OPTIONS]

Options:
    -h, --help              Show this help message
    -n, --namespace NAME    Kubernetes namespace (default: psyche-simulation)
    -r, --revision NUM      Rollback to specific revision number
    --list-revisions        List available revisions
    --dry-run              Show what would be done without executing
    --force                Force rollback without confirmation
    --check-health         Perform health check after rollback

Examples:
    $0                                          # Rollback to previous revision
    $0 -r 3                                    # Rollback to revision 3
    $0 --list-revisions                        # Show available revisions
    $0 --dry-run                               # Preview rollback
    $0 --force --check-health                  # Force rollback with health check

EOF
}

# Parse command line arguments
REVISION=""
LIST_REVISIONS=false
DRY_RUN=false
FORCE=false
CHECK_HEALTH=false

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
        -r|--revision)
            REVISION="$2"
            shift 2
            ;;
        --list-revisions)
            LIST_REVISIONS=true
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
        --check-health)
            CHECK_HEALTH=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl >/dev/null 2>&1; then
        log_error "kubectl is not installed"
        exit 1
    fi
    
    # Check Kubernetes connection
    if ! kubectl cluster-info >/dev/null 2>&1; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    # Check if namespace exists
    if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
        log_error "Namespace '$NAMESPACE' does not exist"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# List available revisions
list_revisions() {
    log_info "Available revisions for deployment '$APP_NAME' in namespace '$NAMESPACE':"
    echo
    
    # Get rollout history
    kubectl rollout history deployment/"$APP_NAME" -n "$NAMESPACE" || {
        log_error "Failed to get rollout history"
        exit 1
    }
    
    echo
    log_info "Current revision details:"
    kubectl get deployment "$APP_NAME" -n "$NAMESPACE" -o wide
}

# Get current deployment status
get_deployment_status() {
    log_info "Current deployment status:"
    
    # Get deployment info
    kubectl get deployment "$APP_NAME" -n "$NAMESPACE" -o wide
    
    echo
    log_info "Pod status:"
    kubectl get pods -l app="$APP_NAME" -n "$NAMESPACE"
    
    echo
    log_info "Current revision:"
    kubectl rollout status deployment/"$APP_NAME" -n "$NAMESPACE" --timeout=0s || true
}

# Perform rollback
perform_rollback() {
    local rollback_cmd="kubectl rollout undo deployment/$APP_NAME -n $NAMESPACE"
    
    if [ -n "$REVISION" ]; then
        rollback_cmd="$rollback_cmd --to-revision=$REVISION"
        log_info "Rolling back to revision $REVISION..."
    else
        log_info "Rolling back to previous revision..."
    fi
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would execute: $rollback_cmd"
        return 0
    fi
    
    # Execute rollback
    $rollback_cmd || {
        log_error "Rollback command failed"
        exit 1
    }
    
    log_success "Rollback command executed successfully"
}

# Wait for rollback to complete
wait_for_rollback() {
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would wait for rollback to complete"
        return 0
    fi
    
    log_info "Waiting for rollback to complete..."
    
    # Wait for rollout to finish
    if kubectl rollout status deployment/"$APP_NAME" -n "$NAMESPACE" --timeout=600s; then
        log_success "Rollback completed successfully"
    else
        log_error "Rollback timed out or failed"
        
        # Show current status for debugging
        echo
        log_warning "Current deployment status:"
        kubectl get deployment "$APP_NAME" -n "$NAMESPACE" -o wide
        kubectl get pods -l app="$APP_NAME" -n "$NAMESPACE"
        
        exit 1
    fi
}

# Health check after rollback
perform_health_check() {
    if [ "$CHECK_HEALTH" != true ]; then
        return 0
    fi
    
    log_info "Performing health check after rollback..."
    
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would perform health check"
        return 0
    fi
    
    # Wait a bit for pods to be ready
    sleep 10
    
    # Check if pods are ready
    local ready_pods
    ready_pods=$(kubectl get pods -l app="$APP_NAME" -n "$NAMESPACE" -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' | tr ' ' '\n' | grep -c "True" || echo "0")
    
    local total_pods
    total_pods=$(kubectl get pods -l app="$APP_NAME" -n "$NAMESPACE" --no-headers | wc -l)
    
    if [ "$ready_pods" -eq "$total_pods" ] && [ "$total_pods" -gt 0 ]; then
        log_success "All pods are ready ($ready_pods/$total_pods)"
    else
        log_error "Not all pods are ready ($ready_pods/$total_pods)"
        
        # Show pod status for debugging
        kubectl get pods -l app="$APP_NAME" -n "$NAMESPACE"
        exit 1
    fi
    
    # Test health endpoint
    log_info "Testing health endpoint..."
    
    # Use port-forward to test health endpoint
    kubectl port-forward service/"$APP_NAME"-service 18080:80 -n "$NAMESPACE" &
    local port_forward_pid=$!
    
    sleep 5
    
    if curl -f -s http://localhost:18080/health/live >/dev/null 2>&1; then
        log_success "Health check passed"
        kill $port_forward_pid 2>/dev/null || true
    else
        log_error "Health check failed"
        kill $port_forward_pid 2>/dev/null || true
        
        # Show recent logs for debugging
        log_warning "Recent application logs:"
        kubectl logs --tail=50 -l app="$APP_NAME" -n "$NAMESPACE"
        
        exit 1
    fi
}

# Confirmation prompt
confirm_rollback() {
    if [ "$FORCE" = true ] || [ "$DRY_RUN" = true ]; then
        return 0
    fi
    
    echo
    log_warning "You are about to rollback the deployment '$APP_NAME' in namespace '$NAMESPACE'"
    
    if [ -n "$REVISION" ]; then
        log_warning "Target revision: $REVISION"
    else
        log_warning "Target revision: Previous revision"
    fi
    
    echo
    read -p "Are you sure you want to proceed? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Rollback cancelled"
        exit 0
    fi
}

# Backup current state before rollback
backup_current_state() {
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would backup current deployment state"
        return 0
    fi
    
    log_info "Backing up current deployment state..."
    
    local backup_file="/tmp/psyche-simulation-backup-$(date +%Y%m%d-%H%M%S).yaml"
    
    kubectl get deployment "$APP_NAME" -n "$NAMESPACE" -o yaml > "$backup_file" || {
        log_warning "Failed to backup deployment state"
        return 1
    }
    
    log_success "Current deployment state backed up to: $backup_file"
}

# Show rollback summary
show_rollback_summary() {
    echo
    log_success "Rollback Summary:"
    echo "  Deployment: $APP_NAME"
    echo "  Namespace:  $NAMESPACE"
    
    if [ -n "$REVISION" ]; then
        echo "  Rolled back to revision: $REVISION"
    else
        echo "  Rolled back to: Previous revision"
    fi
    
    echo
    log_info "Current deployment status:"
    kubectl get deployment "$APP_NAME" -n "$NAMESPACE" -o wide
    
    echo
    log_info "Pod status:"
    kubectl get pods -l app="$APP_NAME" -n "$NAMESPACE"
    
    echo
    log_info "Useful commands:"
    echo "  kubectl logs -f deployment/$APP_NAME -n $NAMESPACE"
    echo "  kubectl get pods -n $NAMESPACE"
    echo "  kubectl rollout history deployment/$APP_NAME -n $NAMESPACE"
    echo "  kubectl port-forward service/$APP_NAME-service 8080:80 -n $NAMESPACE"
}

# Main rollback function
main() {
    log_info "Starting Psyche Simulation rollback..."
    
    check_prerequisites
    
    if [ "$LIST_REVISIONS" = true ]; then
        list_revisions
        exit 0
    fi
    
    get_deployment_status
    confirm_rollback
    backup_current_state
    perform_rollback
    wait_for_rollback
    perform_health_check
    show_rollback_summary
    
    log_success "Rollback completed successfully!"
}

# Handle script interruption
trap 'log_error "Rollback interrupted"; exit 130' INT TERM

# Run main function
main "$@"