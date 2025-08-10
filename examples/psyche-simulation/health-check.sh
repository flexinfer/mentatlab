#!/bin/bash

# Psyche Simulation Health Check Script
# This script performs comprehensive health checks for the deployed application

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="psyche-simulation"
APP_NAME="psyche-simulation"
SERVICE_NAME="psyche-simulation-service"
TIMEOUT=30
RETRY_COUNT=3
RETRY_DELAY=5

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
Psyche Simulation Health Check Script

Usage: $0 [OPTIONS]

Options:
    -h, --help              Show this help message
    -n, --namespace NAME    Kubernetes namespace (default: psyche-simulation)
    -t, --timeout SECONDS   Timeout for health checks (default: 30)
    -r, --retries COUNT     Number of retries (default: 3)
    --verbose               Enable verbose output
    --continuous           Run continuous health checks
    --interval SECONDS     Interval for continuous checks (default: 60)
    --json                 Output results in JSON format

Examples:
    $0                                          # Basic health check
    $0 --verbose                               # Verbose health check
    $0 --continuous --interval 30              # Continuous monitoring
    $0 --json                                  # JSON output
    $0 -n psyche-simulation-dev               # Check dev environment

EOF
}

# Parse command line arguments
VERBOSE=false
CONTINUOUS=false
INTERVAL=60
JSON_OUTPUT=false

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
        -t|--timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        -r|--retries)
            RETRY_COUNT="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --continuous)
            CONTINUOUS=true
            shift
            ;;
        --interval)
            INTERVAL="$2"
            shift 2
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Global health check results
declare -A HEALTH_RESULTS

# Check prerequisites
check_prerequisites() {
    local errors=0
    
    if [ "$VERBOSE" = true ]; then
        log_info "Checking prerequisites..."
    fi
    
    # Check kubectl
    if ! command -v kubectl >/dev/null 2>&1; then
        log_error "kubectl is not installed"
        ((errors++))
    fi
    
    # Check curl
    if ! command -v curl >/dev/null 2>&1; then
        log_error "curl is not installed"
        ((errors++))
    fi
    
    # Check Kubernetes connection
    if ! kubectl cluster-info >/dev/null 2>&1; then
        log_error "Cannot connect to Kubernetes cluster"
        ((errors++))
    fi
    
    # Check if namespace exists
    if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
        log_error "Namespace '$NAMESPACE' does not exist"
        ((errors++))
    fi
    
    if [ $errors -eq 0 ]; then
        HEALTH_RESULTS["prerequisites"]="PASS"
        if [ "$VERBOSE" = true ]; then
            log_success "Prerequisites check passed"
        fi
        return 0
    else
        HEALTH_RESULTS["prerequisites"]="FAIL"
        return 1
    fi
}

# Check deployment status
check_deployment_status() {
    if [ "$VERBOSE" = true ]; then
        log_info "Checking deployment status..."
    fi
    
    # Check if deployment exists
    if ! kubectl get deployment "$APP_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
        log_error "Deployment '$APP_NAME' not found in namespace '$NAMESPACE'"
        HEALTH_RESULTS["deployment"]="FAIL"
        return 1
    fi
    
    # Check deployment readiness
    local ready_replicas
    ready_replicas=$(kubectl get deployment "$APP_NAME" -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    
    local desired_replicas
    desired_replicas=$(kubectl get deployment "$APP_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
    
    if [ "$ready_replicas" = "$desired_replicas" ] && [ "$desired_replicas" -gt 0 ]; then
        HEALTH_RESULTS["deployment"]="PASS"
        HEALTH_RESULTS["deployment_ready_replicas"]="$ready_replicas"
        HEALTH_RESULTS["deployment_desired_replicas"]="$desired_replicas"
        
        if [ "$VERBOSE" = true ]; then
            log_success "Deployment is healthy ($ready_replicas/$desired_replicas replicas ready)"
        fi
        return 0
    else
        HEALTH_RESULTS["deployment"]="FAIL"
        HEALTH_RESULTS["deployment_ready_replicas"]="$ready_replicas"
        HEALTH_RESULTS["deployment_desired_replicas"]="$desired_replicas"
        
        log_error "Deployment is not healthy ($ready_replicas/$desired_replicas replicas ready)"
        
        if [ "$VERBOSE" = true ]; then
            kubectl get deployment "$APP_NAME" -n "$NAMESPACE" -o wide
        fi
        return 1
    fi
}

# Check pod status
check_pod_status() {
    if [ "$VERBOSE" = true ]; then
        log_info "Checking pod status..."
    fi
    
    local pods_info
    pods_info=$(kubectl get pods -l app="$APP_NAME" -n "$NAMESPACE" -o jsonpath='{range .items[*]}{.metadata.name},{.status.phase},{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' 2>/dev/null)
    
    if [ -z "$pods_info" ]; then
        log_error "No pods found for app '$APP_NAME'"
        HEALTH_RESULTS["pods"]="FAIL"
        return 1
    fi
    
    local total_pods=0
    local running_pods=0
    local ready_pods=0
    
    while IFS=',' read -r pod_name phase ready_status; do
        if [ -n "$pod_name" ]; then
            ((total_pods++))
            
            if [ "$phase" = "Running" ]; then
                ((running_pods++))
            fi
            
            if [ "$ready_status" = "True" ]; then
                ((ready_pods++))
            fi
            
            if [ "$VERBOSE" = true ]; then
                log_info "Pod $pod_name: $phase (Ready: $ready_status)"
            fi
        fi
    done <<< "$pods_info"
    
    HEALTH_RESULTS["pods_total"]="$total_pods"
    HEALTH_RESULTS["pods_running"]="$running_pods"
    HEALTH_RESULTS["pods_ready"]="$ready_pods"
    
    if [ "$ready_pods" -eq "$total_pods" ] && [ "$total_pods" -gt 0 ]; then
        HEALTH_RESULTS["pods"]="PASS"
        if [ "$VERBOSE" = true ]; then
            log_success "All pods are healthy ($ready_pods/$total_pods ready)"
        fi
        return 0
    else
        HEALTH_RESULTS["pods"]="FAIL"
        log_error "Not all pods are healthy ($ready_pods/$total_pods ready)"
        return 1
    fi
}

# Check Redis status
check_redis_status() {
    if [ "$VERBOSE" = true ]; then
        log_info "Checking Redis status..."
    fi
    
    # Check if Redis deployment exists
    if ! kubectl get deployment redis -n "$NAMESPACE" >/dev/null 2>&1; then
        log_warning "Redis deployment not found"
        HEALTH_RESULTS["redis"]="SKIP"
        return 0
    fi
    
    # Check Redis pod readiness
    local redis_ready
    redis_ready=$(kubectl get pods -l app=redis -n "$NAMESPACE" -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
    
    if [ "$redis_ready" = "True" ]; then
        HEALTH_RESULTS["redis"]="PASS"
        if [ "$VERBOSE" = true ]; then
            log_success "Redis is healthy"
        fi
        return 0
    else
        HEALTH_RESULTS["redis"]="FAIL"
        log_error "Redis is not healthy"
        return 1
    fi
}

# Check service status
check_service_status() {
    if [ "$VERBOSE" = true ]; then
        log_info "Checking service status..."
    fi
    
    # Check if service exists
    if ! kubectl get service "$SERVICE_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
        log_error "Service '$SERVICE_NAME' not found"
        HEALTH_RESULTS["service"]="FAIL"
        return 1
    fi
    
    # Get service endpoints
    local endpoints
    endpoints=$(kubectl get endpoints "$SERVICE_NAME" -n "$NAMESPACE" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || echo "")
    
    if [ -n "$endpoints" ]; then
        HEALTH_RESULTS["service"]="PASS"
        HEALTH_RESULTS["service_endpoints"]="$(echo "$endpoints" | wc -w)"
        
        if [ "$VERBOSE" = true ]; then
            log_success "Service has endpoints: $endpoints"
        fi
        return 0
    else
        HEALTH_RESULTS["service"]="FAIL"
        HEALTH_RESULTS["service_endpoints"]="0"
        log_error "Service has no endpoints"
        return 1
    fi
}

# Check application health endpoint
check_health_endpoint() {
    if [ "$VERBOSE" = true ]; then
        log_info "Checking application health endpoint..."
    fi
    
    local port_forward_pid=""
    local health_check_passed=false
    
    # Start port forwarding
    kubectl port-forward service/"$SERVICE_NAME" 18080:80 -n "$NAMESPACE" >/dev/null 2>&1 &
    port_forward_pid=$!
    
    # Wait for port forward to be ready
    sleep 3
    
    # Retry health check
    for ((i=1; i<=RETRY_COUNT; i++)); do
        if [ "$VERBOSE" = true ]; then
            log_info "Health check attempt $i/$RETRY_COUNT..."
        fi
        
        # Test liveness endpoint
        if curl -f -s --max-time "$TIMEOUT" http://localhost:18080/health/live >/dev/null 2>&1; then
            health_check_passed=true
            break
        fi
        
        if [ $i -lt $RETRY_COUNT ]; then
            sleep $RETRY_DELAY
        fi
    done
    
    # Clean up port forward
    if [ -n "$port_forward_pid" ]; then
        kill $port_forward_pid 2>/dev/null || true
        wait $port_forward_pid 2>/dev/null || true
    fi
    
    if [ "$health_check_passed" = true ]; then
        HEALTH_RESULTS["health_endpoint"]="PASS"
        if [ "$VERBOSE" = true ]; then
            log_success "Health endpoint is responding"
        fi
        return 0
    else
        HEALTH_RESULTS["health_endpoint"]="FAIL"
        log_error "Health endpoint is not responding"
        return 1
    fi
}

# Check ingress status
check_ingress_status() {
    if [ "$VERBOSE" = true ]; then
        log_info "Checking ingress status..."
    fi
    
    # Check if ingress exists
    local ingress_count
    ingress_count=$(kubectl get ingress -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l)
    
    if [ "$ingress_count" -gt 0 ]; then
        HEALTH_RESULTS["ingress"]="PASS"
        HEALTH_RESULTS["ingress_count"]="$ingress_count"
        
        if [ "$VERBOSE" = true ]; then
            log_success "Found $ingress_count ingress resource(s)"
            kubectl get ingress -n "$NAMESPACE"
        fi
        return 0
    else
        HEALTH_RESULTS["ingress"]="SKIP"
        if [ "$VERBOSE" = true ]; then
            log_warning "No ingress resources found"
        fi
        return 0
    fi
}

# Generate health report
generate_report() {
    local overall_status="PASS"
    local failed_checks=()
    
    # Check for failures
    for check in "${!HEALTH_RESULTS[@]}"; do
        if [[ "${HEALTH_RESULTS[$check]}" == "FAIL" ]]; then
            overall_status="FAIL"
            failed_checks+=("$check")
        fi
    done
    
    HEALTH_RESULTS["overall_status"]="$overall_status"
    HEALTH_RESULTS["timestamp"]="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    
    if [ "$JSON_OUTPUT" = true ]; then
        # Output JSON format
        echo "{"
        local first=true
        for key in $(printf '%s\n' "${!HEALTH_RESULTS[@]}" | sort); do
            if [ "$first" = true ]; then
                first=false
            else
                echo ","
            fi
            echo -n "  \"$key\": \"${HEALTH_RESULTS[$key]}\""
        done
        echo
        echo "}"
    else
        # Output human-readable format
        echo
        log_info "Health Check Report"
        echo "===================="
        echo "Timestamp: ${HEALTH_RESULTS[timestamp]}"
        echo "Overall Status: $overall_status"
        echo
        
        # Show detailed results
        for key in $(printf '%s\n' "${!HEALTH_RESULTS[@]}" | sort); do
            if [[ "$key" != "overall_status" && "$key" != "timestamp" ]]; then
                local status="${HEALTH_RESULTS[$key]}"
                local color="$NC"
                
                case "$status" in
                    "PASS") color="$GREEN" ;;
                    "FAIL") color="$RED" ;;
                    "SKIP") color="$YELLOW" ;;
                esac
                
                printf "%-25s: ${color}%s${NC}\n" "$key" "$status"
            fi
        done
        
        echo
        
        if [ "$overall_status" = "PASS" ]; then
            log_success "All health checks passed!"
        else
            log_error "Health check failed. Failed checks: ${failed_checks[*]}"
        fi
    fi
    
    # Return appropriate exit code
    if [ "$overall_status" = "PASS" ]; then
        return 0
    else
        return 1
    fi
}

# Run single health check
run_health_check() {
    # Clear previous results
    HEALTH_RESULTS=()
    
    local checks_passed=0
    local total_checks=0
    
    # Run all health checks
    ((total_checks++))
    if check_prerequisites; then ((checks_passed++)); fi
    
    ((total_checks++))
    if check_deployment_status; then ((checks_passed++)); fi
    
    ((total_checks++))
    if check_pod_status; then ((checks_passed++)); fi
    
    ((total_checks++))
    if check_redis_status; then ((checks_passed++)); fi
    
    ((total_checks++))
    if check_service_status; then ((checks_passed++)); fi
    
    ((total_checks++))
    if check_health_endpoint; then ((checks_passed++)); fi
    
    ((total_checks++))
    if check_ingress_status; then ((checks_passed++)); fi
    
    HEALTH_RESULTS["checks_passed"]="$checks_passed"
    HEALTH_RESULTS["total_checks"]="$total_checks"
    
    # Generate and display report
    generate_report
}

# Main function
main() {
    if [ "$CONTINUOUS" = true ]; then
        log_info "Starting continuous health monitoring (interval: ${INTERVAL}s)"
        log_info "Press Ctrl+C to stop"
        echo
        
        while true; do
            if [ "$JSON_OUTPUT" != true ]; then
                echo "$(date): Running health check..."
            fi
            
            run_health_check
            
            if [ "$JSON_OUTPUT" != true ]; then
                echo
                echo "Next check in ${INTERVAL} seconds..."
                echo "----------------------------------------"
            fi
            
            sleep "$INTERVAL"
        done
    else
        log_info "Running health check for Psyche Simulation..."
        run_health_check
    fi
}

# Handle script interruption
trap 'log_info "Health check interrupted"; exit 130' INT TERM

# Run main function
main "$@"