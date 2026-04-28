#!/bin/bash
set -e

APP_DIR="/home/pi/SWP"
RELEASE_URL="https://github.com/RX-LOST/Warehouse-NAV/releases/latest/download/build.tar.gz"

echo "=== Updating system ==="
sudo apt update
sudo apt install -y curl tar git

echo "=== Installing Node.js (NodeSource) ==="
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "Node version:"
node -v
npm -v

echo "=== Installing pnpm (COREPACK recommended) ==="
corepack enable
corepack prepare pnpm@latest --activate

pnpm -v

echo "=== Preparing directory ==="
mkdir -p "$APP_DIR"
cd "$APP_DIR"

echo "=== Cleaning old deployment (SAFE) ==="
find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name "artifacts" ! -name "data" -exec rm -rf {} +

echo "=== Downloading release ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting ==="
tar -xzf build.tar.gz
rm build.tar.gz

echo "=== Finding workspace root ==="
# If repo extracted into artifacts folder, go there
if [ -d "$APP_DIR/artifacts" ]; then
  cd "$APP_DIR/artifacts/mockup-sandbox" || cd "$APP_DIR/artifacts/api-server"
else
  cd "$APP_DIR"
fi

echo "Workspace root: $(pwd)"

echo "=== Enabling pnpm workspace mode ==="
export PNPM_HOME="$HOME/.pnpm"
export PATH="$PNPM_HOME:$PATH"

pnpm config set auto-install-peers true
pnpm config set strict-peer-dependencies false

echo "=== Installing dependencies (WORKSPACE ROOT FIXED) ==="

# IMPORTANT FIX:
pnpm install --no-frozen-lockfile --recursive

echo "=== Building (if needed) ==="
if [ -f "package.json" ]; then
  pnpm run build || true
fi

echo "=== Starting server ==="

cd "$APP_DIR/artifacts/api-server" 2>/dev/null || true

export HOST=0.0.0.0
export PORT=3000

node dist/index.js || node index.js
