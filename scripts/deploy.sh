#!/bin/bash
# JellyCore — Full Production Deploy Script
#
# Usage:
#   ./scripts/deploy.sh          # Full deploy (build all + up)
#   ./scripts/deploy.sh --up     # docker compose up only (skip build)
#   ./scripts/deploy.sh --build  # build images only (no up)
#
# This script ensures correct build order:
#   1. nanoclaw-agent:latest  (agent runner — spawned per-request by nanoclaw)
#   2. jellycore-nanoclaw     (orchestrator — built by docker compose)
#   3. jellycore-oracle       (knowledge engine — built by docker compose)
#   Then: docker compose up -d

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"

cd "$PROJECT_ROOT"

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

step()  { echo -e "\n${GREEN}▶ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠  $1${NC}"; }
error() { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────
DO_BUILD=true
DO_UP=true

for arg in "$@"; do
  case "$arg" in
    --up)    DO_BUILD=false ;;
    --build) DO_UP=false ;;
    *) warn "Unknown argument: $arg" ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────
step "Pre-flight checks"

if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Start Docker and retry."
fi
echo "  ✓ Docker daemon is running"

if [ ! -f ".env" ]; then
  error ".env file not found. Copy .env.example and fill in your values."
fi
echo "  ✓ .env file exists"

# ── Step 1: Build nanoclaw-agent image ───────────────────────────────────────
if [ "$DO_BUILD" = true ]; then
  step "Building nanoclaw-agent:latest (agent runner)"
  echo "  Context: nanoclaw/container/"

  AGENT_IMAGE="${CONTAINER_IMAGE:-nanoclaw-agent:latest}"
  docker build \
    --tag "$AGENT_IMAGE" \
    --file nanoclaw/container/Dockerfile \
    nanoclaw/container/
  echo "  ✓ nanoclaw-agent:latest built ($(docker images -q "$AGENT_IMAGE"))"

  # ── Step 2: Build compose services ───────────────────────────────────────
  step "Building compose services (nanoclaw, oracle)"
  docker compose -f "$COMPOSE_FILE" build --parallel
  echo "  ✓ Compose services built"
fi

# ── Step 3: Start stack ───────────────────────────────────────────────────────
if [ "$DO_UP" = true ]; then
  step "Starting JellyCore stack"
  docker compose -f "$COMPOSE_FILE" up -d

  echo ""
  step "Stack status"
  docker compose -f "$COMPOSE_FILE" ps

  echo ""
  echo -e "${GREEN}✅ JellyCore is running!${NC}"
  echo ""
  echo "  Health:  curl http://localhost:47779/health"
  echo "  Logs:    docker logs jellycore-nanoclaw -f"
  echo "  Stop:    docker compose -f $COMPOSE_FILE down"
fi
