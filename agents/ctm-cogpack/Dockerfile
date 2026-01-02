# CTM-Cogpack Cog-Pak Dockerfile
FROM python:3.12-slim

# Accept cache proxy for pip packages
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_TRUSTED_HOST=""
ENV PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}

# Avoid buffering to ensure single-line JSON outputs stream immediately
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source (including ctm module)
COPY src/ ./src/

# Copy UI remote entry if it exists
COPY ui/ ./ui/

# Health check script
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import torch; print('healthy')" || exit 1

# Run as non-root user
USER 1000:1000

# Use a simple entrypoint to run the main agent
ENTRYPOINT ["python", "src/main.py"]
