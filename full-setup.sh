#!/bin/bash

set -e

echo "=== Updating system ==="
sudo apt update
sudo apt install -y curl build-essential python3 make g++

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

echo "=== Installing dependencies (workspace) ==="
pnpm install

echo "=== Building project ==="
pnpm build

echo "=== Starting API server ==="
cd artifacts/api-server

# Ensure server binds externally
export HOST=0.0.0.0
export PORT=3000

pnpm start
