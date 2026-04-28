#!/bin/bash
set -e

APP_DIR="/home/pi/SWP"
RELEASE_URL="https://github.com/RX-LOST/Warehouse-NAV/releases/latest/download/build.tar.gz"

echo "=== Updating system ==="
sudo apt update
sudo apt install -y curl tar

echo "=== Installing Node.js (NodeSource) ==="
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "Node version:"
node -v
npm -v

echo "=== Installing pnpm ==="
if ! command -v pnpm &> /dev/null; then
  npm install -g pnpm
fi

echo "=== Preparing directory ==="
mkdir -p "$APP_DIR"
cd "$APP_DIR"

echo "=== Ensuring persistent data directory ==="
mkdir -p "$APP_DIR/data"

echo "=== Cleaning old deployment (SAFE) ==="

# safer cleanup (DO NOT break workspace root)
find "$APP_DIR" -mindepth 1 -maxdepth 1 \
  ! -name "data" \
  -exec rm -rf {} +

echo "=== Downloading release ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting FULL workspace ==="
tar -xzf build.tar.gz
rm -f build.tar.gz

echo "=== Installing dependencies (MONOREPO ROOT) ==="

cd "$APP_DIR"

export CI=true
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

# IMPORTANT: install at workspace root
pnpm install --frozen-lockfile || pnpm install

echo "=== Building workspace ==="
pnpm run build || true

echo "=== Starting API server ==="

# run correct workspace package
pnpm --filter @workspace/api-server start
