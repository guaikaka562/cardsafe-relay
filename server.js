const http = require('http');
const WebSocket = require('ws');

// 全局异常捕获：确保服务器即使出错也不会崩溃进程
process.on('uncaughtException', (e) => console.error('CRASH:', e));
process.on('unhandledRejection', (e) => console.error('REJECT:', e));

const rooms = {};
const httpServer = http.createServer((req, res) => {
  // 极简响应：防止 cron-job 报错 "Output too large"
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok'); 
});

const wss = new WebSocket.Server({ server: httpServer });
wss.on('connection', (ws) => {
  let role = null, code = null;
  ws.on('message', (data) => {
    try {
      const msgStr = data.toString().trim();
      // 初始化握手
      if (role === null) {
        const sep = msgStr.indexOf(':');
        if (sep < 0) return;
        role = msgStr.slice(0, sep).toUpperCase();
        code = msgStr.slice(sep + 1).trim();
        if (!rooms[code]) rooms[code] = {};
        if (rooms[code][role]) { try { rooms[code][role].close(); } catch(e) {} }
        rooms[code][role] = ws;
        const peerRole = (role === 'HOST' ? 'AGENT' : 'HOST');
        const peer = rooms[code][peerRole];
        if (peer && peer.readyState === WebSocket.OPEN) {
          ws.send('READY'); peer.send('READY');
        }
        return;
      }
      // PING 指令
      if (msgStr === 'PING') { ws.send('PONG'); return; }
      // 获取卡片信息指令
      if (msgStr === 'GET_INFO') {
        const agent = rooms[code] && rooms[code]['AGENT'];
        if (agent && agent.readyState === WebSocket.OPEN) agent.send('GET_INFO');
        return;
      }
      // 数据中继
      const peer = rooms[code] && rooms[code][role === 'HOST' ? 'AGENT' : 'HOST'];
      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(data, { binary: Buffer.isBuffer(data) });
      }
    } catch (e) { console.error('MSG_ERR:', e); }
  });
  ws.on('close', () => {
    if (code && rooms[code]) {
      delete rooms[code][role];
      if (Object.keys(rooms[code]).length === 0) delete rooms[code];
    }
  });
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => console.log(`Stable Relay on ${PORT}`));
