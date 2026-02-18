# API Reference

MentatLab APIs are served by the orchestrator under `/api/v1` (typically through the gateway).

## Runs

- `GET /api/v1/runs` - List runs
- `POST /api/v1/runs` - Create run
- `GET /api/v1/runs/{id}` - Get run details
- `DELETE /api/v1/runs/{id}` - Delete run
- `POST /api/v1/runs/{id}/start` - Start run execution
- `GET /api/v1/runs/{id}/events` - Stream run events (SSE)
- `POST /api/v1/runs/{id}/clone` - Clone run (optional auto start)
- `POST /api/v1/runs/{id}/nodes/{nodeId}/approve` - Approve gate node
- `POST /api/v1/runs/{id}/nodes/{nodeId}/reject` - Reject gate node

## Flows

- `GET /api/v1/flows` - List flows
- `POST /api/v1/flows` - Create flow
- `GET /api/v1/flows/{id}` - Get flow
- `PUT /api/v1/flows/{id}` - Update flow
- `DELETE /api/v1/flows/{id}` - Delete flow
- `POST /api/v1/flows/{id}/run` - Create and start run from flow

## Agents

- `GET /api/v1/agents` - List agents
- `POST /api/v1/agents` - Register agent
- `GET /api/v1/agents/{id}` - Get agent
- `PUT /api/v1/agents/{id}` - Update agent
- `DELETE /api/v1/agents/{id}` - Delete agent

## Webhooks and Scheduling

- `POST /api/v1/webhooks` - Create webhook for flow
- `POST /api/v1/webhooks/trigger/{flowId}` - Trigger flow via webhook
- `GET /api/v1/schedules` - List schedules
- `POST /api/v1/schedules` - Create schedule
- `GET /api/v1/schedules/{id}` - Get schedule
- `DELETE /api/v1/schedules/{id}` - Delete schedule

## Jobs

- `GET /api/v1/jobs/{id}/status` - Query Kubernetes job status

## Health Endpoints

- `GET /health`
- `GET /healthz`
- `GET /ready`
