#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${SOURCE_DIR:-/opt/gateway/workspace/wecom-codex-gateway}"
TARGET_DIR="${TARGET_DIR:-/opt/gateway}"
BACKUP_DIR="${BACKUP_DIR:-/opt/deploy-backups}"
PM2_APP_NAME="${PM2_APP_NAME:-wecom-codex}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3000/healthz}"

log() {
  printf '==> %s\n' "$1"
}

if [ ! -d "$SOURCE_DIR" ]; then
  printf 'source dir does not exist: %s\n' "$SOURCE_DIR" >&2
  exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
  printf 'target dir does not exist: %s\n' "$TARGET_DIR" >&2
  exit 1
fi

for required_file in package.json package-lock.json bin/publish-workspace.sh; do
  if [ ! -f "$SOURCE_DIR/$required_file" ]; then
    printf 'missing required source file: %s\n' "$SOURCE_DIR/$required_file" >&2
    exit 1
  fi
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

for cmd in rsync tar npm pm2 curl; do
  require_cmd "$cmd"
done

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/gateway-$timestamp.tgz"

log "Backing up live directory to $backup_file"
tar -czf "$backup_file" \
  -C "$TARGET_DIR" \
  --exclude='./node_modules' \
  --exclude='./.data' \
  --exclude='./workspace' \
  .

log "Syncing workspace into live directory"
rsync -a --delete \
  --exclude '.env' \
  --exclude '.data/' \
  --exclude 'workspace/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.git/' \
  --exclude '._*' \
  --exclude '.DS_Store' \
  "$SOURCE_DIR"/ "$TARGET_DIR"/

cd "$TARGET_DIR"

log "Installing dependencies"
npm ci

log "Running tests"
mapfile -t test_files < <(find "$TARGET_DIR/tests" -type f -name '*.test.ts' | sort)
if [ "${#test_files[@]}" -eq 0 ]; then
  printf 'no test files found under %s/tests\n' "$TARGET_DIR" >&2
  exit 1
fi
npx vitest run --exclude 'workspace/**' "${test_files[@]}"

log "Building project"
npm run build

log "Restarting PM2 app $PM2_APP_NAME"
pm2 restart "$PM2_APP_NAME" --update-env

log "Checking health endpoint $HEALTHCHECK_URL"
curl -fsS "$HEALTHCHECK_URL" >/dev/null

log "Publish completed"
