FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./

# Set environment variables
ENV NODE_ENV=production

# Run the agent
ENTRYPOINT ["node", "main.js"]