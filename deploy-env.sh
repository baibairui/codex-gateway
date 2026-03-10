#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_HOST="${SERVER_HOST:-115.190.233.134}"
SERVER_USER="${SERVER_USER:-root}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$SCRIPT_DIR/br.pem}"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY_PATH")
REMOTE_TMP_DIR="${REMOTE_TMP_DIR:-/tmp/codex-gateway-release}"

log() {
  printf '==> %s\n' "$1"
}

choose_instance() {
  local input="${1:-}"
  if [ -n "$input" ]; then
    printf '%s\n' "$input"
    return
  fi

  printf '可选实例:\n'
  printf '  1) gateway\n'
  printf '  2) gateway-copy\n'
  read -r -p "选择要更新配置的实例 [gateway/gateway-copy]: " input
  printf '%s\n' "$input"
}

choose_env_file() {
  local input="${1:-}"
  if [ -n "$input" ]; then
    printf '%s\n' "$input"
    return
  fi

  read -r -p "请输入本地 .env 文件路径: " input
  printf '%s\n' "$input"
}

INSTANCE_NAME="$(choose_instance "${1:-}")"
ENV_FILE="$(choose_env_file "${2:-}")"

if [ ! -f "$ENV_FILE" ]; then
  printf 'env file not found: %s\n' "$ENV_FILE" >&2
  exit 1
fi

case "$INSTANCE_NAME" in
  gateway|'1')
    TARGET_DIR="/opt/gateway"
    PM2_APP_NAME="wecom-codex"
    HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3000/healthz}"
    ;;
  gateway-copy|'2')
    TARGET_DIR="/opt/gateway-copy"
    PM2_APP_NAME="gateway-copy"
    HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3001/healthz}"
    ;;
  *)
    TARGET_DIR="/opt/$INSTANCE_NAME"
    PM2_APP_NAME="$INSTANCE_NAME"
    HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3000/healthz}"
    ;;
esac

for cmd in ssh scp; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'missing required local command: %s\n' "$cmd" >&2
    exit 1
  fi
done

if [ ! -f "$SSH_KEY_PATH" ]; then
  printf 'ssh key not found: %s\n' "$SSH_KEY_PATH" >&2
  exit 1
fi

remote_env="$REMOTE_TMP_DIR/${INSTANCE_NAME}.env"

log "Uploading env file for $INSTANCE_NAME"
ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" "mkdir -p '$REMOTE_TMP_DIR'"
scp "${SSH_OPTS[@]}" "$ENV_FILE" "${SERVER_USER}@${SERVER_HOST}:$remote_env"

log "Installing env file into $TARGET_DIR"
ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" \
  TARGET_DIR="$TARGET_DIR" \
  PM2_APP_NAME="$PM2_APP_NAME" \
  HEALTHCHECK_URL="$HEALTHCHECK_URL" \
  REMOTE_ENV="$remote_env" \
  'bash -s' <<'EOF'
set -euo pipefail

timestamp="$(date +%Y%m%d-%H%M%S)"

if [ ! -d "$TARGET_DIR" ]; then
  printf 'target dir does not exist: %s\n' "$TARGET_DIR" >&2
  exit 1
fi

if [ -f "$TARGET_DIR/.env" ]; then
  cp "$TARGET_DIR/.env" "$TARGET_DIR/.env.bak.$timestamp"
fi

mv "$REMOTE_ENV" "$TARGET_DIR/.env"

pm2 restart "$PM2_APP_NAME" --update-env
curl -fsS "$HEALTHCHECK_URL" >/dev/null
EOF

log "Environment deployment completed"
