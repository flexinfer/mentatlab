# Multi-stage Dockerfile for Psyche Simulation
# Stage 1: Build dependencies and prepare application
FROM python:3.11-slim-bullseye AS builder

# Set build arguments
ARG BUILD_DATE
ARG BUILD_VERSION=1.0.0
ARG VCS_REF

# Add labels for better image management
LABEL maintainer="Psyche Simulation Team"
LABEL org.label-schema.build-date=$BUILD_DATE
LABEL org.label-schema.name="psyche-simulation"
LABEL org.label-schema.description="Jungian-inspired self-simulation with NiceGUI interface"
LABEL org.label-schema.version=$BUILD_VERSION
LABEL org.label-schema.vcs-ref=$VCS_REF
LABEL org.label-schema.schema-version="1.0"

# Set environment variables for build
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies for building
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    git \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --user --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Remove unnecessary files
RUN find . -type f -name "*.pyc" -delete && \
    find . -type d -name "__pycache__" -delete && \
    rm -rf .git .gitignore .dockerignore tests/ docs/ examples/ *.md

# Stage 2: Production runtime
FROM python:3.11-slim-bullseye AS runtime

# Set runtime arguments
ARG BUILD_DATE
ARG BUILD_VERSION=1.0.0
ARG VCS_REF

# Add labels
LABEL maintainer="Psyche Simulation Team"
LABEL org.label-schema.build-date=$BUILD_DATE
LABEL org.label-schema.name="psyche-simulation"
LABEL org.label-schema.description="Jungian-inspired self-simulation with NiceGUI interface"
LABEL org.label-schema.version=$BUILD_VERSION
LABEL org.label-schema.vcs-ref=$VCS_REF
LABEL org.label-schema.schema-version="1.0"

# Set production environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app
ENV PATH="/home/appuser/.local/bin:$PATH"
ENV ENVIRONMENT=production

# Install runtime system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser -u 1000 appuser

# Create application directories
RUN mkdir -p /app /app/logs /app/data /app/exports /app/.cache && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Set working directory
WORKDIR /app

# Copy Python packages from builder stage
COPY --from=builder --chown=appuser:appuser /root/.local /home/appuser/.local

# Copy application files from builder stage
COPY --from=builder --chown=appuser:appuser /app .

# Create health check script
COPY --chown=appuser:appuser docker/healthcheck.sh /usr/local/bin/healthcheck.sh

# Expose port
EXPOSE 8080

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health/live || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command
CMD ["python", "psyche_simulation.py"]