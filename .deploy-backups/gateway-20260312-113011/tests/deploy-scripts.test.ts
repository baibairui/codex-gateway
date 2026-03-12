import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(import.meta.dirname, '..');

function readScript(relPath: string): string {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

describe('offline deployment scripts', () => {
  it('deploy.sh uploads a release package instead of pulling from git on the server', () => {
    const script = readScript('deploy.sh');

    expect(script).not.toContain('git pull');
    expect(script).toContain('-czf "$archive_path"');
    expect(script).toContain('scp');
    expect(script).toContain('pm2 restart "$PM2_APP_NAME" --update-env');
    expect(script).toContain("tar --exclude='.env'");
    expect(script).toContain('REMOTE_TMP_DIR="$REMOTE_TMP_DIR"');
    expect(script).toContain('case "$target_selector" in');
    expect(script).toContain('read -r -p "选择要部署的实例');
    expect(script).toContain('/opt/gateway|wecom-codex|');
    expect(script).toContain('/opt/gateway-copy|gateway-copy|');
    expect(script).toContain('/opt/gateway-2|gateway-2|');
    expect(script).toContain('/opt/gateway-3|gateway-3|');
    expect(script).toContain('/opt/gateway-4|gateway-4|');
    expect(script).toContain("HEALTHCHECK_RETRIES=\"${HEALTHCHECK_RETRIES:-20}\"");
    expect(script).toContain("HEALTHCHECK_RETRY_DELAY=\"${HEALTHCHECK_RETRY_DELAY:-1}\"");
    expect(script).toContain('Healthcheck attempt');
    expect(script).toContain("printf '可选实例:\\n' >&2");
  });

  it('deploy-all.sh remains a thin wrapper for full deployment', () => {
    const script = readScript('deploy-all.sh');

    expect(script).toContain('exec "$SCRIPT_DIR/deploy.sh" all');
  });

  it('deploy-env.sh exists for independent environment updates', () => {
    const script = readScript('deploy-env.sh');

    expect(script).toContain('scp');
    expect(script).toContain('.env.bak.');
    expect(script).toContain('pm2 restart');
    expect(script).toContain('--update-env');
    expect(script).toContain('choose_instance');
    expect(script).toContain('case "$INSTANCE_NAME" in');
    expect(script).toContain("printf '可选实例:\\n' >&2");
  });

  it('deploy-new.sh creates instances from an uploaded release package instead of cloning remotely', () => {
    const script = readScript('deploy-new.sh');

    expect(script).not.toContain('git clone');
    expect(script).toContain('-czf "$archive_path"');
    expect(script).toContain('scp');
    expect(script).toContain('pm2 start dist/server.js');
    expect(script).toContain('REMOTE_TMP_DIR="$REMOTE_TMP_DIR"');
  });
});
