.PHONY: all lint test build clean install-hooks check

# Default target
all: lint test build

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

# Run all linters
lint: lint-go lint-frontend

lint-go:
	@echo "=== Linting Go services ==="
	cd services/gateway-go && go vet ./...
	cd services/orchestrator-go && go vet ./...

lint-frontend:
	@echo "=== Linting Frontend ==="
	cd services/frontend && npm run lint

# Run all tests
test: test-go test-frontend

test-go:
	@echo "=== Testing Go services ==="
	cd services/gateway-go && go test -v ./...
	cd services/orchestrator-go && go test -v ./...

test-frontend:
	@echo "=== Testing Frontend ==="
	cd services/frontend && npm test

# Build all services
build: build-go build-frontend

build-go:
	@echo "=== Building Go services ==="
	cd services/gateway-go && go build -o ../../bin/gateway ./...
	cd services/orchestrator-go && go build -o ../../bin/orchestrator ./cmd/orchestrator/

build-frontend:
	@echo "=== Building Frontend ==="
	cd services/frontend && npm run build

# Quick check (fast feedback loop)
check: lint-go test-go
	@echo "=== All checks passed ==="

# Clean build artifacts
clean:
	rm -rf bin/
	rm -rf services/frontend/dist/

# Development helpers
dev-gateway:
	cd services/gateway-go && go run main.go

dev-orchestrator:
	cd services/orchestrator-go && go run ./cmd/orchestrator/

dev-frontend:
	cd services/frontend && npm run dev

# Docker builds
docker-build:
	./build-and-push.sh --skip-push

docker-push:
	./build-and-push.sh

# Help
help:
	@echo "MentatLab Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make install-hooks  - Install git pre-commit hooks"
	@echo ""
	@echo "Development:"
	@echo "  make check          - Quick lint + test (Go only)"
	@echo "  make lint           - Run all linters"
	@echo "  make test           - Run all tests"
	@echo "  make build          - Build all services"
	@echo ""
	@echo "Run Services:"
	@echo "  make dev-gateway    - Run gateway locally"
	@echo "  make dev-orchestrator - Run orchestrator locally"
	@echo "  make dev-frontend   - Run frontend dev server"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-build   - Build all Docker images"
	@echo "  make docker-push    - Build and push to registry"
