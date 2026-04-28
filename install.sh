#!/bin/bash

set -e

APP_DIR="/home/pi/SWP"
RELEASE_URL="https://github.com/RX-LOST/Warehouse-NAV/releases/latest/download/build.tar.gz"
SERVICE_NAME="warehouse-nav"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

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
find "$APP_DIR" -mindepth 1 \
  ! -path "$APP_DIR/artifacts/api-server/data*" \
  -exec rm -rf {} + || true

echo "=== Downloading release ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting ==="
tar -xzf build.tar.gz
rm build.tar.gz

# Detect workspace root (IMPORTANT FIX FOR YOUR ERROR)
echo "=== Detecting workspace root ==="

WORKSPACE_ROOT=$(find "$APP_DIR" -name "package.json" -type f -exec dirname {} \; | head -n 1)

if [ -z "$WORKSPACE_ROOT" ]; then
  echo "ERROR: No package.json found in extracted release"
  exit 1
fi

echo "Detected workspace root: $WORKSPACE_ROOT"

echo "=== Installing dependencies (workspace-safe mode) ==="

cd "$WORKSPACE_ROOT"

# IMPORTANT FIXES FOR YOUR ERRORS:
export CI=true
export PNPM_IGNORE_WORKSPACE_CATALOG=true

# workspace:* + missing lockfile fix
pnpm install --no-frozen-lockfile --ignore-workspace

echo "=== Installing backend dependencies explicitly ==="

cd "$APP_DIR/artifacts/api-server"
pnpm install --prod --no-frozen-lockfile

echo "=== Ensuring data directory exists ==="
mkdir -p "$APP_DIR/artifacts/api-server/data"

echo "=== Setting up systemd service ==="

NODE_BIN="$(which node)"

sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=Warehouse NAV API Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$APP_DIR/artifacts/api-server

ExecStart=$NODE_BIN $APP_DIR/artifacts/api-server/dist/index.mjs

Restart=always
RestartSec=5

Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "=== Reloading systemd ==="
sudo systemctl daemon-reload

echo "=== Enabling service ==="
sudo systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true

echo "=== Restarting service ==="
sudo systemctl restart "$SERVICE_NAME"

echo "=== Done ==="
echo "Service status:"
sudo systemctl --no-pager status "$SERVICE_NAME" || true
