#!/bin/sh
set -e

# Required env: UUID
# Optional env: WS_PATH (default /ws), PORT (default 8080)
: "${UUID:?UUID env var is required}"
WS_PATH="${WS_PATH:-/ws}"
PORT="${PORT:-8080}"

# Some runtimes mount the root filesystem read-only (the old version wrote
# to /etc/sing-box and crash-looped there). Pick the first writable dir.
CFG_DIR=""
for d in "${TMPDIR:-/tmp}" "${HOME:-/nonexistent}" "."; do
  if mkdir -p "$d/sing-box" 2>/dev/null; then
    CFG_DIR="$d/sing-box"
    break
  fi
done
: "${CFG_DIR:?no writable directory found for config}"

cat > "$CFG_DIR/config.json" <<EOF
{
  "log": { "level": "warn" },
  "inbounds": [
    {
      "type": "vless",
      "tag": "vless-in",
      "listen": "0.0.0.0",
      "listen_port": ${PORT},
      "users": [ { "uuid": "${UUID}" } ],
      "transport": { "type": "ws", "path": "${WS_PATH}" }
    }
  ],
  "outbounds": [ { "type": "direct", "tag": "direct" } ]
}
EOF

exec sing-box run -c "$CFG_DIR/config.json"
