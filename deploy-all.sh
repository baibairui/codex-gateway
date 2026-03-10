#!/bin/bash
set -e

echo "🚀 开始一键部署到远程服务器上的两个节点..."

# 通过 SSH 部署 /opt/gateway 并重启 wecom-codex
echo "======================================"
echo "🎯 同步并部署节点 1 (/opt/gateway)"
ssh -o StrictHostKeyChecking=no -i ./br.pem root@115.190.233.134 << 'INSIDEOF'
  set -e
  cd /opt/gateway
  git pull origin master
  npm install
  npm run build
  pm2 restart wecom-codex
INSIDEOF
echo "✅ 节点 1 部署成功！"

# 通过 SSH 部署 /opt/gateway-copy。目前似乎它没有配置给 pm2，如果需要启动此节点请修改 PM2 动作。
echo "======================================"
echo "🎯 同步并部署节点 2 (/opt/gateway-copy)"
ssh -o StrictHostKeyChecking=no -i ./br.pem root@115.190.233.134 << 'INSIDEOF2'
  set -e
  cd /opt/gateway-copy
  git pull origin master
  npm install
  npm run build
  pm2 restart gateway-copy
INSIDEOF2
echo "✅ 节点 2 部署成功！"

echo "======================================"
echo "🎉 所有远程代码已全部同步及生效！"
