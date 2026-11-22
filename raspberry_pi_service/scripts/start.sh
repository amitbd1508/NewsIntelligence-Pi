#!/usr/bin/env bash
# ==============================================================================
# Hermes Global News Intelligence System — Raspberry Pi Startup Script
# ==============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${APP_DIR}/.venv"

# Bind strictly to LAN IP or localhost — never expose publicly to WAN
export HERMES_HOST="${HERMES_HOST:-127.0.0.1}"
export HERMES_PORT="${HERMES_PORT:-8088}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://192.168.1.50:11434}"
export SQLITE_DB_PATH="${SQLITE_DB_PATH:-${APP_DIR}/hermes_news.db}"

if [ -d "${VENV_DIR}" ]; then
  source "${VENV_DIR}/bin/activate"
fi

echo "Starting Hermes Global News Intelligence Service on http://${HERMES_HOST}:${HERMES_PORT}"
echo "Configured Apple M1 Ollama LAN Endpoint: ${OLLAMA_BASE_URL} (Dynamic model discovery via /api/tags)"
cd "${APP_DIR}"
exec python3 -m uvicorn main:app --host "${HERMES_HOST}" --port "${HERMES_PORT}" --no-access-log
