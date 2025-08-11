# Minimal Dockerfile for psyche-sim Cog‑Pak
FROM python:3.12-slim

# Avoid buffering to ensure single-line JSON outputs stream immediately
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Copy source
COPY src/ ./src/

# Copy UI remote entry so frontend can fetch it from the image/package
COPY ui/ ./ui/

# Optional hooks (prestart/health) - copied for lifecycle compatibility
COPY prestart.sh /app/prestart.sh
COPY health.sh /app/health.sh
RUN chmod +x /app/prestart.sh /app/health.sh || true

# Install any deps if requirements.txt is provided (none required for scaffold)
# If you add dependencies, add a requirements.txt to the agent and uncomment below
# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# Use a simple entrypoint to run the main agent
ENTRYPOINT ["python", "src/main.py"]