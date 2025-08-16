# Orchestrator (Python FastAPI) - production-like runtime
# Note: Using Python 3.13 to satisfy services/orchestrator/pyproject.toml requires-python constraint.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# System deps (curl for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only the services tree to preserve import paths like services.gateway.app.models
COPY services /app/services

# Install Python dependencies declared in services/orchestrator/pyproject.toml
# Installing directly via pip for deterministic container runtime (no dev extras)
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir \
     uvicorn \
     fastapi \
     "pydantic>=2.0" \
     pytest \
     httpx \
     "kubernetes>=33.1.0" \
     "boto3>=1.26.0" \
     "botocore>=1.29.0" \
     "jsonschema>=4.0.0" \
     opentelemetry-api \
     opentelemetry-sdk \
     opentelemetry-instrumentation-fastapi \
     opentelemetry-instrumentation-starlette \
     opentelemetry-exporter-otlp

EXPOSE 7070
ENV PORT=7070

# Run the FastAPI app
CMD ["uvicorn", "services.orchestrator.app.main:app", "--host", "0.0.0.0", "--port", "7070"]