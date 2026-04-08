/**
 * CardSafe NFC 中继服务器 (r194 优化版)
 * 兼容：延迟监测 (PING/PONG) + 卡号同步 (INFO)
 */
const http      = require('http');
const WebSocket = require('ws');

const rooms = {};
let totalConnections = 0, totalApdus = 0;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'CardSafe NFC Relay r194',
    activeRooms: Object.keys(rooms).length,
    totalApdus,
    time: new Date().toISOString()
  }));
});

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
  totalConnections++;
  let role = null, code = null;

  ws.on('message', (data) => {
    const msgStr = data.toString().trim();

    // 1. 处理初始化握手
    if (role === null) {
      const sep = msgStr.indexOf(':');
      if (sep < 0) return;
      role = msgStr.slice(0, sep).toUpperCase();
      code = msgStr.slice(sep + 1).trim();
      if (!rooms[code]) rooms[code] = {};
      if (rooms[code][role]) { try { rooms[code][role].close(); } catch(e) {} }
      rooms[code][role] = ws;

      const peerRole = role === 'HOST' ? 'AGENT' : 'HOST';
      const peer = rooms[code][peerRole];
      if (peer && peer.readyState === WebSocket.OPEN) {
        ws.send('READY');
        peer.send('READY');
      } else {
        ws.send('WAITING');
      }
      return;
    }

    // 2. ★ 协议指令处理 (r194 核心)
    if (msgStr === 'PING') { 
      ws.send('PONG'); // 立即返回，用于 App 计算网络延迟
      return; 
    }
    
    if (msgStr === 'GET_INFO') {
      // 支付端请求卡片信息，转发给读卡端
      const agent = rooms[code] && rooms[code]['AGENT'];
      if (agent && agent.readyState === WebSocket.OPEN) agent.send('GET_INFO');
      return;
    }

    // 3. 正常数据中继 (二进制 APDU)
    const peerRole = role === 'HOST' ? 'AGENT' : 'HOST';
    const peer = rooms[code] && rooms[code][peerRole];
    if (peer && peer.readyState === WebSocket.OPEN) {
      peer.send(data, { binary: Buffer.isBuffer(data) });
      if (role === 'HOST') totalApdus++;
    }
  });

  ws.on('close', () => {
    if (code && rooms[code]) {
      delete rooms[code][role];
      if (Object.keys(rooms[code]).length === 0) delete rooms[code];
    }
  });
});

// Render 默认端口
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`CardSafe Relay r194 running on port ${PORT}`);
});
