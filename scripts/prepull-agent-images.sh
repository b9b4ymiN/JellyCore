#!/usr/bin/env bash
set -euo pipefail

FULL_IMAGE="${AGENT_IMAGE_FULL:-nanoclaw-agent:latest}"
LITE_IMAGE="${AGENT_IMAGE_LITE:-nanoclaw-agent-lite:latest}"

log() {
  printf '[prepull] %s\n' "$*"
}

pull_image() {
  local image="$1"
  log "pulling ${image}"
  docker pull "${image}" >/dev/null
}

pull_image "${FULL_IMAGE}"
pull_image "${LITE_IMAGE}"

log "done"
