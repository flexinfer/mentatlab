.PHONY: all lint test build clean install-hooks check deps
.PHONY: up down logs ps restart status
.PHONY: dev dev-watch dev-gateway dev-orchestrator dev-frontend
.PHONY: docker-build docker-push

# Default target
all: lint test build

##@ Setup

# Install dependencies for all services
deps:
	@echo "=== Installing dependencies ==="
	@echo "→ Frontend (npm)"
	cd services/frontend && npm install
	@echo "→ Go services (go mod)"
	cd services/gateway-go && go mod download
	cd services/orchestrator-go && go mod download
	@echo "→ CLI (pip)"
	cd cli/mentatctl && pip install -e . 2>/dev/null || pip install typer pyyaml requests jsonschema
	@echo "✓ All dependencies installed"

# Install pre-commit hooks
install-hooks:
	@echo "Installing pre-commit hooks..."
	@if command -v pre-commit >/dev/null 2>&1; then \
		pre-commit install; \
		echo "Pre-commit hooks installed successfully"; \
	else \
		echo "pre-commit not found. Installing simple git hook instead..."; \
		cp scripts/pre-commit .git/hooks/pre-commit; \
		chmod +x .git/hooks/pre-commit; \
		echo "Git pre-commit hook installed"; \
	fi

# Install air for Go hot-reload
install-air:
	@echo "Installing air for Go hot-reload..."
	go install github.com/air-verse/air@latest
	@echo "✓ Air installed. Make sure ~/go/bin is in your PATH"

##@ Linting

# Run all linters
lint: lint-go lint-frontend

lint-go:
	@echo "=== Linting Go services ==="
	cd services/gateway-go && go vet ./...
	cd services/orchestrator-go && go vet ./...

lint-frontend:
	@echo "=== Linting Frontend ==="
	cd services/frontend && npm run lint

##@ Testing

# Run all tests
test: test-go test-frontend

test-go:
	@echo "=== Testing Go services ==="
	cd services/gateway-go && go test -v ./...
	cd services/orchestrator-go && go test -v ./...

test-frontend:
	@echo "=== Testing Frontend ==="
	cd services/frontend && npm test

test-e2e:
	@echo "=== Running E2E tests ==="
	cd services/frontend && npm run e2e

# Quick check (fast feedback loop)
check: lint-go test-go
	@echo "=== All checks passed ==="

##@ Building

# Build all services
build: build-go build-frontend

build-go:
	@echo "=== Building Go services ==="
	@mkdir -p bin
	cd services/gateway-go && go build -o ../../bin/gateway ./...
	cd services/orchestrator-go && go build -o ../../bin/orchestrator ./cmd/orchestrator/

build-frontend:
	@echo "=== Building Frontend ==="
	cd services/frontend && npm run build

# Clean build artifacts
clean:
	rm -rf bin/
	rm -rf services/frontend/dist/
	rm -rf services/gateway-go/tmp/
	rm -rf services/orchestrator-go/tmp/

##@ Docker Compose

# Start all services
up:
	docker-compose up -d
	@echo "✓ Services starting..."
	@echo "  Frontend:     http://localhost:5173"
	@echo "  Gateway:      http://localhost:8080"
	@echo "  Orchestrator: http://localhost:7070"
	@echo "  Redis:        localhost:6379"
	@echo ""
	@echo "Run 'make logs' to follow logs"

# Start with build
up-build:
	docker-compose up -d --build

# Stop all services
down:
	docker-compose down

# Stop and remove volumes
down-v:
	docker-compose down -v

# Follow logs
logs:
	docker-compose logs -f

# Follow specific service logs
logs-gateway:
	docker-compose logs -f gateway

logs-orchestrator:
	docker-compose logs -f orchestrator

logs-frontend:
	docker-compose logs -f frontend

# Show running containers
ps:
	docker-compose ps

# Restart all services
restart:
	docker-compose restart

# Show service status with health
status:
	@echo "=== Service Status ==="
	@docker-compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
	@echo ""
	@echo "=== Health Checks ==="
	@curl -sf http://localhost:7070/healthz >/dev/null 2>&1 && echo "✓ Orchestrator: healthy" || echo "✗ Orchestrator: unhealthy"
	@curl -sf http://localhost:8080/healthz >/dev/null 2>&1 && echo "✓ Gateway: healthy" || echo "✗ Gateway: unhealthy"
	@curl -sf http://localhost:5173 >/dev/null 2>&1 && echo "✓ Frontend: healthy" || echo "✗ Frontend: unhealthy"
	@redis-cli ping >/dev/null 2>&1 && echo "✓ Redis: healthy" || echo "✗ Redis: unhealthy"

##@ Development (Local)

# Run all services locally (requires 3 terminals or use tmux)
dev:
	@echo "Starting local development..."
	@echo "This requires multiple terminals. Use 'make dev-watch' for hot-reload."
	@echo ""
	@echo "Terminal 1: make dev-orchestrator"
	@echo "Terminal 2: make dev-gateway"
	@echo "Terminal 3: make dev-frontend"

# Run with hot-reload (requires air: make install-air)
dev-watch:
	@echo "Starting hot-reload development..."
	@echo ""
	@echo "Terminal 1: make watch-orchestrator"
	@echo "Terminal 2: make watch-gateway"
	@echo "Terminal 3: make dev-frontend"

# Individual services
dev-gateway:
	cd services/gateway-go && go run main.go

dev-orchestrator:
	cd services/orchestrator-go && go run ./cmd/orchestrator/

dev-frontend:
	cd services/frontend && npm run dev

# Hot-reload with air
watch-gateway:
	cd services/gateway-go && air

watch-orchestrator:
	cd services/orchestrator-go && air

##@ Docker Builds

docker-build:
	./build-and-push.sh --skip-push

docker-push:
	./build-and-push.sh

##@ CLI

# Run mentatctl commands
ctl:
	@echo "Usage: python -m cli.mentatctl <command>"
	@echo "  python -m cli.mentatctl --help"
	@echo "  python -m cli.mentatctl agent list"
	@echo "  python -m cli.mentatctl validate flows/example.yaml"

##@ Help

# Help
help:
	@echo "MentatLab Development Commands"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)
	@echo ""
	@echo "Setup:"
	@echo "  make deps          - Install all dependencies"
	@echo "  make install-hooks - Install git pre-commit hooks"
	@echo "  make install-air   - Install air for Go hot-reload"
	@echo ""
	@echo "Development:"
	@echo "  make check         - Quick lint + test (Go only)"
	@echo "  make lint          - Run all linters"
	@echo "  make test          - Run all tests"
	@echo "  make test-e2e      - Run E2E tests"
	@echo "  make build         - Build all services"
	@echo ""
	@echo "Run Services (single process):"
	@echo "  make dev-gateway       - Run gateway locally"
	@echo "  make dev-orchestrator  - Run orchestrator locally"
	@echo "  make dev-frontend      - Run frontend dev server"
	@echo ""
	@echo "Run Services (hot-reload):"
	@echo "  make watch-gateway     - Gateway with hot-reload"
	@echo "  make watch-orchestrator - Orchestrator with hot-reload"
	@echo ""
	@echo "Docker Compose:"
	@echo "  make up            - Start all services"
	@echo "  make up-build      - Start with rebuild"
	@echo "  make down          - Stop all services"
	@echo "  make logs          - Follow all logs"
	@echo "  make ps            - Show running services"
	@echo "  make status        - Health check all services"
	@echo "  make restart       - Restart all services"
	@echo ""
	@echo "Docker Images:"
	@echo "  make docker-build  - Build all Docker images"
	@echo "  make docker-push   - Build and push to registry"
