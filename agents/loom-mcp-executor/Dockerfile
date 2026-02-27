FROM python:3.12-slim

WORKDIR /app
COPY agents /app/agents

ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "/app/agents/loom-mcp-executor/main.py"]
