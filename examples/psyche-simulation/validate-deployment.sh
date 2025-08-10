#!/bin/bash

# Psyche Simulation Kubernetes Validation Script
# This script validates the Kubernetes manifests and deployment configuration

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="${SCRIPT_DIR}/k8s"

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

# Validation results
VALIDATION_ERRORS=0
VALIDATION_WARNINGS=0

# Increment error counter
error() {
    log_error "$1"
    ((VALIDATION_ERRORS++))
}

# Increment warning counter
warning() {
    log_warning "$1"
    ((VALIDATION_WARNINGS++))
}

# Check if required tools are installed
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing_tools=()
    
    # Check kubectl
    if ! command -v kubectl >/dev/null 2>&1; then
        missing_tools+=("kubectl")
    fi
    
    # Check docker
    if ! command -v docker >/dev/null 2>&1; then
        missing_tools+=("docker")
    fi
    
    # Check yamllint (optional)
    if ! command -v yamllint >/dev/null 2>&1; then
        warning "yamllint not found - YAML syntax validation will be limited"
    fi
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        error "Missing required tools: ${missing_tools[*]}"
        return 1
    fi
    
    log_success "Prerequisites check passed"
    return 0
}

# Validate YAML syntax
validate_yaml_syntax() {
    log_info "Validating YAML syntax..."
    
    local yaml_files=(
        "$K8S_DIR/namespace.yaml"
        "$K8S_DIR/configmap.yaml"
        "$K8S_DIR/secrets.yaml"
        "$K8S_DIR/deployment.yaml"
        "$K8S_DIR/service.yaml"
        "$K8S_DIR/ingress.yaml"
        "$K8S_DIR/redis-deployment.yaml"
        "$K8S_DIR/hpa.yaml"
    )
    
    for file in "${yaml_files[@]}"; do
        if [ -f "$file" ]; then
            if kubectl apply --dry-run=client -f "$file" >/dev/null 2>&1; then
                log_success "✓ $(basename "$file") - YAML syntax valid"
            else
                error "✗ $(basename "$file") - YAML syntax invalid"
            fi
        else
            error "✗ $(basename "$file") - File not found"
        fi
    done
}

# Validate Kubernetes resources
validate_k8s_resources() {
    log_info "Validating Kubernetes resource definitions..."
    
    # Check deployment
    if [ -f "$K8S_DIR/deployment.yaml" ]; then
        if kubectl apply --dry-run=client -f "$K8S_DIR/deployment.yaml" >/dev/null 2>&1; then
            log_success "✓ Deployment manifest is valid"
            
            # Check specific deployment requirements
            if grep -q "livenessProbe" "$K8S_DIR/deployment.yaml"; then
                log_success "✓ Deployment has liveness probe"
            else
                warning "⚠ Deployment missing liveness probe"
            fi
            
            if grep -q "readinessProbe" "$K8S_DIR/deployment.yaml"; then
                log_success "✓ Deployment has readiness probe"
            else
                warning "⚠ Deployment missing readiness probe"
            fi
            
            if grep -q "resources:" "$K8S_DIR/deployment.yaml"; then
                log_success "✓ Deployment has resource limits"
            else
                warning "⚠ Deployment missing resource limits"
            fi
            
        else
            error "✗ Deployment manifest is invalid"
        fi
    else
        error "✗ Deployment manifest not found"
    fi
    
    # Check service
    if [ -f "$K8S_DIR/service.yaml" ]; then
        if kubectl apply --dry-run=client -f "$K8S_DIR/service.yaml" >/dev/null 2>&1; then
            log_success "✓ Service manifest is valid"
        else
            error "✗ Service manifest is invalid"
        fi
    else
        error "✗ Service manifest not found"
    fi
    
    # Check Redis deployment
    if [ -f "$K8S_DIR/redis-deployment.yaml" ]; then
        if kubectl apply --dry-run=client -f "$K8S_DIR/redis-deployment.yaml" >/dev/null 2>&1; then
            log_success "✓ Redis deployment manifest is valid"
        else
            error "✗ Redis deployment manifest is invalid"
        fi
    else
        error "✗ Redis deployment manifest not found"
    fi
}

# Validate Docker configuration
validate_docker_config() {
    log_info "Validating Docker configuration..."
    
    # Check Dockerfile
    if [ -f "docker/Dockerfile" ]; then
        log_success "✓ Dockerfile found"
        
        # Check for multi-stage build
        if grep -q "FROM.*AS" docker/Dockerfile; then
            log_success "✓ Multi-stage Dockerfile detected"
        else
            warning "⚠ Single-stage Dockerfile (consider multi-stage for optimization)"
        fi
        
        # Check for non-root user
        if grep -q "USER.*[0-9]" docker/Dockerfile; then
            log_success "✓ Non-root user configured"
        else
            warning "⚠ Consider using non-root user for security"
        fi
        
        # Check for health check
        if grep -q "HEALTHCHECK" docker/Dockerfile; then
            log_success "✓ Docker health check configured"
        else
            warning "⚠ Docker health check not configured"
        fi
        
    else
        error "✗ Dockerfile not found"
    fi
    
    # Check .dockerignore
    if [ -f "docker/.dockerignore" ]; then
        log_success "✓ .dockerignore found"
    else
        warning "⚠ .dockerignore not found (consider adding for smaller images)"
    fi
    
    # Check docker-compose.yml
    if [ -f "docker/docker-compose.yml" ]; then
        log_success "✓ docker-compose.yml found for local development"
    else
        warning "⚠ docker-compose.yml not found (consider adding for local development)"
    fi
}

# Validate secrets configuration
validate_secrets() {
    log_info "Validating secrets configuration..."
    
    if [ -f "$K8S_DIR/secrets.yaml" ]; then
        log_success "✓ Secrets manifest found"
        
        # Check for base64 encoded values
        if grep -q "data:" "$K8S_DIR/secrets.yaml"; then
            log_success "✓ Secrets contain data fields"
        else
            warning "⚠ Secrets may not contain data fields"
        fi
        
        # Warn about production secrets
        log_warning "⚠ Remember to update secrets with production values before deployment"
        
    else
        error "✗ Secrets manifest not found"
    fi
}

# Validate health check implementation
validate_health_checks() {
    log_info "Validating health check implementation..."
    
    # Check if health check utility exists
    if [ -f "utils/health_check.py" ]; then
        log_success "✓ Health check utility found"
    else
        error "✗ Health check utility not found"
    fi
    
    # Check if main application has health endpoints
    if grep -q "health" psyche_simulation.py; then
        log_success "✓ Health endpoints integrated in main application"
    else
        warning "⚠ Health endpoints may not be integrated in main application"
    fi
    
    # Check if health check script exists
    if [ -f "health-check.sh" ]; then
        log_success "✓ Health check script found"
        
        if [ -x "health-check.sh" ]; then
            log_success "✓ Health check script is executable"
        else
            warning "⚠ Health check script is not executable"
        fi
    else
        error "✗ Health check script not found"
    fi
}

# Validate deployment scripts
validate_deployment_scripts() {
    log_info "Validating deployment scripts..."
    
    local scripts=("deploy.sh" "rollback.sh" "health-check.sh")
    
    for script in "${scripts[@]}"; do
        if [ -f "$script" ]; then
            log_success "✓ $script found"
            
            if [ -x "$script" ]; then
                log_success "✓ $script is executable"
            else
                warning "⚠ $script is not executable"
            fi
            
            # Check for help option
            if grep -q "show_help" "$script"; then
                log_success "✓ $script has help documentation"
            else
                warning "⚠ $script may not have help documentation"
            fi
            
        else
            error "✗ $script not found"
        fi
    done
}

# Validate environment configurations
validate_environments() {
    log_info "Validating environment configurations..."
    
    local environments=("development" "staging" "production")
    
    for env in "${environments[@]}"; do
        local env_file="$K8S_DIR/environments/${env}.yaml"
        if [ -f "$env_file" ]; then
            log_success "✓ $env environment configuration found"
            
            if kubectl apply --dry-run=client -f "$env_file" >/dev/null 2>&1; then
                log_success "✓ $env environment manifest is valid"
            else
                error "✗ $env environment manifest is invalid"
            fi
        else
            warning "⚠ $env environment configuration not found"
        fi
    done
}

# Validate security configuration
validate_security() {
    log_info "Validating security configuration..."
    
    # Check for security contexts in deployment
    if [ -f "$K8S_DIR/deployment.yaml" ]; then
        if grep -q "securityContext" "$K8S_DIR/deployment.yaml"; then
            log_success "✓ Security contexts configured"
        else
            warning "⚠ Security contexts not configured"
        fi
        
        if grep -q "runAsNonRoot" "$K8S_DIR/deployment.yaml"; then
            log_success "✓ Non-root execution configured"
        else
            warning "⚠ Non-root execution not configured"
        fi
        
        if grep -q "readOnlyRootFilesystem" "$K8S_DIR/deployment.yaml"; then
            log_success "✓ Read-only root filesystem configured"
        else
            warning "⚠ Read-only root filesystem not configured"
        fi
    fi
    
    # Check for network policies
    if [ -f "$K8S_DIR/networkpolicy.yaml" ]; then
        log_success "✓ Network policies found"
    else
        warning "⚠ Network policies not found (consider adding for production)"
    fi
    
    # Check ingress security
    if [ -f "$K8S_DIR/ingress.yaml" ]; then
        if grep -q "ssl-redirect" "$K8S_DIR/ingress.yaml"; then
            log_success "✓ SSL redirect configured in ingress"
        else
            warning "⚠ SSL redirect not configured in ingress"
        fi
        
        if grep -q "cert-manager" "$K8S_DIR/ingress.yaml"; then
            log_success "✓ Automatic certificate management configured"
        else
            warning "⚠ Automatic certificate management not configured"
        fi
    fi
}

# Check file structure
validate_file_structure() {
    log_info "Validating file structure..."
    
    local required_files=(
        "psyche_simulation.py"
        "requirements.txt"
        "k8s/namespace.yaml"
        "k8s/deployment.yaml"
        "k8s/service.yaml"
        "k8s/configmap.yaml"
        "k8s/secrets.yaml"
        "docker/Dockerfile"
        "deploy.sh"
        "health-check.sh"
    )
    
    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            log_success "✓ $file exists"
        else
            error "✗ $file missing"
        fi
    done
    
    local recommended_files=(
        "k8s/ingress.yaml"
        "k8s/hpa.yaml"
        "k8s/redis-deployment.yaml"
        "rollback.sh"
        "docker/.dockerignore"
        "k8s/README.md"
    )
    
    for file in "${recommended_files[@]}"; do
        if [ -f "$file" ]; then
            log_success "✓ $file exists"
        else
            warning "⚠ $file recommended but missing"
        fi
    done
}

# Generate validation report
generate_report() {
    echo
    log_info "Validation Report"
    echo "=================="
    
    if [ $VALIDATION_ERRORS -eq 0 ] && [ $VALIDATION_WARNINGS -eq 0 ]; then
        log_success "✅ All validations passed! Deployment is ready."
        echo
        log_info "Next steps:"
        echo "1. Update secrets with production values"
        echo "2. Configure container registry"
        echo "3. Run: ./deploy.sh --dry-run"
        echo "4. Deploy: ./deploy.sh"
        return 0
    else
        echo "Summary:"
        echo "  Errors: $VALIDATION_ERRORS"
        echo "  Warnings: $VALIDATION_WARNINGS"
        echo
        
        if [ $VALIDATION_ERRORS -gt 0 ]; then
            log_error "❌ Validation failed. Please fix errors before deployment."
            return 1
        else
            log_warning "⚠️  Validation passed with warnings. Review warnings before production deployment."
            return 0
        fi
    fi
}

# Main validation function
main() {
    log_info "Starting Psyche Simulation Kubernetes deployment validation..."
    echo
    
    check_prerequisites
    validate_file_structure
    validate_yaml_syntax
    validate_k8s_resources
    validate_docker_config
    validate_secrets
    validate_health_checks
    validate_deployment_scripts
    validate_environments
    validate_security
    
    generate_report
}

# Handle script interruption
trap 'log_error "Validation interrupted"; exit 130' INT TERM

# Run main function
main "$@"