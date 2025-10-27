# Frontend (Vite) - production-like image serving with vite preview
FROM node:20-alpine

WORKDIR /app

# Ensure curl is available for healthchecks (alpine base already has wget busybox, but we use curl)
RUN apk add --no-cache curl

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json ./

# Install dependencies (ci for reproducibility)
RUN npm ci

# Copy application source
COPY . .

# Accept build-time configuration for Vite envs (embedded at build)
ARG VITE_GATEWAY_BASE_URL
ARG VITE_ORCHESTRATOR_URL
ARG VITE_ORCHESTRATOR_BASE_URL
ARG VITE_API_URL
ARG VITE_DEBUG_BUILD

# Expose as environment so `vite build` can read them via import.meta.env
ENV VITE_GATEWAY_BASE_URL=${VITE_GATEWAY_BASE_URL} \
    VITE_ORCHESTRATOR_URL=${VITE_ORCHESTRATOR_URL} \
    VITE_ORCHESTRATOR_BASE_URL=${VITE_ORCHESTRATOR_BASE_URL} \
    VITE_API_URL=${VITE_API_URL} \
    VITE_DEBUG_BUILD=${VITE_DEBUG_BUILD} \
    PORT=5173

# Build the app (use vite directly; package.json build is a placeholder)
RUN npx vite build

EXPOSE 5173

# Serve built assets with vite preview, listen on all interfaces
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
