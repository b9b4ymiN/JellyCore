# Oracle V2 Dockerfile
# Runs as independent HTTP service with ChromaDB integration

# --- Build stage ---
FROM oven/bun:1.2-slim AS builder

# Install build dependencies for better-sqlite3 (native addon)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies (including native compilation)
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# --- Runtime stage ---
FROM oven/bun:1.2-slim

WORKDIR /app

# Copy built app from builder
COPY --from=builder /app /app

# Create data directory
RUN mkdir -p /data/oracle /data/knowledge

# Set environment variables
ENV ORACLE_PORT=47778
ENV ORACLE_REPO_ROOT=/data/knowledge
ENV ORACLE_DATA_DIR=/data/oracle
ENV HF_CACHE_DIR=/data/oracle/transformers-cache
ENV NODE_ENV=production

# Expose Oracle HTTP API port
EXPOSE 47778

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:47778/api/health'); process.exit(r.ok ? 0 : 1)"

# Run Oracle HTTP server
CMD ["bun", "run", "server"]
