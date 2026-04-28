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
mkdir -p "$APP_DIR/artifacts/api-server/data"

echo "=== Cleaning old deployment (SAFE) ==="

# SAFE cleanup instead of broken find on pnpm trees
shopt -s extglob

for item in "$APP_DIR"/*; do
  case "$item" in
    "$APP_DIR/artifacts/api-server/data") 
      echo "Preserving data directory"
      ;;
    "$APP_DIR/artifacts/api-server/data/"*)
      echo "Preserving data contents"
      ;;
    *)
      rm -rf "$item"
      ;;
  esac
done

echo "=== Downloading release ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting ==="
tar -xzf build.tar.gz
rm -f build.tar.gz

echo "=== Installing server dependencies ==="
cd artifacts/api-server

export CI=true
export PNPM_CONFIG_CONFIRM_MODULES_PURGE=false

# Make pnpm more stable on Pi
pnpm install --prod --no-frozen-lockfile || npm install --omit=dev

echo "=== Starting server ==="

export HOST=0.0.0.0
export PORT=3000

node index.js
