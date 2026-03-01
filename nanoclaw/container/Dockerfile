# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation + Python
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

# Install system dependencies for Chromium + Python
RUN apt-get update && apt-get install -y --no-install-recommends \
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
    docker.io \
    git \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser + Playwright
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install common Python packages system-wide (web scraping & HTTP)
# Playwright reuses the system Chromium — no extra browser download
RUN pip3 install --no-cache-dir --break-system-packages \
    requests \
    beautifulsoup4 \
    lxml \
    playwright \
    && python3 -m playwright install-deps 2>/dev/null || true

# Tell Playwright to use system Chromium (don't download its own)
ENV PLAYWRIGHT_BROWSERS_PATH=0
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install agent-browser, claude-code, and PM2 globally
RUN npm install -g agent-browser @anthropic-ai/claude-code pm2

# External MCP servers — installed from config/mcps.json
# node_modules are intentionally kept: oura-mcp uses standard tsc output (not bundled)
# Token is NOT baked into the image; it flows through secrets at runtime
RUN git clone --depth=1 https://github.com/elizabethtrykin/oura-mcp /opt/oura-mcp \
    && cd /opt/oura-mcp \
    && npm install \
    && npm run build \
    && rm -rf /opt/oura-mcp/.git

# Yahoo Finance MCP (Python)
RUN git clone --depth=1 https://github.com/Alex2Yang97/yahoo-finance-mcp /opt/yahoo-finance-mcp \
    && pip3 install --no-cache-dir --break-system-packages \
      "mcp[cli]>=1.6.0" \
      "yfinance>=0.2.62" \
      "pandas>=2.0.0" \
    && rm -rf /opt/yahoo-finance-mcp/.git

# NotebookLM MCP (Node)
RUN npm install -g notebooklm-mcp@latest

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

# Copy MCP server configuration (read at runtime to build mcpServers config)
COPY config/ /app/config/

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Entrypoint: run as root initially to fix bind-mount permissions,
# map docker.sock group access for node user, then drop to node.
RUN cat > /app/entrypoint.sh <<'EOF' \
 && chmod +x /app/entrypoint.sh
#!/bin/bash
set -e

mkdir -p /workspace/ipc/input /workspace/ipc/messages /workspace/ipc/tasks 2>/dev/null || true
chmod -R 777 /workspace/ipc 2>/dev/null || true
chown -R node:node /workspace/group /workspace/global /workspace/extra /home/node 2>/dev/null || true

if [ -S /var/run/docker.sock ]; then
  SOCK_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
  if [ -n "$SOCK_GID" ]; then
    SOCK_GROUP="$(getent group "$SOCK_GID" | cut -d: -f1 || true)"
    if [ -z "$SOCK_GROUP" ]; then
      SOCK_GROUP="dockersock"
      groupadd -g "$SOCK_GID" "$SOCK_GROUP" 2>/dev/null || true
    fi
    usermod -aG "$SOCK_GROUP" node 2>/dev/null || true
  fi
fi

cat > /tmp/input.json
chmod 644 /tmp/input.json
exec su -s /bin/bash node -c "node /app/dist/index.js < /tmp/input.json"
EOF

# Set ownership to node user (non-root) for image directories
RUN chown -R node:node /workspace /home/node

# Stay as root — entrypoint fixes bind-mount perms then drops to node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
