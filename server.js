const http = require('http');
const WebSocket = require('ws');

// ★ 全局错误捕获：防止任何错误导致服务器彻底宕机
process.on('uncaughtException', (err) => console.error('SERVER_CRASH:', err));
process.on('unhandledRejection', (reason, p) => console.error('PROMISE_REJECT:', reason));

const rooms = {};

// 1. 创建 HTTP 服务 (用于 Cron-job 保活和健康检查)
const httpServer = http.createServer((req, res) => {
  // 无论访问什么路径，都返回 ok，状态码 200
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});

// 2. 创建 WebSocket 服务 (用于中继)
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
  let role = null; // HOST 或 AGENT
  let code = null; // 房间号

  ws.on('message', (data) => {
    try {
      const msgStr = data.toString().trim();

      // 第一阶段：处理初始化握手
      if (role === null) {
        if (!msgStr.includes(':')) return;
        const parts = msgStr.split(':');
        role = parts[0].toUpperCase();
        code = parts[1].trim();

        if (!rooms[code]) rooms[code] = {};
        // 如果旧连接存在，先关闭它
        if (rooms[code][role]) {
          try { rooms[code][role].close(); } catch(e) {}
        }
        rooms[code][role] = ws;

        // 检查配对情况
        const peerRole = (role === 'HOST' ? 'AGENT' : 'HOST');
        const peer = rooms[code][peerRole];
        if (peer && peer.readyState === WebSocket.OPEN) {
          ws.send('READY');
          peer.send('READY');
          console.log(`[Room ${code}] Connected: ${role} + ${peerRole}`);
        }
        return;
      }

      // 第二阶段：处理控制指令
      if (msgStr === 'PING') { ws.send('PONG'); return; }
      if (msgStr === 'GET_INFO') {
        const agent = rooms[code] && rooms[code]['AGENT'];
        if (agent && agent.readyState === WebSocket.OPEN) agent.send('GET_INFO');
        return;
      }

      // 第三阶段：纯数据转发 (APDU)
      const targetRole = (role === 'HOST' ? 'AGENT' : 'HOST');
      const target = rooms[code] && rooms[code][targetRole];
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(data, { binary: Buffer.isBuffer(data) });
      }
    } catch (e) {
      console.error('Relay error:', e);
    }
  });

  ws.on('close', () => {
    if (code && rooms[code]) {
      delete rooms[code][role];
      if (Object.keys(rooms[code]).length === 0) delete rooms[code];
    }
  });
});

// 3. 启动监听 (Render 自动分配端口)
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`CardSafe Relay r196 Live on port ${PORT}`);
});
