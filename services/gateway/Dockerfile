# Gateway (Python FastAPI)
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# System deps (curl for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only the services tree needed for imports like services.gateway...
COPY services /app/services

# Install runtime dependencies (match services/gateway/pyproject.toml)
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir \
     fastapi \
     uvicorn \
     "pydantic>=2.0" \
     httpx \
     "jsonschema>=4.25.0" \
     "redis>=4.7.1" \
     "aiohttp>=3.12.15" \
     "websockets>=15.0.1"

EXPOSE 8080
ENV PORT=8080

# Run the FastAPI app
CMD ["uvicorn", "services.gateway.app.main:app", "--host", "0.0.0.0", "--port", "8080"]