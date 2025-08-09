FROM node:20-alpine AS builder
WORKDIR /app

# Install build tools (some projects require these for native modules)
RUN apk add --no-cache python3 make g++ || true

# Copy package files and install dependencies
COPY services/orchestrator/package*.json ./
RUN npm ci --prefer-offline --no-audit

# Copy tsconfig and source for TypeScript build
COPY services/orchestrator/tsconfig.json ./
COPY services/orchestrator/src ./src

# Optional: copy repo-level schemas into builder if TypeScript reads them during build
# (keeps parity with runtime layout — runtime stage will also receive schemas)
COPY schemas ./schemas
# Also copy schemas into the service folder so TypeScript imports that reference service-local schemas resolve
# e.g. services/orchestrator/src/validation can import ../../schemas/... after this copy.
COPY schemas /app/services/orchestrator/schemas
# Also make schemas available at absolute /schemas so relative imports in source (e.g. "../../../../schemas/...") still resolve.
COPY schemas /schemas

# Build the project into /app/dist
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install runtime utilities used by HEALTHCHECK / compose healthchecks
RUN apk add --no-cache curl wget

# Copy production package files and install only production deps
COPY services/orchestrator/package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit

# Copy built artifacts from the builder stage
COPY --from=builder /app/dist ./dist

# Ensure repo-level JSON schemas are available at runtime so compiled JS imports resolve:
# Place them at /app/schemas so relative imports from dist (../../../schemas/...) resolve correctly.
COPY schemas /app/schemas
# Also provide them at absolute /schemas for any runtime modules that import via filesystem absolute paths
COPY schemas /schemas

EXPOSE 7070

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD curl -fsS http://localhost:7070/ready || exit 1

CMD ["node", "dist/server.js"]