#!/bin/bash
set -e

echo "=== JellyCore NanoClaw ==="
echo "Starting API Proxy (Anthropic→OpenAI)..."

# Start API proxy in background
cd /app/api-proxy
node proxy.mjs &
PROXY_PID=$!

# Wait for proxy to be ready
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:${PROXY_PORT:-4100}/health > /dev/null 2>&1; then
    echo "API Proxy ready on port ${PROXY_PORT:-4100}"
    break
  fi
  sleep 0.5
done

# Start NanoClaw
echo "Starting NanoClaw..."
cd /app/nanoclaw
exec node dist/index.js
