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
mkdir -p "$APP_DIR/artifacts/api-server/data/photos"
mkdir -p "$APP_DIR/artifacts/api-server/data/glbs"
mkdir -p "$APP_DIR/artifacts/api-server/data/configs"

# Backup and restore data so we never lose existing data/configs
DATA_BACKUP=$(mktemp -d)
echo "=== Backing up existing data ==="
if [ -d "$APP_DIR/artifacts/api-server/data" ] && [ "$(ls -A "$APP_DIR/artifacts/api-server/data" 2>/dev/null)" ]; then
  cp -a "$APP_DIR/artifacts/api-server/data/." "$DATA_BACKUP/"
  echo "Data backed up to $DATA_BACKUP"
else
  echo "No existing data to back up."
fi

echo "=== Cleaning old deployment ==="
find "$APP_DIR" -mindepth 1 -exec rm -rf {} + 2>/dev/null || true

echo "=== Downloading release ==="
curl -L "$RELEASE_URL" -o build.tar.gz

echo "=== Extracting ==="
tar -xzf build.tar.gz
rm build.tar.gz

echo "=== Restoring data backup ==="
if [ -d "$DATA_BACKUP" ] && [ "$(ls -A "$DATA_BACKUP" 2>/dev/null)" ]; then
  mkdir -p "$APP_DIR/artifacts/api-server/data"
  cp -a "$DATA_BACKUP/." "$APP_DIR/artifacts/api-server/data/"
  echo "Data restored."
fi
rm -rf "$DATA_BACKUP"

echo "=== Verifying backend build ==="
if [ ! -f "$APP_DIR/artifacts/api-server/dist/index.mjs" ]; then
  echo "ERROR: Backend build missing!"
  exit 1
fi

echo "=== FIXING PERMISSIONS (CRITICAL) ==="
# Ensure the service user (pi) owns everything
sudo chown -R pi:pi "$APP_DIR"

# Ensure directories are accessible and writable
find "$APP_DIR" -type d -exec chmod 755 {} \;
find "$APP_DIR" -type f -exec chmod 644 {} \;

# Ensure data directories are writable
chmod -R 775 "$APP_DIR/artifacts/api-server/data"

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
Environment=PORT=8080
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
  echo "Service already exists, ensuring correct config..."

  # Ensure working directory stays correct if script changes
  sudo sed -i "s|WorkingDirectory=.*|WorkingDirectory=$APP_DIR/artifacts/api-server|" "$SERVICE_FILE"
fi

echo "=== Restarting service ==="
sudo systemctl restart ${SERVICE_NAME}

echo "=== Status ==="
sudo systemctl status ${SERVICE_NAME} --no-pager

echo "=== DONE ==="
echo "Server running at http://<pi-ip>:8080"
