# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation
# Multi-stage build: TypeScript compiled at build time for fast cold start

# --- Build stage: compile TypeScript ---
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript at build time (not at container start)
RUN npm run build

# --- Runtime stage ---
FROM node:22-slim

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser, claude-code, and PM2 globally
RUN npm install -g agent-browser @anthropic-ai/claude-code pm2

# Install PM2 log rotate module
RUN pm2 install pm2-logrotate && \
    pm2 set pm2-logrotate:max_size 50M && \
    pm2 set pm2-logrotate:retain 7 && \
    pm2 set pm2-logrotate:compress true

# Create app directory
WORKDIR /app

# Copy pre-built app from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Entrypoint: run as root initially to fix bind-mount permissions,
# then drop to node user via su to run the agent.
RUN printf '#!/bin/bash\nset -e\nmkdir -p /workspace/ipc/input /workspace/ipc/messages /workspace/ipc/tasks 2>/dev/null || true\nchmod -R 777 /workspace/ipc 2>/dev/null || true\nchown -R node:node /workspace/group /workspace/global /workspace/extra /home/node 2>/dev/null || true\ncat > /tmp/input.json\nchmod 644 /tmp/input.json\nexec su -s /bin/bash node -c "node /app/dist/index.js < /tmp/input.json"\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for image directories
RUN chown -R node:node /workspace /home/node

# Stay as root — entrypoint fixes bind-mount perms then drops to node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
