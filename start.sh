#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT/.env"
LOG_DIR="$ROOT/logs"

if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/start-$(date +%Y%m%d-%H%M%S).log"

echo "Starting bot; logging to $LOG_FILE"
yarn --cwd "$ROOT" start >>"$LOG_FILE" 2>&1
