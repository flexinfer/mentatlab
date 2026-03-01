ARG BASE_REGISTRY=registry.harbor.lan/dockerhub-cache/library
FROM ${BASE_REGISTRY}/python:3.12-slim

# Prevent .pyc file writes (incompatible with readOnlyRootFilesystem)
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Create non-root user matching K8s securityContext (uid/gid 1000)
RUN groupadd -g 1000 agent && useradd -u 1000 -g agent -s /bin/false agent

COPY src/ /app/
WORKDIR /app

USER 1000:1000

ENTRYPOINT ["python", "main.py"]
