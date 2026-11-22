#!/usr/bin/env bash
# ==============================================================================
# Hermes Global News Intelligence System — Raspberry Pi Installation Script
# Tested on Raspberry Pi OS (64-bit Bookworm / Debian 12)
# ==============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${APP_DIR}/.venv"
SERVICE_NAME="hermes-news-intelligence"
LAN_HOST="${HERMES_HOST:-127.0.0.1}"
LAN_PORT="${HERMES_PORT:-8088}"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://192.168.1.50:11434}"

echo "[1/5] Installing system packages (python3-venv, sqlite3, libxslt/libxml2)..."
sudo apt-get update -qq
sudo apt-get install -y python3-venv python3-pip sqlite3

echo "[2/5] Creating isolated Python virtual environment at ${VENV_DIR}..."
python3 -m venv "${VENV_DIR}"
source "${VENV_DIR}/bin/activate"

echo "[3/5] Installing Python dependencies from requirements.txt..."
pip install --upgrade pip
pip install -r "${APP_DIR}/../requirements.txt"

echo "[4/5] Initializing SQLite WAL database & running verification test suite..."
export SQLITE_DB_PATH="${APP_DIR}/hermes_news.db"
python3 -c "import sys; sys.path.insert(0, '${APP_DIR}'); from database import init_db; init_db(); print('SQLite database initialized at', '${SQLITE_DB_PATH}')"
pytest "${APP_DIR}/tests/test_news_service.py" -v

echo "[5/5] Generating systemd user service unit (${SERVICE_NAME}.service)..."
mkdir -p "${HOME}/.config/systemd/user"
cat <<EOF > "${HOME}/.config/systemd/user/${SERVICE_NAME}.service"
[Unit]
Description=Hermes Personal Global News Intelligence Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment="HERMES_HOST=${LAN_HOST}"
Environment="HERMES_PORT=${LAN_PORT}"
Environment="OLLAMA_BASE_URL=${OLLAMA_URL}"
Environment="SQLITE_DB_PATH=${APP_DIR}/hermes_news.db"
ExecStart=${VENV_DIR}/bin/uvicorn main:app --host ${LAN_HOST} --port ${LAN_PORT} --workers 1
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload || true
echo "Installation complete. Run ./scripts/start.sh to start the service."
