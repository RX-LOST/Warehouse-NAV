#!/bin/bash

set -e

APP_DIR="/home/pi/SWP"
RELEASE_URL="https://github.com/RX-LOST/Warehouse-NAV/releases/latest/download/build.tar.gz"

echo "=== Updating system ==="
sudo apt update
sudo apt install -y curl tar

echo "=== Installing Node.js (clean NodeSource setup) ==="

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

echo "=== Downloading release ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting ==="
tar -xzf build.tar.gz
rm build.tar.gz

echo "=== Installing server deps ==="
cd artifacts/api-server

pnpm install --prod --no-frozen-lockfile

echo "=== Starting server ==="

export HOST=0.0.0.0
export PORT=3000

node index.js
