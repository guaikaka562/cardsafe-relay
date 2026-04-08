const http = require('http');
const WebSocket = require('ws');

// ★ 全局异常保护：防止服务器崩溃
process.on('uncaughtException', (err) => console.error('CRASH:', err));
process.on('unhandledRejection', (reason) => console.error('REJECT:', reason));

const rooms = {};
let totalApdus = 0;

// 1. 创建 HTTP 服务 (专为保活设计)
const httpServer = http.createServer((req, res) => {
    // 返回极简 JSON 响应，解决 "Output too large" 问题
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        status: 'ok', 
        service: 'r194-Stable',
        active: Object.keys(rooms).length 
    }));
});

// 2. 创建 WebSocket 服务 (中继核心)
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
    let role = null; // HOST 或 AGENT
    let code = null; // 房间号

    ws.on('message', (data) => {
        try {
            const msgStr = data.toString().trim();

            // 第一阶段：握手 (HOST:123 或 AGENT:123)
            if (role === null) {
                const sep = msgStr.indexOf(':');
                if (sep < 0) return;
                role = msgStr.slice(0, sep).toUpperCase();
                code = msgStr.slice(sep + 1).trim();

                if (!rooms[code]) rooms[code] = {};
                // 清理旧连接
                if (rooms[code][role]) {
                    try { rooms[code][role].close(); } catch(e) {}
                }
                rooms[code][role] = ws;

                const peerRole = (role === 'HOST' ? 'AGENT' : 'HOST');
                const peer = rooms[code][peerRole];
                if (peer && peer.readyState === WebSocket.OPEN) {
                    ws.send('READY');
                    peer.send('READY');
                }
                return;
            }

            // 第二阶段：保活与信息同步
            if (msgStr === 'PING') {
                ws.send('PONG');
                return;
            }
            if (msgStr === 'GET_INFO') {
                const agent = rooms[code] && rooms[code]['AGENT'];
                if (agent && agent.readyState === WebSocket.OPEN) {
                    agent.send('GET_INFO');
                }
                return;
            }

            // 第三阶段：数据中继 (APDU 二进制数据)
            const targetRole = (role === 'HOST' ? 'AGENT' : 'HOST');
            const target = rooms[code] && rooms[code][targetRole];
            if (target && target.readyState === WebSocket.OPEN) {
                target.send(data, { binary: Buffer.isBuffer(data) });
                if (role === 'HOST') totalApdus++;
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

// 3. 启动监听 (Render 会自动覆盖端口，这里设为 10000 保证兼容性)
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`CardSafe Relay r194-Stable Live on ${PORT}`);
});
