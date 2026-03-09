#!/bin/bash
set -e

# 确保脚本在期望的目录下运行
cd "$(dirname "$0")"

echo "🌟 开始在远程服务器上全新部署一个 Codex Gateway 实例"
echo "------------------------------------------------------"

# 1. 获取实例名称
read -p "👉 请输入新实例的名称 (它将用作文件夹名和PM2进程名，如 codex-app-2): " INSTANCE_NAME

if [[ -z "$INSTANCE_NAME" ]]; then
  echo "❌ 实例名称不能为空！"
  exit 1
fi

if [[ ! "$INSTANCE_NAME" =~ ^[a-zA-Z0-9-]+$ ]]; then
  echo "❌ 实例名不合法！只能包含英文字母、数字和横杠 (-)。"
  exit 1
fi

# 2. 获取配置文件路径
read -p "👉 请输入为该实例准备的本地环变量文件(.env)路径 (例如: .env.dev): " ENV_FILE

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ 找不到指定的配置文件: $ENV_FILE"
    echo "💡 提示: 请先在本地生成一份包含你所需要的配置的 .env 文件再运行此部署脚本。"
    exit 1
fi

# 3. 在服务器端执行目录检查和代码拉取
echo "======================================================"
echo "🛡️  连接服务器检查环境并克隆仓库..."

ssh -o StrictHostKeyChecking=no -i ./br.pem root@115.190.233.134 << EOF
  set -e
  if [ -d "/opt/$INSTANCE_NAME" ]; then
    echo "🚫 错误：远程服务器上已存在目录 /opt/$INSTANCE_NAME 。为了安全，不再继续部署。"
    exit 1
  fi
  
  echo "📥 正在从 Github 克隆最新主分支到 /opt/$INSTANCE_NAME ..."
  git clone https://github.com/baibairui/codex-gateway.git /opt/$INSTANCE_NAME
EOF

# 4. 上传本地配置文件
echo "======================================================"
echo "📤 正在上传配置文件 $ENV_FILE 到服务器..."
scp -o StrictHostKeyChecking=no -i ./br.pem "$ENV_FILE" root@115.190.233.134:/opt/$INSTANCE_NAME/.env

# 5. 安装依赖、编译并使用 PM2 启动
echo "======================================================"
echo "⚙️ 正在服务器端执行依赖安装、TypeScript 编译和应用启动..."
ssh -o StrictHostKeyChecking=no -i ./br.pem root@115.190.233.134 << EOF
  set -e
  cd /opt/$INSTANCE_NAME
  
  echo "📦 正在安装 NPM 依赖..."
  npm install

  echo "🔨 正在编译项目..."
  npm run build

  echo "🚀 正在通过 PM2 启动新实例 (进程名: $INSTANCE_NAME) ..."
  pm2 start dist/server.js --name "$INSTANCE_NAME"
  pm2 save

  echo "✅ 实例 $INSTANCE_NAME 远程已启动完成！"
EOF

echo "======================================================"
echo "🎉 部署大功告成！你可以通过 ssh 登录服务器后使用 pm2 list 或 pm2 logs $INSTANCE_NAME 查看状态。"
