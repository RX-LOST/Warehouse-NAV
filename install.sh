echo "=== Setting up systemd service ==="

SERVICE_NAME="warehouse-nav"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
APP_DIR="/home/pi/SWP/artifacts/api-server"
NODE_BIN="$(which node)"

if [ -z "$NODE_BIN" ]; then
  echo "Node not found in PATH!"
  exit 1
fi

# Create or update service file
sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=Warehouse NAV API Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$APP_DIR

ExecStart=$NODE_BIN $APP_DIR/dist/index.mjs

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

echo "=== Enabling service (if not already enabled) ==="
sudo systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true

echo "=== Restarting service ==="
sudo systemctl restart "$SERVICE_NAME"

echo "=== Service status ==="
sudo systemctl --no-pager status "$SERVICE_NAME" || true
