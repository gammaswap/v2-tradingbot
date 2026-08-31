#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT/.env.asset3"
LOG_DIR="$ROOT/logs"

if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/asset3-$(date +%Y%m%d-%H%M%S).log"

echo "Starting bot; logging to $LOG_FILE"
exec pnpm --cwd "$ROOT" start >>"$LOG_FILE" 2>&1
