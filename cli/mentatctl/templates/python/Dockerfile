FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Copy requirements if they exist
COPY requirements.txt* ./

# Install Python dependencies
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi

# Copy source code
COPY src/ ./

# Set environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Run the agent
ENTRYPOINT ["python", "main.py"]