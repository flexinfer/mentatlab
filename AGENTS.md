# Agent Working Notes (mentatlab)

## Scope

This file applies to the `services/mentatlab` repository.

## Repository Purpose

MentatLab - AI agent orchestration platform. Provides a gateway, orchestrator, and frontend for managing AI agents.

## Workspace Structure

This repo is part of the `services/` GitLab group:

```text
gitlab.flexinfer.ai/
├── platform/gitops    ← K8s manifests, Flux, CI infrastructure
└── services/
    └── mentatlab      ← YOU ARE HERE (agent orchestration)
```

## Deployment (GitOps)

This service has multiple components deployed to Kubernetes. Manifests in this repo:

- `k8s/namespace.yaml` - mentatlab namespace
- `k8s/gateway.yaml` - API gateway
- `k8s/orchestrator.yaml` - Agent orchestrator
- `k8s/orchestrator-rbac.yaml` - RBAC for orchestrator
- `k8s/frontend.yaml` - Web UI
- `k8s/redis.yaml` - Redis for state/messaging
- `k8s/echoagent.yaml` - Example echo agent
- `k8s/ingress.yaml` - Ingress configuration

For GitOps deployment via Flux:

1. Build and push container images
2. Update image tags in `k8s/*.yaml`
3. Reference from `platform/gitops/k3s/ai/mentatlab/` or apply directly
4. Flux will reconcile (or use `k8s/deploy.sh` for direct apply)

Container Images:

- Gateway: `registry.harbor.lan/library/mentatlab-gateway`
- Orchestrator: `registry.harbor.lan/library/mentatlab-orchestrator`
- Frontend: `registry.harbor.lan/library/mentatlab-frontend`

Build:

```bash
./build-and-push.sh
```

## Local Development

```bash
# Install dependencies
pdm install

# Start with docker-compose
docker-compose up -d

# Or run services individually
pdm run python -m services.gateway
pdm run python -m services.orchestrator
```

## Architecture

```text
                    ┌─────────────┐
                    │   Ingress   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌────▼────┐ ┌─────▼─────┐
        │  Gateway  │ │Frontend │ │  Agents   │
        └─────┬─────┘ └─────────┘ └─────▲─────┘
              │                         │
        ┌─────▼─────┐                   │
        │Orchestrator├──────────────────┘
        └─────┬─────┘
              │
        ┌─────▼─────┐
        │   Redis   │
        └───────────┘
```

## CI/CD

GitLab CI is configured in `.gitlab-ci.yml` for automated builds.
