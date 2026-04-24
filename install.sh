#!/usr/bin/env bash
# ============================================================
# Warehouse NAV  —  Raspberry Pi installer
# Usage:  curl -fsSL https://raw.githubusercontent.com/RX-LOST/Warehouse-NAV/main/install.sh | bash
# Or:     bash install.sh [--port 3000] [--data-dir /var/lib/warehouse-nav] [--no-service]
# ============================================================
set -euo pipefail

# ---------- Defaults ----------
PORT="${PORT:-3000}"
DATA_DIR="${DATA_DIR:-/var/lib/warehouse-nav}"
INSTALL_DIR="${INSTALL_DIR:-/opt/warehouse-nav}"
REPO_URL="${REPO_URL:-https://github.com/RX-LOST/Warehouse-NAV.git}"
SERVICE_NAME="warehouse-nav"
NO_SERVICE=0

# ---------- Parse args ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)       PORT="$2";       shift 2 ;;
    --data-dir)   DATA_DIR="$2";   shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --no-service) NO_SERVICE=1;    shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ---------- Colours ----------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*" >&2; exit 1; }

# ---------- Root check ----------
if [[ $EUID -ne 0 ]]; then
  warn "Not running as root.  Some steps may require sudo."
  SUDO="sudo"
else
  SUDO=""
fi

echo ""
echo "========================================"
echo "  Warehouse NAV — Pi Installer"
echo "  Port        : $PORT"
echo "  Install dir : $INSTALL_DIR"
echo "  Data dir    : $DATA_DIR"
echo "========================================"
echo ""

# ---------- System packages ----------
info "Installing system dependencies…"
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq git curl ca-certificates 2>/dev/null || warn "apt-get install had warnings."

# ---------- Node.js ----------
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(String(process.versions.node.split(\".\")[0]))')" -lt 18 ]]; then
  info "Installing Node.js 20 LTS via NodeSource…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
NODE_VER=$(node --version)
success "Node.js $NODE_VER"

# ---------- pnpm ----------
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm…"
  npm install -g pnpm --silent
fi
PNPM_VER=$(pnpm --version)
success "pnpm $PNPM_VER"

# ---------- Clone / update repo ----------
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Repo already cloned — pulling latest…"
  git -C "$INSTALL_DIR" fetch --quiet origin
  git -C "$INSTALL_DIR" reset --hard origin/main --quiet || git -C "$INSTALL_DIR" reset --hard origin/master --quiet
else
  info "Cloning repository to $INSTALL_DIR…"
  $SUDO mkdir -p "$(dirname "$INSTALL_DIR")"
  $SUDO git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
  # Give current user ownership so builds don't need sudo
  $SUDO chown -R "$(id -u):$(id -g)" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ---------- Install dependencies ----------
info "Installing Node dependencies (pnpm install)…"
pnpm install --frozen-lockfile 2>&1 | grep -v "^Progress" || pnpm install

# ---------- Build frontend ----------
info "Building frontend…"
BASE_PATH="/" pnpm --filter @workspace/warehouse-nav run build

# ---------- Build backend ----------
info "Building backend…"
pnpm --filter @workspace/api-server run build

# ---------- Data directory ----------
info "Creating data directory at $DATA_DIR…"
$SUDO mkdir -p "$DATA_DIR"/{glbs,photos,configs}
$SUDO chown -R "$(id -u):$(id -g)" "$DATA_DIR" 2>/dev/null || true

# ---------- Start script ----------
info "Writing start script…"
cat > "$INSTALL_DIR/start.sh" <<EOF
#!/usr/bin/env bash
export PORT=$PORT
export DATA_DIR=$DATA_DIR
exec node "$INSTALL_DIR/artifacts/api-server/dist/index.mjs"
EOF
chmod +x "$INSTALL_DIR/start.sh"

# ---------- Systemd service ----------
if [[ $NO_SERVICE -eq 0 ]] && command -v systemctl &>/dev/null; then
  info "Installing systemd service ($SERVICE_NAME)…"
  $SUDO tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<EOF
[Unit]
Description=Warehouse NAV Server
After=network.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/start.sh
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
WorkingDirectory=$INSTALL_DIR
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "$SERVICE_NAME"
  $SUDO systemctl restart "$SERVICE_NAME"
  sleep 2

  if systemctl is-active --quiet "$SERVICE_NAME"; then
    success "Service $SERVICE_NAME is running."
  else
    warn "Service did not start cleanly. Check: journalctl -u $SERVICE_NAME -n 30"
  fi
else
  info "Skipping systemd (--no-service flag or systemctl not found)."
  echo ""
  echo "Run manually:  bash $INSTALL_DIR/start.sh"
fi

# ---------- Show local IP ----------
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")

echo ""
echo "========================================"
success "Warehouse NAV installed!"
echo ""
echo "  Open in your browser:"
echo "    http://$LOCAL_IP:$PORT"
echo ""
echo "  Uploaded files stored in: $DATA_DIR"
echo "  To update:  bash $INSTALL_DIR/install.sh"
echo "========================================"
echo ""
