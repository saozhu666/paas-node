# paas-node

Generic sing-box container for PaaS free tiers. Runs a single VLESS + WebSocket
inbound (no TLS inside the container — the platform's ingress terminates TLS).

## Environment variables

| Name      | Required | Default | Notes                          |
|-----------|----------|---------|--------------------------------|
| `UUID`    | yes      | —       | VLESS user UUID                |
| `WS_PATH` | no       | `/ws`   | WebSocket path                 |
| `PORT`    | no       | `8080`  | Listen port (platform usually injects this) |

## Client settings

- Address: the app's public domain (e.g. `*.cloady.io`)
- Port: 443, TLS on, SNI/Host = the same domain
- Transport: WebSocket, path = `WS_PATH`
- UUID = the `UUID` env var set at deploy time
