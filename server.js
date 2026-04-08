const http = require('http');
const WebSocket = require('ws');

// 1. 全局保护
process.on('uncaughtException', (e) => console.error('CRITICAL:', e));

const rooms = {};

// 2. 基础 HTTP (用于保活和健康检查)
const httpServer = http.createServer((req, res) => {
    // 强制返回最简 JSON，绝不会报 "Output too large"
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: "ok" }));
});

// 3. WebSocket 逻辑
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
    let role = null, code = null;

    ws.on('message', (data) => {
        try {
            const msgStr = data.toString().trim();

            if (role === null) {
                if (!msgStr.includes(':')) return;
                const parts = msgStr.split(':');
                role = parts[0].toUpperCase();
                code = parts[1].trim();

                if (!rooms[code]) rooms[code] = {};
                if (rooms[code][role]) { try { rooms[code][role].close(); } catch(e) {} }
                rooms[code][role] = ws;

                const peerRole = (role === 'HOST' ? 'AGENT' : 'HOST');
                const peer = rooms[code][peerRole];
                if (peer && peer.readyState === WebSocket.OPEN) {
                    ws.send('READY');
                    peer.send('READY');
                }
                return;
            }

            if (msgStr === 'PING') { ws.send('PONG'); return; }
            if (msgStr === 'GET_INFO') {
                const agent = rooms[code] && rooms[code]['AGENT'];
                if (agent && agent.readyState === WebSocket.OPEN) agent.send('GET_INFO');
                return;
            }

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

// 4. 端口适配 (Render 自动分配)
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Relay r196-Final Live on ${PORT}`);
});
