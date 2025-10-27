# MentatLab Kubernetes Deployment

This directory contains Kubernetes manifests for deploying MentatLab to k3s.

## Architecture

- **Namespace**: `mentatlab`
- **Redis**: Data persistence for RunStore (port 6379)
- **Orchestrator**: Backend orchestration service (port 7070)
- **Gateway**: API gateway (port 8080)
- **Frontend**: Web UI (port 5173, LoadBalancer)
- **EchoAgent**: Demo agent

## Prerequisites

1. **k3s cluster** running and accessible
2. **kubectl** configured to access your cluster
3. **Docker images** built and pushed to `registry.harbor.lan/library`

## Quick Deploy

Deploy all services (build, push, apply, rollout):

```bash
cd k8s
./deploy.sh -r registry.harbor.lan/library -t $(git rev-parse --short HEAD)
```

Common options:

```bash
./deploy.sh [options]

Options:
  -n, --namespace   Kubernetes namespace (default: mentatlab)
  -r, --registry    Container registry (default: registry.harbor.lan/library)
  -t, --tag         Image tag (default: git SHA or timestamp)
  -i, --images      Comma list: orchestrator,gateway,frontend[,echoagent]
  --apply-only      Apply manifests and set image if TAG given (no build/push)
  --skip-build      Skip docker build
  --skip-push       Skip docker push
  --fast            Don’t wait for rollout
  --dry-run         Print actions without executing
  --frontend-gateway-url URL   Build-time VITE_GATEWAY_BASE_URL for frontend
  --frontend-orch-url URL      Build-time VITE_ORCHESTRATOR_URL for frontend
```

## Manual Deployment

Apply manifests in order (idempotent):

```bash
kubectl apply -f namespace.yaml
kubectl apply -f redis.yaml
kubectl apply -f orchestrator.yaml
kubectl apply -f gateway.yaml
kubectl apply -f frontend.yaml
kubectl apply -f echoagent.yaml
```

## Verify Deployment

Check pod status:
```bash
kubectl get pods -n mentatlab
```

Check services:
```bash
kubectl get services -n mentatlab
```

Watch pods come up:
```bash
kubectl get pods -n mentatlab -w
```

## Access the Application

Using Ingress (recommended):
1) Point the hostname to your k3s node IP, e.g. add to `/etc/hosts`:
   `192.168.50.243 mentatlab.local`
2) Open: `http://mentatlab.local/`

LoadBalancer (legacy):
```bash
kubectl get service frontend -n mentatlab
```
Then access: `http://<EXTERNAL-IP>:5173`

Note: In production, the browser must reach the API endpoints.
Pass publicly reachable URLs for the frontend build when needed, for example:

```bash
./deploy.sh -r registry.harbor.lan/library -t $(git rev-parse --short HEAD) \
  --frontend-gateway-url http://<gateway-lb-ip-or-dns>:8080 \
  --frontend-orch-url http://<orchestrator-lb-ip-or-dns>:7070
```

Alternatively, put Gateway and Frontend behind a single Ingress and keep
frontend API calls same-origin (recommended for CORS simplicity).

## View Logs

Orchestrator logs:
```bash
kubectl logs -f deployment/orchestrator -n mentatlab
```

Gateway logs:
```bash
kubectl logs -f deployment/gateway -n mentatlab
```

Frontend logs:
```bash
kubectl logs -f deployment/frontend -n mentatlab
```

Redis logs:
```bash
kubectl logs -f deployment/redis -n mentatlab
```

## Environment Variables

### Orchestrator
- `PORT=7070` - HTTP server port
- `ORCH_RUNSTORE=redis` - Use Redis for persistence
- `REDIS_URL=redis://redis:6379/0` - Redis connection string

### Gateway
- `PORT=8080` - HTTP server port
- `ORCHESTRATOR_URL=http://orchestrator:7070` - Orchestrator service URL

### Frontend
- `PORT=5173` - HTTP server port
- `VITE_GATEWAY_BASE_URL=http://gateway:8080` - Gateway API URL

## Resource Limits

### Redis
- Requests: 100m CPU, 256Mi RAM
- Limits: 500m CPU, 2Gi RAM
- Max memory: 2GB with LRU eviction

### Orchestrator
- Requests: 200m CPU, 512Mi RAM
- Limits: 1000m CPU, 2Gi RAM

### Gateway
- Requests: 200m CPU, 512Mi RAM
- Limits: 1000m CPU, 2Gi RAM

### Frontend
- Requests: 100m CPU, 256Mi RAM
- Limits: 500m CPU, 1Gi RAM

### EchoAgent
- Requests: 50m CPU, 128Mi RAM
- Limits: 200m CPU, 512Mi RAM

## Health Checks

Orchestrator and Gateway have health endpoints configured:
- Liveness probe: `/health` (initial 30s, period 10s)
- Readiness probe: `/health` (initial 5s, period 5s)

## Scaling

Scale deployments:
```bash
kubectl scale deployment/<service-name> --replicas=3 -n mentatlab
```

Example:
```bash
kubectl scale deployment/gateway --replicas=3 -n mentatlab
```

## Update Images

After pushing new images, restart deployments:
```bash
kubectl rollout restart deployment/<service-name> -n mentatlab
```

Or update all:
```bash
kubectl rollout restart deployment -n mentatlab
```

## Cleanup

Delete all resources:
```bash
kubectl delete namespace mentatlab
```

## Troubleshooting

### Pods not starting
Check events:
```bash
kubectl describe pod <pod-name> -n mentatlab
```

### ImagePullBackOff errors
Verify images are accessible:
```bash
kubectl describe pod <pod-name> -n mentatlab | grep -A 5 Events
```

You may need to create an image pull secret for your Harbor registry:
```bash
kubectl create secret docker-registry harbor-secret \
  --docker-server=registry.harbor.lan \
  --docker-username=<your-username> \
  --docker-password=<your-password> \
  -n mentatlab
```

Then add to deployment spec:
```yaml
spec:
  imagePullSecrets:
    - name: harbor-secret
```

### Service connectivity issues
Test service DNS:
```bash
kubectl run -it --rm debug --image=busybox --restart=Never -n mentatlab -- nslookup orchestrator
```

### Redis connection issues
Check Redis is running:
```bash
kubectl exec -it deployment/redis -n mentatlab -- redis-cli ping
```

## Production Considerations

For production deployments, consider:

1. **Persistent Volumes**: Replace emptyDir with PersistentVolumeClaim for Redis
2. **Ingress**: Add Ingress for external access instead of LoadBalancer
3. **TLS**: Configure TLS certificates
4. **Secrets**: Use Kubernetes Secrets for sensitive data
5. **Resource Quotas**: Set namespace resource quotas
6. **Network Policies**: Restrict pod-to-pod communication
7. **Monitoring**: Add Prometheus/Grafana for metrics
8. **Logging**: Configure centralized logging
9. **Backups**: Implement Redis backup strategy
10. **High Availability**: Run multiple replicas with pod anti-affinity
