# Psyche Simulation Kubernetes Deployment

This directory contains production-ready Kubernetes manifests for deploying the Psyche Simulation system.

## Overview

The Psyche Simulation is a Jungian-inspired self-simulation application built with NiceGUI, featuring:
- Multi-agent psychological simulation system
- Real-time WebSocket communication
- Redis for state management and pub/sub
- JWT-based authentication and session management
- Health monitoring and metrics collection
- Horizontal auto-scaling

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Ingress     │────│    Service      │────│   Deployment   │
│   (SSL/TLS)     │    │ (Load Balancer) │    │  (2-10 Pods)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                       ┌─────────────────┐             │
                       │      Redis      │─────────────┘
                       │   (Persistent)  │
                       └─────────────────┘
```

## Quick Start

### Prerequisites

- Kubernetes cluster (v1.20+)
- kubectl configured
- Docker registry access
- Helm (optional, for cert-manager)

### Basic Deployment

1. **Build and push Docker image:**
   ```bash
   ./deploy.sh --dry-run  # Preview deployment
   ./deploy.sh            # Deploy to production
   ```

2. **Deploy to specific environment:**
   ```bash
   ./deploy.sh -e dev     # Development
   ./deploy.sh -e staging # Staging
   ./deploy.sh -e prod    # Production
   ```

3. **Check deployment status:**
   ```bash
   ./health-check.sh
   ```

## Directory Structure

```
k8s/
├── namespace.yaml              # Namespace definition
├── configmap.yaml             # Application configuration
├── secrets.yaml               # Encrypted secrets
├── deployment.yaml            # Main application deployment
├── service.yaml               # Service definitions
├── ingress.yaml               # External access configuration
├── redis-deployment.yaml     # Redis deployment and services
├── hpa.yaml                   # Horizontal Pod Autoscaler
├── environments/              # Environment-specific configs
│   ├── development.yaml
│   ├── staging.yaml
│   └── production.yaml
└── README.md                  # This file
```

## Components

### Core Services

- **psyche-simulation**: Main application (NiceGUI + FastAPI)
- **redis**: State management and pub/sub messaging
- **ingress**: SSL termination and routing

### Configuration

- **ConfigMaps**: Environment variables and application settings
- **Secrets**: Encrypted passwords, API keys, and certificates
- **Environment-specific**: Development, staging, and production configs

### Scaling & Monitoring

- **HPA**: Automatic scaling based on CPU/memory usage
- **Health Checks**: Liveness and readiness probes
- **Metrics**: Prometheus-compatible metrics endpoint

## Environment Configurations

### Development
- **Namespace**: `psyche-simulation-dev`
- **Replicas**: 1
- **Resources**: 256Mi RAM, 100m CPU
- **Log Level**: DEBUG
- **Features**: Hot reload, verbose logging

### Staging
- **Namespace**: `psyche-simulation-staging`
- **Replicas**: 2
- **Resources**: 1Gi RAM, 200m CPU
- **Log Level**: INFO
- **Features**: Production-like setup

### Production
- **Namespace**: `psyche-simulation`
- **Replicas**: 3 (auto-scales 2-10)
- **Resources**: 1Gi RAM, 250m CPU
- **Log Level**: INFO
- **Features**: Full security, monitoring

## Security Features

### Container Security
- Non-root user execution
- Read-only root filesystem
- Security contexts with capability dropping
- Resource limits and requests

### Network Security
- NetworkPolicies for pod communication
- SSL/TLS termination at ingress
- Service mesh ready (Istio compatible)

### Secrets Management
- Kubernetes secrets for sensitive data
- Encrypted secrets at rest
- Separate secrets per environment

## Deployment Scripts

### deploy.sh
Automated deployment script with features:
- Multi-environment support
- Docker build and push
- Health check validation
- Rollback capability
- Dry-run mode

```bash
./deploy.sh [OPTIONS]
  -e, --environment ENV    Environment (dev/staging/prod)
  -v, --version VERSION    Build version tag
  -r, --registry URL       Container registry URL
  --skip-build            Skip Docker build
  --dry-run               Preview deployment
  --cleanup               Clean existing deployment
```

### rollback.sh
Safe rollback functionality:
- Revision-based rollback
- Health check validation
- Deployment status monitoring

```bash
./rollback.sh [OPTIONS]
  -r, --revision NUM      Rollback to specific revision
  --list-revisions        Show available revisions
  --check-health          Validate after rollback
```

### health-check.sh
Comprehensive health monitoring:
- Deployment status
- Pod health
- Service endpoints
- Application health endpoints
- Continuous monitoring mode

```bash
./health-check.sh [OPTIONS]
  --verbose               Detailed output
  --continuous           Continuous monitoring
  --json                 JSON output format
```

## Monitoring & Observability

### Health Endpoints
- `/health/live`: Liveness probe (application running)
- `/health/ready`: Readiness probe (ready for traffic)
- `/health`: Comprehensive health check
- `/metrics`: Prometheus metrics

### Metrics
- Application performance metrics
- Redis connectivity status
- WebSocket connection counts
- Memory and CPU usage
- Request rates and response times

### Logging
- Structured JSON logging
- Centralized log aggregation ready
- Log levels per environment
- Request tracing support

## SSL/TLS Configuration

### Automatic Certificates (Recommended)
```bash
# Install cert-manager
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true

# Certificates will be automatically provisioned
```

### Manual Certificates
Update `k8s/secrets.yaml` with your certificates:
```yaml
data:
  tls.crt: <base64-encoded-certificate>
  tls.key: <base64-encoded-private-key>
```

## Troubleshooting

### Common Issues

1. **Pods not starting:**
   ```bash
   kubectl describe pods -n psyche-simulation
   kubectl logs -f deployment/psyche-simulation -n psyche-simulation
   ```

2. **Redis connection issues:**
   ```bash
   kubectl exec -it deployment/redis -n psyche-simulation -- redis-cli ping
   ```

3. **Health check failures:**
   ```bash
   ./health-check.sh --verbose
   kubectl port-forward service/psyche-simulation-service 8080:80 -n psyche-simulation
   curl http://localhost:8080/health
   ```

4. **Ingress not working:**
   ```bash
   kubectl get ingress -n psyche-simulation
   kubectl describe ingress psyche-simulation-ingress -n psyche-simulation
   ```

### Debug Commands

```bash
# Check deployment status
kubectl get all -n psyche-simulation

# View recent events
kubectl get events -n psyche-simulation --sort-by='.lastTimestamp'

# Check resource usage
kubectl top pods -n psyche-simulation

# View application logs
kubectl logs -f deployment/psyche-simulation -n psyche-simulation

# Access application directly
kubectl port-forward service/psyche-simulation-service 8080:80 -n psyche-simulation
```

## Customization

### Resource Limits
Edit resource limits in deployment manifests:
```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "1Gi"
    cpu: "1000m"
```

### Scaling Configuration
Modify HPA settings in `hpa.yaml`:
```yaml
spec:
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        averageUtilization: 70
```

### Environment Variables
Update ConfigMaps for application settings:
```yaml
data:
  LOG_LEVEL: "DEBUG"
  REDIS_MAX_CONNECTIONS: "50"
  LLM_TIMEOUT: "180"
```

## Performance Optimization

### Redis Configuration
- Memory limit: 256MB with LRU eviction
- Persistence: RDB snapshots
- Connection pooling: 50 max connections

### Application Optimization
- Multi-stage Docker builds
- Non-root container execution
- Resource limits and requests
- Horizontal pod autoscaling

### Network Optimization
- Service mesh ready
- WebSocket session affinity
- Connection keep-alive
- Rate limiting at ingress

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review application logs
3. Use health check scripts
4. Consult Kubernetes documentation

## License

This deployment configuration is part of the Psyche Simulation project.