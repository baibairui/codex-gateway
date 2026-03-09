#!/bin/bash

# 确保脚本在遇到错误时停止执行
set -e

echo "🚀 开始一键部署到远程服务器..."

# 通过 SSH 连接到服务器，执行拉取、安装依赖、编译、重启 PM2
ssh -o StrictHostKeyChecking=no -i ./br.pem root@115.190.233.134 << 'EOF'
  cd /opt/gateway
  echo "📥 正在拉取最新的代码..."
  git pull origin master

  echo "📦 正在安装依赖..."
  npm install

  echo "🔨 正在编译项目..."
  npm run build

  echo "🔄 正在重启服务 (wecom-codex)..."
  pm2 restart wecom-codex

  echo "✅ 部署及重启完成！"
EOF

echo "🎉 远程代码已拉取，且服务已成功重启生效！"
