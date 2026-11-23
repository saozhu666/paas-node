// Zero-dependency VLESS + WebSocket server for Node.js (for Pterodactyl-style node eggs)
// Env: UUID (required), WS_PATH (default /ws), SERVER_PORT or PORT (listen port)
const http = require('http');
const net = require('net');
const crypto = require('crypto');

const UUID_HEX = (process.env.UUID || '').replace(/-/g, '').toLowerCase();
const WS_PATH = process.env.WS_PATH || '/ws';
const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || '3000', 10);

if (!/^[0-9a-f]{32}$/.test(UUID_HEX)) {
  console.error('FATAL: UUID env var missing or invalid');
  process.exit(1);
}
const UUID_BUF = Buffer.from(UUID_HEX, 'hex');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});

server.on('upgrade', (req, socket) => {
  const path = (req.url || '').split('?')[0];
  const key = req.headers['sec-websocket-key'];
  if (path !== WS_PATH || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  handleConnection(socket);
});

function wsSend(socket, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x82, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x82; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  if (!socket.destroyed) socket.write(Buffer.concat([header, payload]));
}

function handleConnection(socket) {
  let buf = Buffer.alloc(0);
  let frags = [];
  let remote = null;
  let headerBuf = Buffer.alloc(0);
  let established = false;

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // Parse as many complete WS frames as available
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < off + 2) return;
        len = buf.readUInt16BE(off); off += 2;
      } else if (len === 127) {
        if (buf.length < off + 8) return;
        len = Number(buf.readBigUInt64BE(off)); off += 8;
      }
      let mask = null;
      if (masked) {
        if (buf.length < off + 4) return;
        mask = buf.slice(off, off + 4); off += 4;
      }
      if (buf.length < off + len) return;
      let payload = buf.slice(off, off + len);
      buf = buf.slice(off + len);
      if (mask) {
        const out = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      if (opcode === 0x8) { socket.end(); return; }
      if (opcode === 0x9) { // ping -> pong
        const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
        if (!socket.destroyed) socket.write(pong);
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        frags.push(payload);
        if (!fin) continue;
        const msg = Buffer.concat(frags);
        frags = [];
        onMessage(msg);
        if (socket.destroyed) return;
      }
    }
  });

  function onMessage(msg) {
    if (established) {
      if (remote && !remote.destroyed) remote.write(msg);
      return;
    }
    // Accumulate until the full VLESS header is present
    headerBuf = Buffer.concat([headerBuf, msg]);
    const parsed = parseVlessHeader(headerBuf);
    if (parsed === null) return; // need more data
    if (parsed === false) { socket.destroy(); return; }
    established = true;
    const { version, host, port, rest } = parsed;
    remote = net.connect(port, host, () => {
      wsSend(socket, Buffer.from([version, 0]));
      if (rest.length) remote.write(rest);
    });
    remote.on('data', (d) => wsSend(socket, d));
    remote.on('error', () => socket.destroy());
    remote.on('close', () => socket.destroy());
  }

  socket.on('error', () => { if (remote) remote.destroy(); });
  socket.on('close', () => { if (remote) remote.destroy(); });
}

// Returns null = incomplete, false = invalid, object = parsed
function parseVlessHeader(buf) {
  // Minimum: 1(ver) + 16(uuid) + 1(addon len) = 18, then addon, then 1(cmd) + 2(port) + 1(atyp) + addr
  if (buf.length < 18) return null;
  if (!buf.slice(1, 17).equals(UUID_BUF)) return false;
  const version = buf[0];
  let idx = 17;
  const addonLen = buf[idx]; idx += 1;
  if (buf.length < idx + addonLen + 4) return null;
  idx += addonLen;
  const command = buf[idx]; idx += 1;
  if (command !== 1) return false; // TCP only
  const port = buf.readUInt16BE(idx); idx += 2;
  const atyp = buf[idx]; idx += 1;
  let host;
  if (atyp === 1) {
    if (buf.length < idx + 4) return null;
    host = Array.from(buf.slice(idx, idx + 4)).join('.');
    idx += 4;
  } else if (atyp === 2) {
    if (buf.length < idx + 1) return null;
    const dlen = buf[idx]; idx += 1;
    if (buf.length < idx + dlen) return null;
    host = buf.slice(idx, idx + dlen).toString('utf8');
    idx += dlen;
  } else if (atyp === 3) {
    if (buf.length < idx + 16) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(idx + i).toString(16));
    host = parts.join(':');
    idx += 16;
  } else {
    return false;
  }
  return { version, host, port, rest: buf.slice(idx) };
}

server.listen(PORT, () => console.log('vless-ws listening on port ' + PORT + ' path ' + WS_PATH));
