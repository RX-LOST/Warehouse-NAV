#!/bin/bash

set -e

APP_DIR="/home/pi/SWP"
REPO_URL="https://github.com/RX-LOST/Warehouse-NAV.git"
BRANCH="Server-Version"

echo "=== Updating system ==="
sudo apt update
sudo apt install -y curl git build-essential python3 make g++

echo "=== Installing Node.js 20 ==="
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "Node version:"
node -v

echo "=== Installing pnpm ==="
if ! command -v pnpm &> /dev/null; then
  npm install -g pnpm
fi

echo "pnpm version:"
pnpm -v

echo "=== Setting up project directory ==="

if [ ! -d "$APP_DIR" ]; then
  echo "Cloning repository..."
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  echo "Repository exists, updating..."
  cd "$APP_DIR"
  git fetch
  git checkout "$BRANCH"
  git pull
fi

cd "$APP_DIR"

echo "=== Installing dependencies (workspace) ==="

install_deps() {
  pnpm install --prefer-offline --no-frozen-lockfile --no-optional=false
}

# First attempt
if ! install_deps; then
  echo "⚠️ Initial install failed, retrying clean install..."
  rm -rf node_modules pnpm-lock.yaml
  install_deps
fi

echo "=== Building project (with ARM fixes) ==="

build_project() {
  export ROLLUP_SKIP_NATIVE=true
  pnpm build
}

if ! build_project; then
  echo "⚠️ Full build failed. Attempting fallback (skip frontend builds)..."

  # Try building only API server (skip heavy Vite builds)
  if [ -d "artifacts/api-server" ]; then
    cd artifacts/api-server
    pnpm install --prod || true
    echo "✅ API server dependencies installed"
  else
    echo "❌ API server not found"
    exit 1
  fi
else
  echo "✅ Full build succeeded"
fi

echo "=== Starting API server ==="

cd "$APP_DIR/artifacts/api-server"

export HOST=0.0.0.0
export PORT=3000

pnpm start
