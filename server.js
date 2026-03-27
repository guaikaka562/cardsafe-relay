/**
 * CardSafe NFC 中继服务器 (Node.js)
 * 免费部署: Render.com — 见 README_部署说明.md
 *
 * 功能:
 *   - 多房间: kid1/kid2 各自独立，互不干扰
 *   - 自动配对: HOST(孩子)和AGENT(家长)通过房间码连接
 *   - 自动重连: 断线后双方自动重试
 */

const http      = require('http');
const WebSocket = require('ws');

// 房间表: { "kid1": { HOST: ws, AGENT: ws }, "kid2": {...} }
const rooms = {};
let totalConnections = 0, totalApdus = 0;

// HTTP服务器 — 健康检查 + 保活
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'CardSafe NFC Relay',
    rooms: Object.keys(rooms),
    activeRooms: Object.keys(rooms).length,
    totalConnections,
    totalApdus,
    time: new Date().toISOString()
  }));
});

// WebSocket服务器
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
  totalConnections++;
  let role = null, code = null;
  console.log(`新连接 #${totalConnections} from ${req.socket.remoteAddress}`);

  ws.on('message', (data) => {
    // ── 第一条消息: 握手 "HOST:kid1" 或 "AGENT:kid1" ──
    if (role === null) {
      const init = data.toString().trim();
      const sep  = init.indexOf(':');
      if (sep < 0) { ws.close(1002, 'bad init'); return; }

      role = init.slice(0, sep).toUpperCase();
      code = init.slice(sep + 1).trim();

      if (role !== 'HOST' && role !== 'AGENT') {
        ws.close(1002, 'role must be HOST or AGENT'); return;
      }

      console.log(`[${code}] ${role} 加入`);
      if (!rooms[code]) rooms[code] = {};
      // 替换旧连接
      if (rooms[code][role]) {
        try { rooms[code][role].close(1001, 'replaced'); } catch(e) {}
      }
      rooms[code][role] = ws;

      // 检查对方是否已在
      const peerRole = role === 'HOST' ? 'AGENT' : 'HOST';
      const peer     = rooms[code][peerRole];
      if (peer && peer.readyState === WebSocket.OPEN) {
        ws.send('READY');
        peer.send('READY');
        console.log(`[${code}] ✅ 配对成功! HOST ↔ AGENT`);
      } else {
        ws.send('WAITING'); // 等待对方
        console.log(`[${code}] ${role} 等待 ${peerRole}...`);
      }
      return;
    }

    // ── 正常中继: 转发二进制APDU数据 ──
    const peerRole = role === 'HOST' ? 'AGENT' : 'HOST';
    const peer     = rooms[code] && rooms[code][peerRole];
    if (peer && peer.readyState === WebSocket.OPEN) {
      peer.send(data, { binary: true });
      totalApdus++;
    } else {
      // 对方断线, 通知当前连接
      ws.send('PEER_GONE');
    }
  });

  ws.on('close', () => {
    if (code && rooms[code]) {
      delete rooms[code][role];
      if (Object.keys(rooms[code]).length === 0) {
        delete rooms[code];
        console.log(`[${code}] 房间已清除`);
      } else {
        // 通知对方重连
        const peerRole = role === 'HOST' ? 'AGENT' : 'HOST';
        const peer = rooms[code][peerRole];
        if (peer && peer.readyState === WebSocket.OPEN) {
          peer.send('PEER_GONE');
        }
        console.log(`[${code}] ${role} 离开, 等待重连`);
      }
    }
  });

  ws.on('error', (e) => console.error(`[${code}] ${role} 错误:`, e.message));
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`╔══════════════════════════════════╗`);
  console.log(`║  CardSafe NFC Relay Server       ║`);
  console.log(`║  Port: ${PORT}                      ║`);
  console.log(`║  多房间支持: kid1/kid2/...        ║`);
  console.log(`╚══════════════════════════════════╝`);
});
