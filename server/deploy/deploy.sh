#!/usr/bin/env bash
# Deploy / update the WSB FastAPI backend on 164.92.227.240
set -euo pipefail

SERVER="${WSB_SERVER:-root@164.92.227.240}"
SSH_OPTS="${WSB_SSH_OPTS:--o StrictHostKeyChecking=accept-new}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Syncing $SRC_DIR -> $SERVER:/opt/wsb/server ..."
ssh $SSH_OPTS "$SERVER" "mkdir -p /opt/wsb/server"
tar -C "$SRC_DIR" --exclude='.venv' --exclude='data' --exclude='__pycache__' -czf - . \
  | ssh $SSH_OPTS "$SERVER" "tar -xzf - -C /opt/wsb/server && bash /opt/wsb/server/deploy/setup_remote.sh"
