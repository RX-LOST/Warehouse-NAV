#!/bin/bash

set -e

APP_DIR="/home/pi/SWP"
DATA_DIR="$APP_DIR/artifacts/api-server/data"
RELEASE_URL="https://github.com/RX-LOST/Warehouse-NAV/releases/latest/download/build.tar.gz"

echo "=== Updating system ==="
sudo apt update
sudo apt install -y curl tar nodejs npm

echo "=== Installing pnpm ==="
if ! command -v pnpm &> /dev/null; then
  npm install -g pnpm
fi

echo "=== Ensuring data directory exists ==="
mkdir -p "$DATA_DIR"

echo "=== Cleaning old deployment (preserving data) ==="

# delete everything except data folder
find "$APP_DIR" -mindepth 1 ! -path "$DATA_DIR*" -exec rm -rf {} +

echo "=== Recreating structure ==="
mkdir -p "$APP_DIR"
mkdir -p "$DATA_DIR"
cd "$APP_DIR"

echo "=== Downloading latest build ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting ==="
tar -xzf build.tar.gz
rm build.tar.gz

echo "=== Installing server dependencies ==="
cd artifacts/api-server

pnpm install --prod --no-frozen-lockfile

echo "=== Starting server ==="

export HOST=0.0.0.0
export PORT=3000

node index.js
