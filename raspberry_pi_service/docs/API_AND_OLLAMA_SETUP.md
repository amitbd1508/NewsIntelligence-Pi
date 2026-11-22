# Hermes Global News Intelligence — API Reference & Apple M1 Ollama LAN Configuration

## 1. Architecture Overview
- **Raspberry Pi Node**: Runs the 11-connector news collector (`collectors.py`), local scoring & corroboration engine (`intelligence.py`), APScheduler background worker, FastAPI server (`main.py`), and persistent SQLite WAL database (`hermes_news.db`).
- **Apple M1 Mac Node**: Runs Ollama bound exclusively to the local subnet (`192.168.1.x:11434`). The Raspberry Pi dynamically queries `GET /api/ps` and `GET /api/tags` on the M1 Mac to discover the active model rather than hardcoding model names.
- **Hermes Dashboard**: Displays the live breaking-news ticker, developing multi-publisher story clusters, category feeds (Top, Global, AI & Tech, Business & Markets, US & Texas, Bangladesh & India, Science & Research, Travel & Aviation), bookmarks, collector health telemetry, and RSS/JSON exports.

---

## 2. Configuring Apple M1 Mac Ollama for LAN Access (Without Public Exposure)

By default, Ollama on macOS binds only to `127.0.0.1:11434`. To allow your Raspberry Pi on the same private LAN to access Ollama securely without exposing the port publicly:

### Step 1: Bind Ollama to your M1 Mac's Private LAN IP
Find your M1 Mac's static LAN IP (for example `192.168.1.50`):
```bash
ipconfig getifaddr en0
```

Configure macOS `launchctl` so the Ollama desktop app or service listens on your LAN interface:
```bash
launchctl setenv OLLAMA_HOST "192.168.1.50:11434"
```
To persist this across macOS reboots, create `~/Library/LaunchAgents/com.user.ollama.lan.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.ollama.lan</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/launchctl</string>
        <string>setenv</string>
        <string>OLLAMA_HOST</string>
        <string>192.168.1.50:11434</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```
Restart the Ollama application on your M1 Mac after applying `launchctl setenv`.

### Step 2: Restrict Access to Raspberry Pi IP via macOS PF Firewall (Optional Hardening)
Ensure port `11434` is never forwarded on your router (UPnP disabled) and optionally restrict incoming TCP `11434` to your Raspberry Pi IP (`192.168.1.60`):
```bash
# Verify from Raspberry Pi that dynamic model discovery responds:
curl -s http://192.168.1.50:11434/api/tags | python3 -m json.tool
```

### Step 3: How Dynamic Model Discovery Works
Hermes never assumes a model name (`llama3`, `mistral`, `qwen2.5`, etc.):
1. It first checks `GET http://<M1_LAN_IP>:11434/api/ps` to see if a model is already loaded in Apple Silicon unified memory.
2. If no model is actively warm in RAM, it queries `GET http://<M1_LAN_IP>:11434/api/tags` and selects the first configured local model.
3. Only stories that pass local keyword scoring and cross-publisher deduplication (`breaking_score >= 65` or `corroboration_count >= 2`) are sent to Ollama.
4. If your M1 Mac is asleep or offline, Hermes logs the offline state in `/api/health` and seamlessly falls back to the local deterministic extractive summary engine.

---

## 3. REST & RSS API Documentation

### `GET /api/health`
Returns database statistics, M1 Ollama discovery status (`online`, `discovered_model`, `available_models`), and per-connector telemetry for all 11 news connectors.

### `GET /api/articles`
Query parameters:
- `category`: `top` | `global` | `ai_tech` | `business` | `us_texas` | `bd_india` | `science` | `travel_aviation`
- `q`: Search query matching headline, snippet, or publisher
- `bookmarked`: `true` | `false`
- `unread_only`: `true` | `false`
- `breaking_only`: `true` | `false`
- `limit`: integer (`1..250`, default `80`)

### `GET /api/clusters`
Returns developing story clusters where related articles across multiple publishers are grouped together with corroboration counts and verification badges.

### `PATCH /api/articles/{article_id}/state`
Body:
```json
{
  "is_read": true,
  "is_bookmarked": true
}
```

### `POST /api/articles/{article_id}/summarize`
Triggers on-demand M1 Ollama inference (or local extractive synthesis if Ollama is unreachable) for a specific article.

### `POST /api/collect`
Triggers an immediate collection cycle across all 11 connectors or a specific `connector_id`.

### `GET /api/feed.rss`
Outputs a valid RSS 2.0 XML feed of the curated intelligence database. Supports `?category=ai_tech`, `?category=bd_india`, etc.
