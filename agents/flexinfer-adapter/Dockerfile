FROM python:3.12-slim

WORKDIR /app

# Install loom CLI (expected to be available in PATH)
# In K8s deployment, loom binary is mounted or baked into the image.
COPY agents/common /app/agents/common
COPY agents/flexinfer-adapter /app/agents/flexinfer-adapter

# No pip install needed — stdlib only

ENTRYPOINT ["python", "agents/flexinfer-adapter/main.py"]
