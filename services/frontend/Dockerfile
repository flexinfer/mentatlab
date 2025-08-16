# Frontend (Vite) - production-like image serving with vite preview
FROM node:18-alpine

WORKDIR /app

# Ensure curl is available for healthchecks (alpine base already has wget busybox, but we use curl)
RUN apk add --no-cache curl

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json ./

# Install dependencies (ci for reproducibility)
RUN npm ci

# Copy application source
COPY . .

# Vite config: bake the gateway base URL at build time for client requests
# Default to host-exposed gateway port per docker-compose requirement
ENV VITE_GATEWAY_BASE_URL=http://localhost:8080
ENV PORT=5173

# Build the app (use vite directly; package.json build is a placeholder)
RUN npx vite build

EXPOSE 5173

# Serve built assets with vite preview, listen on all interfaces
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]