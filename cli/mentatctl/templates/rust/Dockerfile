# Build stage
FROM rust:1.70-slim as builder

WORKDIR /app

# Copy Cargo files
COPY Cargo.toml Cargo.lock* ./

# Copy source code
COPY src/ ./src/

# Build the application
RUN cargo build --release

# Runtime stage
FROM debian:bullseye-slim

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary from builder stage
COPY --from=builder /app/target/release/main /usr/local/bin/agent

# Set environment variables
ENV RUST_LOG=info

# Run the agent
ENTRYPOINT ["agent"]