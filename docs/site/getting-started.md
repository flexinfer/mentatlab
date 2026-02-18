# Getting Started

This guide gets MentatLab running locally with the Go services (`gateway-go`, `orchestrator-go`) and frontend.

## Prerequisites

- Go 1.23+
- Node.js 20+
- npm
- Docker (for Redis / compose workflow)

## Option 1: Full Stack via Docker Compose

```bash
docker-compose up
```

Default service endpoints:

- Frontend: `http://localhost:5173`
- Gateway: `http://localhost:8080`
- Orchestrator: `http://localhost:7070`
- Redis: `localhost:6379`

## Option 2: Run Services Manually

1. Start Redis:

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

2. Start Orchestrator:

```bash
cd services/orchestrator-go
go run ./cmd/orchestrator/
```

3. Start Gateway:

```bash
cd services/gateway-go
go run main.go
```

4. Start Frontend:

```bash
cd services/frontend
npm install
npm run dev
```

## Smoke Checks

```bash
curl http://localhost:8080/healthz
curl http://localhost:7070/healthz
curl http://localhost:7070/ready
```

## Common Dev Commands

```bash
# root quick check
make check

# Go service tests
cd services/orchestrator-go && go test -v ./...
cd services/gateway-go && go test -v ./...

# frontend checks
cd services/frontend && npm test
cd services/frontend && npm run lint
```

Next: review [Architecture](architecture.md) and [API Reference](api-reference.md).
