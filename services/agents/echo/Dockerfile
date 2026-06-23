ARG BASE_REGISTRY=registry.harbor.lan/dockerhub-cache/library
FROM ${BASE_REGISTRY}/python:3.12-slim

# Prevent .pyc file writes (incompatible with readOnlyRootFilesystem)
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Create non-root user matching K8s securityContext (uid/gid 1000)
RUN groupadd -g 1000 agent && useradd -u 1000 -g agent -s /bin/false agent

WORKDIR /app
RUN mkdir -p /app/agents/echo

# Keep both the image entrypoint path and the repo-relative path used by the
# default registry command so K8s jobs and local parity use the same script.
COPY src/main.py /app/main.py
COPY src/main.py /app/agents/echo/main.py

USER 1000:1000

ENTRYPOINT ["python", "main.py"]
