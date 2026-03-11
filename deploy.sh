#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_HOST="${SERVER_HOST:-115.190.233.134}"
SERVER_USER="${SERVER_USER:-root}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$SCRIPT_DIR/br.pem}"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$SSH_KEY_PATH")
REMOTE_TMP_DIR="${REMOTE_TMP_DIR:-/tmp/codex-gateway-release}"
BACKUP_DIR="${BACKUP_DIR:-/opt/deploy-backups}"
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-20}"
HEALTHCHECK_RETRY_DELAY="${HEALTHCHECK_RETRY_DELAY:-1}"

log() {
  printf '==> %s\n' "$1"
}

require_local_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required local command: %s\n' "$1" >&2
    exit 1
  fi
}

choose_target() {
  local input="${1:-}"
  if [ -n "$input" ]; then
    printf '%s\n' "$input"
    return
  fi

  printf '可选实例:\n' >&2
  printf '  1) gateway\n' >&2
  printf '  2) gateway-copy\n' >&2
  printf '  3) gateway-2\n' >&2
  printf '  4) gateway-3\n' >&2
  printf '  5) gateway-4\n' >&2
  printf '  6) all\n' >&2
  read -r -p "选择要部署的实例 [gateway/gateway-copy/gateway-2/gateway-3/gateway-4/all]: " input
  printf '%s\n' "$input"
}

resolve_deploy_specs() {
  local target_selector="$1"

  case "$target_selector" in
    gateway|'1')
      printf '%s\n' "/opt/gateway|wecom-codex|${PRIMARY_HEALTHCHECK_URL:-http://127.0.0.1:3000/healthz}"
      ;;
    gateway-copy|'2')
      printf '%s\n' "/opt/gateway-copy|gateway-copy|${SECONDARY_HEALTHCHECK_URL:-http://127.0.0.1:3001/healthz}"
      ;;
    gateway-2|'3')
      printf '%s\n' "/opt/gateway-2|gateway-2|${GATEWAY_2_HEALTHCHECK_URL:-http://127.0.0.1:3002/healthz}"
      ;;
    gateway-3|'4')
      printf '%s\n' "/opt/gateway-3|gateway-3|${GATEWAY_3_HEALTHCHECK_URL:-http://127.0.0.1:3003/healthz}"
      ;;
    gateway-4|'5')
      printf '%s\n' "/opt/gateway-4|gateway-4|${GATEWAY_4_HEALTHCHECK_URL:-http://127.0.0.1:3004/healthz}"
      ;;
    all|'6')
      printf '%s\n' "/opt/gateway|wecom-codex|${PRIMARY_HEALTHCHECK_URL:-http://127.0.0.1:3000/healthz}"
      printf '%s\n' "/opt/gateway-copy|gateway-copy|${SECONDARY_HEALTHCHECK_URL:-http://127.0.0.1:3001/healthz}"
      printf '%s\n' "/opt/gateway-2|gateway-2|${GATEWAY_2_HEALTHCHECK_URL:-http://127.0.0.1:3002/healthz}"
      printf '%s\n' "/opt/gateway-3|gateway-3|${GATEWAY_3_HEALTHCHECK_URL:-http://127.0.0.1:3003/healthz}"
      printf '%s\n' "/opt/gateway-4|gateway-4|${GATEWAY_4_HEALTHCHECK_URL:-http://127.0.0.1:3004/healthz}"
      ;;
    *)
      printf 'unknown deploy target: %s\n' "$target_selector" >&2
      return 1
      ;;
  esac
}

deploy_target() {
  local target_dir="$1"
  local pm2_app_name="$2"
  local healthcheck_url="$3"
  local remote_archive="$REMOTE_TMP_DIR/$(basename "$archive_path").$(basename "$target_dir")"

  log "Uploading archive for $target_dir"
  scp "${SSH_OPTS[@]}" "$archive_path" "${SERVER_USER}@${SERVER_HOST}:$remote_archive"

  log "Publishing release to $target_dir"
  ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" \
    TARGET_DIR="$target_dir" \
    PM2_APP_NAME="$pm2_app_name" \
    HEALTHCHECK_URL="$healthcheck_url" \
    HEALTHCHECK_RETRIES="$HEALTHCHECK_RETRIES" \
    HEALTHCHECK_RETRY_DELAY="$HEALTHCHECK_RETRY_DELAY" \
    BACKUP_DIR="$BACKUP_DIR" \
    REMOTE_TMP_DIR="$REMOTE_TMP_DIR" \
    REMOTE_ARCHIVE="$remote_archive" \
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

for cmd in tar rsync pm2 curl npm cmp mktemp; do
  require_remote_cmd "$cmd"
done

if [ ! -d "$TARGET_DIR" ]; then
  printf 'target dir does not exist: %s\n' "$TARGET_DIR" >&2
  exit 1
fi

if [ ! -d "$TARGET_DIR/node_modules" ]; then
  printf 'node_modules missing under %s; offline deploy cannot install dependencies\n' "$TARGET_DIR" >&2
  exit 1
fi

staging_dir="$(mktemp -d "${REMOTE_TMP_DIR%/}/staging.XXXXXX")"
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/$(basename "$TARGET_DIR")-$timestamp.tgz"
trap 'rm -rf "$staging_dir" "$REMOTE_ARCHIVE"' EXIT

log "Backing up current release to $backup_file"
tar -czf "$backup_file" \
  -C "$TARGET_DIR" \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./workspace' \
  --exclude='./.data' \
  .

log "Extracting uploaded archive"
tar -xzf "$REMOTE_ARCHIVE" -C "$staging_dir"

if [ ! -f "$staging_dir/package-lock.json" ] || [ ! -f "$TARGET_DIR/package-lock.json" ]; then
  printf 'package-lock.json missing in staging or target; refusing offline deploy\n' >&2
  exit 1
fi

if ! cmp -s "$staging_dir/package-lock.json" "$TARGET_DIR/package-lock.json"; then
  printf 'package-lock.json changed; offline deploy cannot refresh dependencies on the server\n' >&2
  exit 1
fi

log "Syncing release into $TARGET_DIR while preserving .env and node_modules"
rsync -a --delete \
  --exclude '.env' \
  --exclude '.data/' \
  --exclude 'workspace/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  "$staging_dir"/ "$TARGET_DIR"/

cd "$TARGET_DIR"

log "Building project"
npm run build

log "Restarting PM2 app $PM2_APP_NAME"
pm2 restart "$PM2_APP_NAME" --update-env

log "Checking health endpoint $HEALTHCHECK_URL"
healthcheck_ok=0
for attempt in $(seq 1 "$HEALTHCHECK_RETRIES"); do
  if curl -fsS "$HEALTHCHECK_URL" >/dev/null; then
    healthcheck_ok=1
    break
  fi

  printf 'Healthcheck attempt %s/%s failed for %s\n' "$attempt" "$HEALTHCHECK_RETRIES" "$HEALTHCHECK_URL" >&2
  sleep "$HEALTHCHECK_RETRY_DELAY"
done

if [ "$healthcheck_ok" -ne 1 ]; then
  printf 'healthcheck failed after %s attempts: %s\n' "$HEALTHCHECK_RETRIES" "$HEALTHCHECK_URL" >&2
  exit 1
fi

log "Release published successfully for $TARGET_DIR"
EOF
}

for cmd in ssh scp tar mktemp; do
  require_local_cmd "$cmd"
done

if [ ! -f "$SSH_KEY_PATH" ]; then
  printf 'ssh key not found: %s\n' "$SSH_KEY_PATH" >&2
  exit 1
fi

archive_path="$(mktemp "${TMPDIR:-/tmp}/gateway-release.XXXXXX.tgz")"
trap 'rm -f "$archive_path"' EXIT

target_selector="$(choose_target "${1:-}")"
deploy_specs=()
while IFS= read -r spec; do
  deploy_specs+=("$spec")
done < <(resolve_deploy_specs "$target_selector")

log "Creating local release archive"
COPYFILE_DISABLE=1 tar --exclude='.env' \
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

ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" "mkdir -p '$REMOTE_TMP_DIR' '$BACKUP_DIR'"

for spec in "${deploy_specs[@]}"; do
  IFS='|' read -r target_dir pm2_app_name healthcheck_url <<<"$spec"
  deploy_target "$target_dir" "$pm2_app_name" "$healthcheck_url"
done

log "Deployment completed"
