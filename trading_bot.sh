#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BOT_ENV_FILE="${BOT_ENV_FILE:?BOT_ENV_FILE must be configured by PM2}"
BOT_NAME="${BOT_NAME:-trading-bot}"
ENV_FILE="$ROOT/$BOT_ENV_FILE"

if [ ! -f "$ENV_FILE" ]; then
    echo "Environment file not found: $ENV_FILE" >&2
    exit 1
fi

# Export every setting from the selected bot environment file so it is
# available to the Node process started below.
set -a
. "$ENV_FILE"
set +a

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20

echo "Starting $BOT_NAME using $ENV_FILE"

# Replace this shell process so PM2 signals are delivered directly to Node.
# PM2 captures stdout/stderr and writes them to the paths in bots.config.cjs.
cd "$ROOT"
exec pnpm start
