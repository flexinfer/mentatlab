#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# setup.sh  –  Bootstrap “mentatlab” monorepo
# Creates: git repo, Helm chart, FastAPI skeleton, React-Flow front-end,
# dev-container, GitHub Actions CI, and optional KinD sandbox.
#
#   ./setup.sh            # interactive
#   ./setup.sh --non-interactive
# -----------------------------------------------------------------------------
set -euo pipefail
shopt -s inherit_errexit

PROJECT="mentatlab"          # <— updated repo / Helm release name
CHART_VERSION="0.0.1"
PY_VERSION="3.11"
NODE_VERSION="20"
KIND_CLUSTER="mentatlab-dev"  # <— sandbox cluster name

confirm() {
  [[ "${NON_INTERACTIVE:-}" == "1" ]] && return 0
  read -rp "$1 [y/N] " ans && [[ "${ans,,}" == y* ]]
}

header() { printf "\n\033[1;34m%s\033[0m\n" "$*"; }

check_dep() { command -v "$1" >/dev/null || { echo "Missing $1" >&2; exit 1; }; }

### 1. Prerequisites -----------------------------------------------------------
for dep in git helm kubectl docker yq; do check_dep "$dep"; done

### 2. Repo init ---------------------------------------------------------------
header "Initialising Git repository"
git init -q
git switch -c main

cat >README.md <<EOF
# $PROJECT

Composable AI Mission Control – see \`docs/PLAN.md\` for the full design.
EOF

cat >LICENSE <<EOF
MIT License

Copyright (c) $(date +%Y)
EOF

git add README.md LICENSE
git commit -qm "chore(repo): init README and LICENSE"

### 3. Helm chart --------------------------------------------------------------
header "Creating Helm chart ($PROJECT)"
mkdir -p infra/charts
helm create "infra/charts/$PROJECT"
rm infra/charts/$PROJECT/templates/*.yaml  # strip examples

cat > infra/charts/$PROJECT/Chart.yaml <<EOF
apiVersion: v2
name: $PROJECT
description: Composable AI Mission Control
type: application
version: $CHART_VERSION
appVersion: "$CHART_VERSION"
EOF

git add infra/charts
git commit -qm "feat(chart): scaffold Helm chart"

### 4. FastAPI gateway ---------------------------------------------------------
header "Scaffolding FastAPI gateway"
mkdir -p services/gateway/{app,tests}
cat > services/gateway/app/main.py <<'EOF'
from fastapi import FastAPI

app = FastAPI(title="MentatLab Gateway")

@app.get("/healthz", tags=["health"])
def health():
    return {"status": "ok"}
EOF

cat > services/gateway/pyproject.toml <<EOF
[project]
name = "mentatlab-gateway"
version = "0.0.1"
dependencies = ["fastapi", "uvicorn[standard]", "redis", "sqlalchemy", "pydantic"]

[tool.pdm]
python_requires = ">=${PY_VERSION}"
EOF

git add services/gateway
git commit -qm "feat(gateway): minimal FastAPI health endpoint"

### 5. React-Flow front-end ----------------------------------------------------
header "Scaffolding React front-end"
npx --yes create-react-app services/frontend --template typescript
pushd services/frontend >/dev/null
npm install react-flow-renderer tailwindcss @tanstack/react-query \
            classnames @heroicons/react
npx tailwindcss init -p
popd >/dev/null

git add services/frontend
git commit -qm "feat(frontend): CRA + React-Flow + Tailwind baseline"

### 6. Dev-container -----------------------------------------------------------
header "Adding dev-container"
mkdir -p .devcontainer
cat > .devcontainer/devcontainer.json <<EOF
{
  "name": "$PROJECT",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/node:1": { "version": "$NODE_VERSION" },
    "ghcr.io/devcontainers/features/python:1": { "version": "$PY_VERSION" }
  },
  "postCreateCommand": "pipx install pdm && pdm install && npm ci",
  "customizations": {
    "vscode": { "settings": { "terminal.integrated.defaultProfile.linux": "bash" } }
  }
}
EOF
git add .devcontainer
git commit -qm "chore(devcontainer): Node $NODE_VERSION & Python $PY_VERSION"

### 7. GitHub Actions ----------------------------------------------------------
header "Configuring GitHub Actions"
mkdir -p .github/workflows
cat > .github/workflows/ci.yaml <<'EOF'
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '20', cache: 'npm' }
    - uses: actions/setup-python@v5
      with: { python-version: '3.11' }
    - run: |
        pip install pdm
        pdm install
        npm --prefix services/frontend ci
    - run: pdm run -p services/gateway pytest -q || true
    - run: npm --prefix services/frontend run build
EOF
git add .github
git commit -qm "ci: basic build workflow"

### 8. Local KinD sandbox ------------------------------------------------------
if confirm "Create local KinD cluster '$KIND_CLUSTER'?"; then
  header "Provisioning KinD cluster"
  cat >kind.yaml <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
EOF
  kind create cluster --name "$KIND_CLUSTER" --config kind.yaml
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
  helm install kube-prom prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
fi

### 9. Done --------------------------------------------------------------------
header "Bootstrap complete! 🚀"
echo "Push to GitHub and start Sprint 0 when ready."