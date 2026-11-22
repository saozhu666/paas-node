#!/bin/sh
set -e

# Required env: UUID
# Optional env: WS_PATH (default /ws), PORT (default 8080)
: "${UUID:?UUID env var is required}"
WS_PATH="${WS_PATH:-/ws}"
PORT="${PORT:-8080}"

mkdir -p /etc/sing-box
cat > /etc/sing-box/config.json <<EOF
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

exec sing-box run -c /etc/sing-box/config.json
