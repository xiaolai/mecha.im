#!/usr/bin/env bash
# refresh-models.sh — Discover available models from all backends.
# Writes to ~/.mecha/models.json. Run via cron daily.
#
# Auth sources (checked in order):
#   Claude:  ANTHROPIC_API_KEY env → ~/.mecha/secrets.yml
#   Codex:   OPENAI_API_KEY env → ~/.codex/auth.json (ChatGPT login)
#   Gemini:  GEMINI_API_KEY env → ~/.mecha/secrets.yml

set -euo pipefail

MECHA_DIR="${HOME}/.mecha"
OUTPUT="${MECHA_DIR}/models.json"
TMPFILE="${OUTPUT}.tmp"

mkdir -p "$MECHA_DIR"

# Helpers
timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(timestamp)] $*" >&2; }

# --- Claude ---
fetch_claude() {
  local key="${ANTHROPIC_API_KEY:-}"
  if [ -z "$key" ]; then
    log "claude: no ANTHROPIC_API_KEY, skipping REST API"
    echo "[]"
    return
  fi
  local resp
  resp=$(curl -sf --max-time 15 "https://api.anthropic.com/v1/models?limit=100" \
    -H "anthropic-version: 2023-06-01" \
    -H "X-Api-Key: ${key}" 2>/dev/null) || { log "claude: API request failed"; echo "[]"; return; }
  echo "$resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)
models = []
for m in d.get('data', []):
    models.append({
        'id': m['id'],
        'name': m.get('display_name', m['id']),
        'max_input': m.get('max_input_tokens'),
        'max_output': m.get('max_tokens'),
    })
json.dump(models, sys.stdout)
" 2>/dev/null || echo "[]"
}

# --- Codex ---
fetch_codex() {
  local key="${OPENAI_API_KEY:-}"
  if [ -z "$key" ]; then
    # Try extracting from codex auth.json (API key mode only)
    key=$(python3 -c "
import json, os
p = os.path.expanduser('~/.codex/auth.json')
d = json.load(open(p))
k = d.get('OPENAI_API_KEY', '')
if k: print(k)
" 2>/dev/null)
  fi
  if [ -z "$key" ]; then
    log "codex: no API key (ChatGPT login can't query REST API), trying codex CLI"
    # Fallback: parse codex help for model hints or use a known list
    if command -v codex &>/dev/null; then
      codex --help 2>/dev/null | grep -oE 'gpt-[0-9a-z.-]+' | sort -u | python3 -c "
import sys, json
models = [{'id': l.strip(), 'name': l.strip()} for l in sys.stdin if l.strip()]
json.dump(models, sys.stdout)
" 2>/dev/null || echo "[]"
    else
      echo "[]"
    fi
    return
  fi
  local resp
  resp=$(curl -sf --max-time 15 "https://api.openai.com/v1/models" \
    -H "Authorization: Bearer ${key}" 2>/dev/null) || { log "codex: API request failed"; echo "[]"; return; }
  echo "$resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)
models = []
for m in d.get('data', []):
    mid = m['id']
    if 'gpt-5' in mid or 'gpt-4' in mid or 'codex' in mid.lower():
        models.append({'id': mid, 'name': mid})
models.sort(key=lambda x: x['id'], reverse=True)
json.dump(models, sys.stdout)
" 2>/dev/null || echo "[]"
}

# --- Gemini ---
fetch_gemini() {
  local key="${GEMINI_API_KEY:-}"
  if [ -z "$key" ]; then
    log "gemini: no GEMINI_API_KEY, skipping"
    echo "[]"
    return
  fi
  local resp
  resp=$(curl -sf --max-time 15 \
    "https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100" \
    2>/dev/null) || { log "gemini: API request failed"; echo "[]"; return; }
  echo "$resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)
models = []
for m in d.get('models', []):
    mid = m.get('name', '').replace('models/', '')
    if 'gemini' in mid:
        models.append({
            'id': mid,
            'name': m.get('displayName', mid),
            'max_input': m.get('inputTokenLimit'),
            'max_output': m.get('outputTokenLimit'),
        })
json.dump(models, sys.stdout)
" 2>/dev/null || echo "[]"
}

# --- Main ---
log "starting model refresh"

CLAUDE=$(fetch_claude)
CODEX=$(fetch_codex)
GEMINI=$(fetch_gemini)

python3 -c "
import json, sys

data = {
    'updated_at': '$(timestamp)',
    'backends': {
        'claude': json.loads('''${CLAUDE}'''),
        'codex': json.loads('''${CODEX}'''),
        'gemini': json.loads('''${GEMINI}'''),
    }
}

# Summary
for name, models in data['backends'].items():
    count = len(models)
    print(f'  {name}: {count} models', file=sys.stderr)

with open('${TMPFILE}', 'w') as f:
    json.dump(data, f, indent=2)
"

mv "$TMPFILE" "$OUTPUT"
log "wrote ${OUTPUT}"
