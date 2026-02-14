# syntax=docker/dockerfile:1
# Frontend - multi-stage build with nginx for production serving

# Stage 1: Build
FROM node:20-alpine AS builder

ARG npm_config_registry=https://registry.npmjs.org
ENV npm_config_registry=${npm_config_registry}

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

# Accept build-time configuration for Vite envs (embedded at build)
ARG VITE_GATEWAY_BASE_URL
ARG VITE_ORCHESTRATOR_URL
ARG VITE_ORCHESTRATOR_BASE_URL
ARG VITE_API_URL
ARG VITE_DEBUG_BUILD

ENV VITE_GATEWAY_BASE_URL=${VITE_GATEWAY_BASE_URL} \
    VITE_ORCHESTRATOR_URL=${VITE_ORCHESTRATOR_URL} \
    VITE_ORCHESTRATOR_BASE_URL=${VITE_ORCHESTRATOR_BASE_URL} \
    VITE_API_URL=${VITE_API_URL} \
    VITE_DEBUG_BUILD=${VITE_DEBUG_BUILD}

RUN npx vite build

# Stage 2: Serve with nginx
FROM nginx:alpine

RUN apk add --no-cache curl

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA fallback: route all paths to index.html
RUN printf 'server {\n\
    listen 5173;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    location /healthz {\n\
        return 200 "ok";\n\
        add_header Content-Type text/plain;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
