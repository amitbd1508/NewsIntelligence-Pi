# Hermes Agent — Autonomous Installation & Gateway Integration Runbook

Copy and paste the block below directly to your **Hermes Agent** on your Raspberry Pi so it installs, verifies, and wires the Global News Intelligence microservice into your existing Hermes Dashboard without overwriting existing files or conflicting with your Hermes Gateway port.

---

## Direct Instruction Prompt for Hermes Agent

```text
Task for Hermes Agent: Install and integrate the Personal Free Global News Intelligence System on this Raspberry Pi.

1. TARGET PATHS & PORT ISOLATION (DO NOT OVERWRITE EXISTING HERMES GATEWAY):
   - Service Directory: ~/.hermes/services/news-intelligence
   - SQLite WAL Database Path: /home/pi/.hermes/data/hermes_news.db
   - FastAPI Internal Bind Address: 127.0.0.1:8088 (HERMES_HOST=127.0.0.1, HERMES_PORT=8088)
   - Apple M1 Ollama LAN Endpoint: http://192.168.1.50:11434 (discover active model dynamically via GET /api/ps and GET /api/tags; never hardcode model name)
   - Keep my existing Hermes Gateway and Dashboard running on its current port.

2. AUTOMATED INSTALLATION STEPS TO EXECUTE:
   a) Create directories:
      mkdir -p ~/.hermes/services/news-intelligence ~/.hermes/data
   b) Copy the news service files (config.json, database.py, intelligence.py, collectors.py, main.py, scripts/, tests/) into ~/.hermes/services/news-intelligence/ and requirements.txt into ~/.hermes/services/.
   c) Execute the installer:
      cd ~/.hermes/services/news-intelligence
      chmod +x scripts/install.sh scripts/start.sh
      export HERMES_HOST="127.0.0.1"
      export HERMES_PORT="8088"
      export SQLITE_DB_PATH="$HOME/.hermes/data/hermes_news.db"
      export OLLAMA_BASE_URL="http://192.168.1.50:11434"
      ./scripts/install.sh

3. START & ENABLE SYSTEMD SERVICE:
   systemctl --user daemon-reload
   systemctl --user enable --now hermes-news-intelligence.service
   systemctl --user status hermes-news-intelligence.service --no-pager

4. VERIFY HEALTH, SQLITE WAL & M1 OLLAMA DISCOVERY:
   curl -s http://127.0.0.1:8088/api/health | python3 -m json.tool
   curl -s "http://127.0.0.1:8088/api/articles?category=top&limit=5" | python3 -m json.tool
   curl -s http://127.0.0.1:8088/api/feed.rss | head -n 25

5. REGISTER WITH HERMES GATEWAY & DASHBOARD:
   - Map internal proxy routes in the existing Hermes Gateway to http://127.0.0.1:8088:
     * GET  /api/articles            -> http://127.0.0.1:8088/api/articles
     * GET  /api/clusters            -> http://127.0.0.1:8088/api/clusters
     * GET  /api/health              -> http://127.0.0.1:8088/api/health
     * GET  /api/feed.rss            -> http://127.0.0.1:8088/api/feed.rss
     * POST /api/collect             -> http://127.0.0.1:8088/api/collect
     * PATCH /api/articles/:id/state -> http://127.0.0.1:8088/api/articles/:id/state
   - Mount the Hermes News Intelligence Dashboard module into the existing Hermes UI navigation without creating a second dashboard or overwriting unrelated files.
```

---

## One-Line Shell Command for Hermes Agent Executor

If your Hermes Agent accepts a direct shell execution command on the Raspberry Pi:

```bash
mkdir -p "$HOME/.hermes/data" && \
cd raspberry_pi_service && \
chmod +x scripts/install.sh scripts/start.sh && \
HERMES_HOST="127.0.0.1" \
HERMES_PORT="8088" \
SQLITE_DB_PATH="$HOME/.hermes/data/hermes_news.db" \
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://192.168.1.50:11434}" \
./scripts/install.sh && \
systemctl --user enable --now hermes-news-intelligence.service && \
curl -s http://127.0.0.1:8088/api/health
```
