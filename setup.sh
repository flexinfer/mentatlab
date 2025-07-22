#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# setup.sh – MentatLab bootstrap for **OpenAI Codex** sandboxes
# Installs only the libraries needed to build & test the existing repo.
# No git/helm/k8s/cluster operations are performed here.
# -----------------------------------------------------------------------------
set -euo pipefail

# Colours
cyan() { printf "\033[1;36m%s\033[0m\n" "$*"; }
warn() { printf "\033[1;33mWARN:\033[0m %s\n" "$*"; }

PROJECT="mentatlab"

cyan "🔍 Checking required runtimes"
command -v python3   >/dev/null || { echo "Python 3 is required"; exit 1; }
command -v node      >/dev/null || { echo "Node.js is required";  exit 1; }
command -v npm       >/dev/null || { echo "npm is required";      exit 1; }

# ----------------------------- Python deps -----------------------------------
cyan "🐍 Installing Python dependencies with PDM"
if ! command -v pdm >/dev/null; then
  python3 -m pip install --quiet --upgrade pip
  python3 -m pip install --quiet pdm
fi
pdm install --no-editable --group :all || warn "PDM install skipped (pyproject missing?)"

# ----------------------------- Node deps -------------------------------------
FRONT_DIR="services/frontend"
if [[ -d "$FRONT_DIR" ]]; then
  cyan "📦 Installing Node dependencies in $FRONT_DIR"
  npm --prefix "$FRONT_DIR" ci
else
  warn "Frontend directory $FRONT_DIR not found — skipping npm install"
fi

# ----------------------------- Tests -----------------------------------------
cyan "🧪 Running smoke tests"
pdm run -p services/gateway pytest -q || warn "Python tests failed or missing"
npm --prefix "$FRONT_DIR" test --silent --if-present || warn "No frontend tests"

cyan "✅ Environment ready! You can now use Codex to implement features."