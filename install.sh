#!/usr/bin/env bash
set -e

APP_NAME="warehouse-nav"
APP_DIR="/home/pi/SWP"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

echo "=== Installing Node.js (NodeSource) ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "Node version:"
node -v
npm -v

echo "=== Installing pnpm ==="
sudo npm install -g pnpm

echo "=== Preparing directory ==="
mkdir -p "$APP_DIR"

echo "=== Cleaning old deployment (SAFE) ==="
rm -rf "$APP_DIR/artifacts"

echo "=== Downloading release ==="
curl -L "$1" -o /tmp/release.tar.gz

echo "=== Extracting ==="
tar -xzf /tmp/release.tar.gz -C "$APP_DIR"

echo "=== FIXING PERMISSIONS (CRITICAL) ==="
sudo chown -R pi:pi "$APP_DIR"
chmod -R 755 "$APP_DIR"

echo "=== Installing dependencies ==="
cd "$APP_DIR"
pnpm install --no-frozen-lockfile || true

echo "=== Creating systemd service (if missing) ==="

if [ ! -f "$SERVICE_FILE" ]; then
  echo "Creating new service..."
  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Warehouse NAV API Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$APP_DIR/artifacts/api-server
ExecStart=/usr/bin/node dist/index.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF
else
  echo "Service already exists, updating..."
  sudo sed -i "s|WorkingDirectory=.*|WorkingDirectory=$APP_DIR/artifacts/api-server|" "$SERVICE_FILE"
fi

echo "=== Reloading systemd ==="
sudo systemctl daemon-reexec
sudo systemctl daemon-reload

echo "=== Enabling service ==="
sudo systemctl enable $APP_NAME

echo "=== Restarting service ==="
sudo systemctl restart $APP_NAME

echo "=== Checking service status ==="
sleep 2
sudo systemctl status $APP_NAME --no-pager || true

echo "=== Done ==="
echo "Server should be running on port 3000"
