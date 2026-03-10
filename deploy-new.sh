#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_HOST="${SERVER_HOST:-115.190.233.134}"
SERVER_USER="${SERVER_USER:-root}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$SCRIPT_DIR/br.pem}"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY_PATH")
REMOTE_TMP_DIR="${REMOTE_TMP_DIR:-/tmp/codex-gateway-release}"
BACKUP_DIR="${BACKUP_DIR:-/opt/deploy-backups}"
TEMPLATE_DIR="${TEMPLATE_DIR:-/opt/gateway}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3000/healthz}"

log() {
  printf '==> %s\n' "$1"
}

require_local_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required local command: %s\n' "$1" >&2
    exit 1
  fi
}

for cmd in ssh scp tar mktemp; do
  require_local_cmd "$cmd"
done

if [ ! -f "$SSH_KEY_PATH" ]; then
  printf 'ssh key not found: %s\n' "$SSH_KEY_PATH" >&2
  exit 1
fi

read -r -p "请输入新实例名称（例如 codex-app-2）: " INSTANCE_NAME
if [[ -z "$INSTANCE_NAME" ]] || [[ ! "$INSTANCE_NAME" =~ ^[a-zA-Z0-9-]+$ ]]; then
  printf 'invalid instance name: %s\n' "$INSTANCE_NAME" >&2
  exit 1
fi

read -r -p "请输入本地 .env 文件路径: " ENV_FILE
if [ ! -f "$ENV_FILE" ]; then
  printf 'env file not found: %s\n' "$ENV_FILE" >&2
  exit 1
fi

archive_path="$(mktemp "${TMPDIR:-/tmp}/${INSTANCE_NAME}.XXXXXX.tgz")"
trap 'rm -f "$archive_path"' EXIT

log "Creating local release archive"
tar --exclude='.env' \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.data' \
  --exclude='workspace' \
  --exclude='.deploy-backups' \
  --exclude='._*' \
  --exclude='.DS_Store' \
  -czf "$archive_path" \
  -C "$SCRIPT_DIR" \
  .

remote_archive="$REMOTE_TMP_DIR/$(basename "$archive_path")"
remote_env="$REMOTE_TMP_DIR/${INSTANCE_NAME}.env"
target_dir="/opt/$INSTANCE_NAME"

log "Uploading release archive and env file"
ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" "mkdir -p '$REMOTE_TMP_DIR' '$BACKUP_DIR'"
scp "${SSH_OPTS[@]}" "$archive_path" "${SERVER_USER}@${SERVER_HOST}:$remote_archive"
scp "${SSH_OPTS[@]}" "$ENV_FILE" "${SERVER_USER}@${SERVER_HOST}:$remote_env"

log "Creating new instance at $target_dir using template dependencies from $TEMPLATE_DIR"
ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" \
  INSTANCE_NAME="$INSTANCE_NAME" \
  TARGET_DIR="$target_dir" \
  TEMPLATE_DIR="$TEMPLATE_DIR" \
  HEALTHCHECK_URL="$HEALTHCHECK_URL" \
  BACKUP_DIR="$BACKUP_DIR" \
  REMOTE_TMP_DIR="$REMOTE_TMP_DIR" \
  REMOTE_ARCHIVE="$remote_archive" \
  REMOTE_ENV="$remote_env" \
  'bash -s' <<'EOF'
set -euo pipefail

log() {
  printf '==> %s\n' "$1"
}

require_remote_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required remote command: %s\n' "$1" >&2
    exit 1
  fi
}

for cmd in tar rsync pm2 curl npm cmp mktemp cp; do
  require_remote_cmd "$cmd"
done

if [ -d "$TARGET_DIR" ]; then
  printf 'target dir already exists: %s\n' "$TARGET_DIR" >&2
  exit 1
fi

if [ ! -d "$TEMPLATE_DIR/node_modules" ]; then
  printf 'template node_modules missing under %s; cannot seed offline dependencies\n' "$TEMPLATE_DIR" >&2
  exit 1
fi

staging_dir="$(mktemp -d "${REMOTE_TMP_DIR%/}/staging.XXXXXX")"
timestamp="$(date +%Y%m%d-%H%M%S)"
trap 'rm -rf "$staging_dir" "$REMOTE_ARCHIVE" "$REMOTE_ENV"' EXIT

log "Extracting uploaded archive"
tar -xzf "$REMOTE_ARCHIVE" -C "$staging_dir"

if [ ! -f "$staging_dir/package-lock.json" ] || [ ! -f "$TEMPLATE_DIR/package-lock.json" ]; then
  printf 'package-lock.json missing in staging or template; refusing offline instance creation\n' >&2
  exit 1
fi

if ! cmp -s "$staging_dir/package-lock.json" "$TEMPLATE_DIR/package-lock.json"; then
  printf 'package-lock.json changed from template; create/update dependencies before offline instance creation\n' >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

log "Syncing release into $TARGET_DIR"
rsync -a \
  --exclude '.env' \
  --exclude '.data/' \
  --exclude 'workspace/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  "$staging_dir"/ "$TARGET_DIR"/

log "Seeding node_modules from $TEMPLATE_DIR"
cp -a "$TEMPLATE_DIR/node_modules" "$TARGET_DIR/node_modules"

log "Installing instance env file"
mv "$REMOTE_ENV" "$TARGET_DIR/.env"

cd "$TARGET_DIR"

log "Building project"
npm run build

log "Starting PM2 app $INSTANCE_NAME"
pm2 start dist/server.js --name "$INSTANCE_NAME"
pm2 save

log "Checking health endpoint $HEALTHCHECK_URL"
curl -fsS "$HEALTHCHECK_URL" >/dev/null

log "Instance created successfully"
EOF

log "New instance deployment completed"
