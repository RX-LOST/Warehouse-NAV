#!/bin/bash

set -e

APP_DIR="/home/pi/SWP"
SERVICE_NAME="warehouse-nav"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
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

echo "=== Preparing directory ==="
mkdir -p "$APP_DIR"
cd "$APP_DIR"

echo "=== Ensuring persistent data directory ==="
mkdir -p "$APP_DIR/artifacts/api-server/data"

echo "=== Cleaning old deployment (preserving data) ==="
find "$APP_DIR" -mindepth 1 ! -path "$APP_DIR/artifacts/api-server/data*" -exec rm -rf {} +

echo "=== Downloading release ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting ==="
tar -xzf build.tar.gz
rm build.tar.gz

echo "=== Verifying backend build ==="
if [ ! -f "$APP_DIR/artifacts/api-server/dist/index.mjs" ]; then
  echo "ERROR: Backend build missing!"
  exit 1
fi

echo "=== Skipping pnpm install (prebuilt artifacts used) ==="

echo "=== Creating systemd service ==="

if [ ! -f "$SERVICE_FILE" ]; then
  echo "Creating service..."

  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Warehouse NAV Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$APP_DIR/artifacts/api-server
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=3000
ExecStart=/usr/bin/node dist/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reexec
  sudo systemctl daemon-reload
  sudo systemctl enable ${SERVICE_NAME}
else
  echo "Service already exists, skipping creation."
fi

echo "=== Restarting service ==="
sudo systemctl restart ${SERVICE_NAME}

echo "=== Status ==="
sudo systemctl status ${SERVICE_NAME} --no-pager

echo "=== DONE ==="
echo "Server running at http://<pi-ip>:3000"
