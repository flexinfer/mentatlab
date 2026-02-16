# Workspace Snapshot

- Generated: 2026-02-16
- Root: `/Users/cblevins/workspace/services/mentatlab`
- Git toplevel: `/Users/cblevins/workspace/services/mentatlab`
- Platform: `macOS-26.3-arm64-arm-64bit`
- Python: `3.12.11`

## Git
```
## main
 M services/gateway-go/main.go
 M services/orchestrator-go/internal/api/handlers.go
 M services/orchestrator-go/internal/api/handlers_m5m6.go
 M services/orchestrator-go/internal/api/handlers_test.go
 M services/orchestrator-go/internal/runstore/memory.go
 M services/orchestrator-go/internal/runstore/redis.go
 M services/orchestrator-go/internal/runstore/store.go
 M services/orchestrator-go/internal/scheduler/conditional_test.go
 M services/orchestrator-go/internal/scheduler/cron.go
 M services/orchestrator-go/internal/scheduler/foreach_test.go
 M services/orchestrator-go/internal/scheduler/m5m6_test.go
 M services/orchestrator-go/pkg/types/run.go
?? docs/roadmap-reconciliation-2026-02-16.md
```

### Remotes
```
github	https://github.com/flexinfer/mentatlab.git (fetch)
github	https://github.com/flexinfer/mentatlab.git (push)
gitlab-vm	git@gitlab.flexinfer.ai:services/mentatlab.git (fetch)
gitlab-vm	git@gitlab.flexinfer.ai:services/mentatlab.git (push)
old-origin	https://github.com/flexinfer/mentatlab.git (fetch)
old-origin	https://github.com/flexinfer/mentatlab.git (push)
origin	https://gitlab.flexinfer.ai/services/mentatlab.git (fetch)
origin	https://gitlab.flexinfer.ai/services/mentatlab.git (push)
```

### HEAD
```
58a0b9b docs: update loom context for deploy + add M7 plan
```

### Recent Commits
```
58a0b9b docs: update loom context for deploy + add M7 plan
1f659b0 fix(k8s): add nginx writable volumes to frontend deployment
85c0996 fix(k8s): use imagePullPolicy Always for :latest tags
fa4b9e1 fix(k8s): add MinIO network policies, fix bucket-init job
261a6b1 fix(k8s): use :latest image tags for Flux compatibility
45f710f feat(m5-m6): run timeouts, retry policies, gates, webhooks, cron, cloning
c6c0b27 docs: mark M4 complete, update roadmap and worklog
8581bcb feat(m4): demo mode with example flows, fix mentatctl dev run
```

## Top-Level Layout

### Directories
- `.agent/`
- `.claude/`
- `.git/`
- `.loom/`
- `.playwright-mcp/`
- `.pytest_cache/`
- `.vscode/`
- `agents/`
- `assets/`
- `cli/`
- `docs/`
- `examples/`
- `k8s/`
- `logs/`
- `schemas/`
- `scripts/`
- `services/`

### Files
- `.env.example`
- `.gitignore`
- `.gitlab-ci.yml`
- `.pdm-python`
- `.pre-commit-config.yaml`
- `.sops.yaml`
- `AGENTS.md`
- `build-and-push.sh`
- `CLAUDE.md`
- `compose-logs.txt`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `dump.rdb`
- `ENHANCEMENTS_SUMMARY.md`
- `LICENSE`
- `Makefile`
- `pdm.lock`
- `pyproject.toml`
- `pytest.ini`
- `quick-start.sh`
- `README.md`
- `ROADMAP.md`
- `run-local-dev.sh`
- `run-tests-local.sh`
- `schedule_payload.json`
- `schedule_resp.json`
- `setup.sh`
- `streaming_test_report.json`
- `test_streaming.py`
- `test_streaming_comprehensive.py`

## Key Files Detected
- `README.md`
- `AGENTS.md`
- `pyproject.toml`
- `Makefile`
- `docker-compose.yml`

## Tracked / Indexed Files (sample)
- `.agent/workflows/run_services.md`
- `.agent/workflows/setup_flux.md`
- `.claude/hookify.ci-monitoring.local.md`
- `.claude/hookify.kubectl-mutations.local.md`
- `.claude/hookify.roadmap-reminder.local.md`
- `.env.example`
- `.gitignore`
- `.gitlab-ci.yml`
- `.pdm-python`
- `.pre-commit-config.yaml`
- `.sops.yaml`
- `.vscode/launch.json`
- `.vscode/settings.json`
- `.vscode/tasks.json`
- `AGENTS.md`
- `CLAUDE.md`
- `ENHANCEMENTS_SUMMARY.md`
- `LICENSE`
- `Makefile`
- `README.md`
- `ROADMAP.md`
- `agents/__init__.py`
- `agents/common/__init__.py`
- `agents/common/emit.py`
- `agents/ctm-cogpack/Dockerfile`
- `agents/ctm-cogpack/manifest.yaml`
- `agents/ctm-cogpack/requirements.txt`
- `agents/ctm-cogpack/src/ctm/__init__.py`
- `agents/ctm-cogpack/src/ctm/attention.py`
- `agents/ctm-cogpack/src/ctm/config.py`
- `agents/ctm-cogpack/src/ctm/halting.py`
- `agents/ctm-cogpack/src/ctm/memory.py`
- `agents/ctm-cogpack/src/ctm/neuron.py`
- `agents/ctm-cogpack/src/ctm/synapse.py`
- `agents/ctm-cogpack/src/ctm/sync.py`
- `agents/ctm-cogpack/src/ctm/telemetry.py`
- `agents/ctm-cogpack/src/ctm/timekeeper.py`
- `agents/ctm-cogpack/src/main.py`
- `agents/ctm-cogpack/ui/remoteEntry.js`
- `agents/echo/__init__.py`
- `agents/echo/main.py`
- `agents/psyche-sim/Dockerfile`
- `agents/psyche-sim/README.md`
- `agents/psyche-sim/health.sh`
- `agents/psyche-sim/manifest.yaml`
- `agents/psyche-sim/pdm.lock`
- `agents/psyche-sim/prestart.sh`
- `agents/psyche-sim/pyproject.toml`
- `agents/psyche-sim/src/main.py`
- `agents/psyche-sim/ui/remoteEntry.js`
- `assets/banner.png`
- `assets/header.svg`
- `assets/icon.png`
- `build-and-push.sh`
- `cli/__init__.py`
- `cli/mentatctl/__init__.py`
- `cli/mentatctl/agent_commands.py`
- `cli/mentatctl/main.py`
- `cli/mentatctl/requirements.txt`
- `cli/mentatctl/runs_commands.py`
- `cli/mentatctl/templates/nodejs/Dockerfile`
- `cli/mentatctl/templates/nodejs/manifest.yaml`
- `cli/mentatctl/templates/nodejs/package.json`
- `cli/mentatctl/templates/nodejs/src/main.js`
- `cli/mentatctl/templates/python/Dockerfile`
- `cli/mentatctl/templates/python/manifest.yaml`
- `cli/mentatctl/templates/python/requirements.txt`
- `cli/mentatctl/templates/python/src/main.py`
- `cli/mentatctl/templates/rust/Cargo.toml`
- `cli/mentatctl/templates/rust/Dockerfile`
- `cli/mentatctl/templates/rust/manifest.yaml`
- `cli/mentatctl/templates/rust/src/main.rs`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `docs/README.md`
- `docs/_index.md`
- `docs/_toc.json`
- `docs/agent-sdk.md`
- `docs/agents.md`
- `docs/architecture.md`
- `docs/archive/sprint5/beta_milestone_architecture.md`
- `docs/archive/sprint5/beta_milestone_implementation_plan.md`
- `docs/archive/sprint5/beta_milestone_risk_assessment.md`
- `docs/archive/sprint5/beta_milestone_spec.md`
- `docs/archive/sprint5/beta_milestone_summary.md`
- `docs/archive/sprint5/beta_milestone_timeline.md`
- `docs/archive/sprint5/github-actions-assessment.md`
- `docs/archive/sprint5/sprint5_execution_plan.md`
- `docs/assets/ui/.gitkeep`
- `docs/asyncapi/gateway.yaml`
- `docs/checklists/2025-10-28-phase-1-ui-cogpaks.md`
- `docs/checklists/2025-10-28-phase-2-deprecations.md`
- `docs/checklists/2025-10-28-phase-3-runtime-polish.md`
- `docs/checklists/2025-10-28-phase-4-observability-and-scale.md`
- `docs/ci-cd-setup.md`
- `docs/developer-testing-guide.md`
- `docs/fixes/2025-10-28-ui-resolution.md`
- `docs/flows.md`
- `docs/guides/orchestrator-local-dev.md`
- `docs/local-development-guide.md`
- `docs/local-testing-guide.md`
- `docs/logs/2025-10-28-phase-1.md`
- `docs/logs/2025-10-28-phase-2.md`
- `docs/mvp-roadmap.md`
- `docs/orchestrator_design.md`
- `docs/overview.md`
- `docs/plans/2025-10-28-phase-1-ui-cogpaks.md`
- `docs/plans/2025-10-28-phase-2-deprecations.md`
- `docs/plans/2025-10-28-phase-3-runtime-polish.md`
- `docs/plans/2025-10-28-phase-4-observability-and-scale.md`
- `docs/pr-d1-plan.md`
- `docs/pr/PR-D2.md`
- `docs/pr/demo-orchestrator.md`
- `docs/references/agents-contract.md`
- `docs/references/frontend-orchestrator.md`
- `docs/references/history/README.md`
- `docs/references/orchestrator-api.md`
- `docs/status/README.md`
- `docs/status/anchors.json`
- `docs/status/project-status.yaml`
- `docs/ui-mission-control.md`
- `docs/v1.0_milestone_spec.md`
- `docs/v1.0_milestone_summary.md`
- `docs/v1.0_pki_implementation_guide.md`
- `docs/v1.0_wasm_runtime_implementation_guide.md`
- `docs/v1.1_milestone_spec.md`
- `docs/v1.1_milestone_summary.md`
- `docs/v2.0_milestone_spec.md`
- `docs/v2.0_milestone_spec_part2.md`
- `docs/v2.0_milestone_summary.md`
- `docs/webui_beta_gap_analysis.md`
- `docs/webui_rearchitecture_plan.md`
- `dump.rdb`
- `examples/hello_chat.json`
- `examples/psyche-simulation/agents/__init__.py`
- `examples/psyche-simulation/agents/anima_animus.py`
- `examples/psyche-simulation/agents/base.py`
- `examples/psyche-simulation/agents/ego.py`
- `examples/psyche-simulation/agents/persona.py`
- `examples/psyche-simulation/agents/self_agent.py`
- `examples/psyche-simulation/agents/shadow.py`
- `examples/psyche-simulation/analysis/__init__.py`
- `examples/psyche-simulation/analysis/analytics_export_integration.py`
- `examples/psyche-simulation/analysis/real_time_analytics.py`
- `examples/psyche-simulation/analysis/sentiment.py`
- `examples/psyche-simulation/auth/__init__.py`
- `examples/psyche-simulation/auth/session_handler.py`
- `examples/psyche-simulation/auth/user_manager.py`
- `examples/psyche-simulation/auth_test_results.json`
- `examples/psyche-simulation/clear_cache_and_restart.py`
- `examples/psyche-simulation/comprehensive_auth_test.py`
- `examples/psyche-simulation/config/__init__.py`
- `examples/psyche-simulation/config/config.py`
- `examples/psyche-simulation/data/__init__.py`
- `examples/psyche-simulation/data/redis_integration.py`
- `examples/psyche-simulation/data/redis_manager.py`
- `examples/psyche-simulation/data/redis_state_manager.py`
- `examples/psyche-simulation/deploy.sh`
- `examples/psyche-simulation/diagnose/diagnose_litellm_issue.py`
- `examples/psyche-simulation/diagnose/diagnose_nicegui_javascript.py`
- `examples/psyche-simulation/diagnose/diagnose_realtime_system.py`
- `examples/psyche-simulation/diagnose/diagnose_streaming_connection.py`
- `examples/psyche-simulation/diagnose/diagnose_ui_context.py`
- `examples/psyche-simulation/diagnose/diagnose_ui_context_simple.py`
- `examples/psyche-simulation/diagnose/diagnose_websocket_realtime.py`
- `examples/psyche-simulation/docker/.dockerignore`
- `examples/psyche-simulation/docker/Dockerfile`
- `examples/psyche-simulation/docker/docker-compose.yml`
- `examples/psyche-simulation/docker/healthcheck.sh`
- `examples/psyche-simulation/docs/FIXES_PLAN.md`
- `examples/psyche-simulation/docs/KUBERNETES_DEPLOYMENT_STATUS.md`
- `examples/psyche-simulation/docs/LLM_MODEL_RECOMMENDATIONS.md`
- `examples/psyche-simulation/docs/NiceGUI.md`
- `examples/psyche-simulation/docs/PLAN.md`
- `examples/psyche-simulation/docs/REALTIME_VISUALIZATION_ARCHITECTURE.md`
- `examples/psyche-simulation/docs/STREAMING_UI_MODE.md`
- `examples/psyche-simulation/docs/litellm-fix-summary.md`
- `examples/psyche-simulation/docs/litellm_config_comparison.md`
- `examples/psyche-simulation/docs/nicegui_layout_fix_complete.md`
- `examples/psyche-simulation/docs/nicegui_layout_fix_summary.md`
- `examples/psyche-simulation/docs/real_time_ui_fix_summary.md`
- `examples/psyche-simulation/docs/realtime_streaming_fix_guide.md`
- `examples/psyche-simulation/docs/realtime_streaming_implementation_complete.md`
- `examples/psyche-simulation/docs/realtime_ui_diagnosis_report.md`
- `examples/psyche-simulation/docs/realtime_ui_updates_complete.md`
- `examples/psyche-simulation/docs/websocket_events_guide.md`
- `examples/psyche-simulation/docs/websocket_progress_fix_summary.md`
- `examples/psyche-simulation/docs/websocket_storage_fix_complete.md`
- `examples/psyche-simulation/examples/cytoscape_integration_demo.py`
- `examples/psyche-simulation/examples/security_integration_demo.py`
- `examples/psyche-simulation/examples/websocket_demo.py`
- `examples/psyche-simulation/final_websocket_fix_results.json`
- `examples/psyche-simulation/health-check.sh`
- `examples/psyche-simulation/k8s/README.md`
- `examples/psyche-simulation/k8s/configmap.yaml`
- `examples/psyche-simulation/k8s/deployment.yaml`
- `examples/psyche-simulation/k8s/environments/development.yaml`
- `examples/psyche-simulation/k8s/environments/production.yaml`
- `examples/psyche-simulation/k8s/environments/staging.yaml`
- `examples/psyche-simulation/k8s/hpa.yaml`
- `…`

## AGENTS.md Files
- `AGENTS.md`

### AGENTS.md Contents (head)

#### `AGENTS.md`
```
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

## Planning
- See `ROADMAP.md` for project status and plans.
```

## Notes
- Add MCP inventory via the plan-loom-core workflow (see `.loom/00-mcp-inventory.md`).
