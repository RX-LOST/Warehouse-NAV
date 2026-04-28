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

echo "=== Cleaning old deployment (SAFE) ==="
find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name "data" -exec rm -rf {} +

echo "=== Downloading release ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting ==="
tar -xzf build.tar.gz
rm -f build.tar.gz

echo "=== Finding pnpm workspace root ==="

# Find the REAL workspace root (must contain pnpm-workspace.yaml OR root package.json with workspace deps)
ROOT_DIR=$(find "$APP_DIR" -name "pnpm-workspace.yaml" -type f 2>/dev/null | head -n 1 | xargs dirname || true)

# fallback if workspace file not found
if [ -z "$ROOT_DIR" ]; then
  ROOT_DIR=$(find "$APP_DIR" -name package.json -not -path "*/node_modules/*" \
    -exec grep -l '"@workspace/' {} \; \
    | head -n 1 | xargs dirname)
fi

if [ -z "$ROOT_DIR" ]; then
  echo "❌ ERROR: Could not find workspace root"
  echo "Dumping structure for debugging:"
  find "$APP_DIR" -maxdepth 4 -name package.json
  exit 1
fi

echo "Detected workspace root: $ROOT_DIR"

cd "$ROOT_DIR"

echo "=== Enabling pnpm environment ==="
export CI=true
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

echo "=== Installing dependencies (workspace mode) ==="
pnpm install --frozen-lockfile || pnpm install

echo "=== Building workspace ==="
pnpm run build || true

echo "=== Starting API server ==="
exec pnpm --filter @workspace/api-server start
