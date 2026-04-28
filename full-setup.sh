#!/bin/bash
set -e

APP_DIR="/home/pi/SWP"
API_DIR="$APP_DIR/artifacts/api-server"
WEB_DIR="$APP_DIR/artifacts/mockup-sandbox"
RELEASE_URL="https://github.com/RX-LOST/Warehouse-NAV/releases/latest/download/build.tar.gz"

echo "=== Updating system ==="
sudo apt update
sudo apt install -y curl tar

echo "=== Installing Node.js ==="
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "Node:"
node -v

echo "=== Preparing directory ==="
mkdir -p "$APP_DIR"
cd "$APP_DIR"

echo "=== Cleaning old deployment ==="
rm -rf "$APP_DIR/artifacts"

echo "=== Downloading release ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting ==="
tar -xzf build.tar.gz
rm build.tar.gz

echo "=== Backend startup check ==="

cd "$API_DIR"

echo "Starting API server..."
export HOST=0.0.0.0
export PORT=3000

# prefer compiled output (your dist is ES module)
if [ -f "dist/index.mjs" ]; then
  node dist/index.mjs
else
  node index.ts
fi
