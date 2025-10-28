# Minimal Dockerfile for ctm-cogpack Cog‑Pak
FROM python:3.12-slim

# Avoid buffering to ensure single-line JSON outputs stream immediately
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Copy source (including ctm module)
COPY src/ ./src/

# Copy UI remote entry if it exists (will need to be added manually if missing)
# COPY ui/ ./ui/

# Optional hooks (prestart/health) - add these files if needed for lifecycle
# COPY prestart.sh /app/prestart.sh
# COPY health.sh /app/health.sh
# RUN chmod +x /app/prestart.sh /app/health.sh

# Install any deps if requirements.txt is provided
# If you add dependencies, add a requirements.txt to the agent and uncomment below
# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# Use a simple entrypoint to run the main agent
ENTRYPOINT ["python", "src/main.py"]
