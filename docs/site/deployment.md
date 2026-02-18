# Deployment

MentatLab is deployed through GitOps (Flux CD) to K3s.

## Kubernetes Manifests

Located in `k8s/`:

- `namespace.yaml` - namespace
- `gateway.yaml` - API gateway
- `orchestrator.yaml` - orchestration service
- `orchestrator-rbac.yaml` - RBAC permissions for orchestrator
- `frontend.yaml` - web UI
- `redis.yaml` - Redis backend
- `echoagent.yaml` - sample agent
- `ingress.yaml` - ingress routes

## Container Images

- `registry.harbor.lan/library/mentatlab-gateway-go`
- `registry.harbor.lan/library/mentatlab-orchestrator-go`
- `registry.harbor.lan/library/mentatlab-frontend`

## Build and Push

```bash
./build-and-push.sh
```

Build without push:

```bash
./build-and-push.sh --skip-push
```

## Deploy

```bash
./k8s/deploy.sh --namespace mentatlab
```

## Runtime Configuration

Important environment variables:

- `REDIS_URL`
- `ORCHESTRATOR_BASE_URL`
- `ORCH_RUNSTORE` (`memory`, `redis`, or `k8s`)
- `PORT`

## Operational Checks

- Verify pods are `Running` in `mentatlab` namespace
- Verify gateway/orchestrator health endpoints
- Validate run execution with a known flow
- Confirm event stream delivery from orchestrator through gateway
