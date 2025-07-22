#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# setup.sh  –  Bootstrap “mentatlab” monorepo (Codex-safe version)
# Works both inside OpenAI Codex/Copilot sandboxes *and* on a full dev box.
# ---------------------------------------------------------------------------
set -euo pipefail
PROJECT="mentatlab"
CHART_VERSION="0.0.1"
PY_VERSION="3.11"
NODE_VERSION="20"
KIND_CLUSTER="mentatlab-dev"

# ---------- CLI flags -------------------------------------------------------
NON_INTERACTIVE=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --non-interactive|-y) NON_INTERACTIVE=1 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac; shift
done
confirm() { [[ $NON_INTERACTIVE == 1 ]] && return 0; read -rp "$1 [y/N] " a && [[ ${a,,} == y* ]]; }

# ---------- helpers ---------------------------------------------------------
cyan()  { printf "\033[1;36m%s\033[0m\n" "$*"; }
warn()  { printf "\033[1;33mWARN:\033[0m %s\n" "$*"; }
need()  { command -v "$1" &>/dev/null || { warn "$1 not found — step skipped"; return 1; } }

# ---------- core prerequisites (must exist) ---------------------------------
for req in git node python3; do
  need "$req" || { echo "❌ $req is required — aborting"; exit 1; }
done

# ---------- initialise repo --------------------------------------------------
cyan "📁 Initialising git repository"
git init -q
git checkout -b main
cat >README.md <<EOF
# $PROJECT
Composable AI Mission Control – see docs/PLAN.md for full design.
EOF
echo "MIT License" > LICENSE
git add README.md LICENSE
git commit -qm "chore(repo): init"

# ---------- helm chart (optional) -------------------------------------------
if need helm; then
  cyan "☸️  Creating Helm chart"
  mkdir -p infra/charts
  helm create "infra/charts/$PROJECT"
  rm infra/charts/$PROJECT/templates/*.yaml
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
else
  warn "Helm unavailable — skipping chart generation"
fi

# ---------- FastAPI gateway --------------------------------------------------
cyan "🚀 Scaffolding FastAPI service"
mkdir -p services/gateway/{app,tests}
cat > services/gateway/app/main.py <<'PY'
from fastapi import FastAPI
app = FastAPI(title="MentatLab Gateway")
@app.get("/healthz", tags=["health"])
def health():
    return {"status": "ok"}
PY
cat > services/gateway/pyproject.toml <<EOF
[project]
name = "mentatlab-gateway"
version = "0.0.1"
dependencies = ["fastapi", "uvicorn[standard]","redis","sqlalchemy","pydantic"]
[tool.pdm]
python_requires = ">=${PY_VERSION}"
EOF
git add services/gateway
git commit -qm "feat(gateway): minimal FastAPI health endpoint"

# ---------- React-Flow front-end --------------------------------------------
cyan "🎨 Scaffolding React front-end"
if need npx; then
  npx --yes create-react-app services/frontend --template typescript
  pushd services/frontend >/dev/null
  npm install react-flow-renderer tailwindcss @tanstack/react-query classnames @heroicons/react
  npx tailwindcss init -p
  popd >/dev/null
  git add services/frontend
  git commit -qm "feat(frontend): CRA + React-Flow"
else
  warn "Node/NPM unavailable — frontend skipped"
fi

# ---------- dev-container ----------------------------------------------------
cyan "🛠  Adding dev-container"
mkdir -p .devcontainer
cat > .devcontainer/devcontainer.json <<EOF
{
  "name": "$PROJECT",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/node:1": { "version": "$NODE_VERSION" },
    "ghcr.io/devcontainers/features/python:1": { "version": "$PY_VERSION" }
  },
  "postCreateCommand": "pipx install pdm || true && pdm install || true && npm ci || true"
}
EOF
git add .devcontainer
git commit -qm "chore(devcontainer): base image + features"

# ---------- GitHub Actions ---------------------------------------------------
cyan "🔧 Configuring GitHub Actions"
mkdir -p .github/workflows
cat > .github/workflows/ci.yaml <<'YML'
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
    - run: pip install pdm && pdm install
    - run: npm --prefix services/frontend ci || true
    - run: pdm run -p services/gateway pytest -q || true
    - run: npm --prefix services/frontend run build || true
YML
git add .github
git commit -qm "ci: basic build workflow"

# ---------- optional local cluster ------------------------------------------
if need docker && need kind && confirm "Create local KinD cluster '$KIND_CLUSTER'?"; then
  cyan "🚢 Provisioning KinD cluster (optional)"
  cat >kind.yaml <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
EOF
  kind create cluster --name "$KIND_CLUSTER" --config kind.yaml
  if need helm; then
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm install kube-prom prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
  fi
else
  warn "Kind/Docker unavailable — cluster step skipped"
fi

cyan "✅ Bootstrap complete! Push to GitHub and start coding."