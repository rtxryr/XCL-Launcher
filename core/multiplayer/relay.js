"use strict";
/**
 * 中继（Relay）联机 —— P2P 打洞失败时的兜底。
 * 经【远程中继服务器】转发两台机器的游戏流量（对应 BakaXL Network / 联机盒子思路）。
 *
 * 中继服务器是【远程端点】（relayUrl 可配置），本机不驻留。
 * 协议：WebSocket 连远程中继 → JSON 握手（host/join 房间）→ 双向转发二进制帧。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayTransport = void 0;
exports.encodeFrame = encodeFrame;
exports.decodeFrames = decodeFrames;
const events_1 = require("events");
const transport_1 = require("./transport");
/** 长度前缀帧编解码（TCP 中继 / 测试用）。 */
function encodeFrame(payload) {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(payload.length, 0);
    return Buffer.concat([head, payload]);
}
/** 从字节流里解出完整帧；返回帧与剩余字节。 */
function decodeFrames(buffer) {
    const frames = [];
    let off = 0;
    while (off + 4 <= buffer.length) {
        const len = buffer.readUInt32BE(off);
        if (off + 4 + len > buffer.length)
            break;
        frames.push(buffer.subarray(off + 4, off + 4 + len));
        off += 4 + len;
    }
    return { frames, rest: buffer.subarray(off) };
}
class RelayTunnel extends events_1.EventEmitter {
    ws;
    info;
    constructor(ws, info) {
        super();
        this.ws = ws;
        this.info = info;
        ws.onmessage = (evt) => {
            const data = evt.data;
            const buf = data instanceof ArrayBuffer
                ? Buffer.from(data)
                : Buffer.isBuffer(data)
                    ? data
                    : Buffer.from(String(data));
            this.emit("data", buf);
        };
        ws.onclose = () => this.emit("close");
        ws.onerror = (e) => this.emit("error", e);
    }
    write(chunk) {
        if (this.ws.readyState === WebSocket.OPEN)
            this.ws.send(chunk);
    }
    close() {
        this.ws.close();
        this.emit("close");
    }
}
class RelayTransport {
    opts;
    id = "relay";
    name = "中继";
    remoteServer;
    constructor(opts) {
        this.opts = opts;
        if (!/^wss?:\/\//i.test(opts.relayUrl)) {
            throw (0, transport_1.transportError)("relayUrl 必须是远程 ws:// 或 wss:// 地址");
        }
        if (/localhost|127\.0\.0\.1/i.test(opts.relayUrl)) {
            throw (0, transport_1.transportError)("中继服务器不应设在本机，请配置远程 relayUrl");
        }
        this.remoteServer = opts.relayUrl;
    }
    async connect() {
        const ws = new WebSocket(this.opts.relayUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = () => resolve(null);
            ws.onerror = (e) => reject((0, transport_1.transportError)("远程中继连接失败", e));
            setTimeout(() => reject((0, transport_1.transportError)("中继连接超时")), 8000);
        });
        return ws;
    }
    sendJson(ws, msg) {
        ws.send(JSON.stringify(msg));
    }
    async host(opts) {
        const room = Math.random().toString(36).slice(2, 10);
        const ws = await this.connect();
        this.sendJson(ws, { type: "host", room });
        const tunnels = [];
        let guestWs = null;
        ws.onmessage = (evt) => {
            const data = evt.data;
            // JSON 控制消息 vs 二进制转发
            if (typeof data === "string") {
                try {
                    const msg = JSON.parse(data);
                    if (msg.type === "ready") {
                        guestWs = ws; // 中继把 guest 流量从同一 ws 转来
                        const info = { id: room, name: opts.name ?? "host", addr: "relay", via: "relay" };
                        tunnels.forEach((cb) => cb(new RelayTunnel(ws, info)));
                    }
                    return;
                }
                catch {
                    /* 非 JSON，按数据处理 */
                }
            }
        };
        return {
            connectionInfo: `relay:${room}`,
            onTunnel: (cb) => tunnels.push(cb),
            close: () => ws.close(),
        };
    }
    async join(opts) {
        const room = opts.connectionInfo.replace(/^relay:/, "");
        const ws = await this.connect();
        this.sendJson(ws, { type: "join", room });
        return new Promise((resolve, reject) => {
            ws.onmessage = (evt) => {
                const data = evt.data;
                if (typeof data === "string") {
                    try {
                        const msg = JSON.parse(data);
                        if (msg.type === "ready" || msg.type === "accept") {
                            const info = { id: room, name: opts.name ?? "guest", addr: "relay", via: "relay" };
                            resolve(new RelayTunnel(ws, info));
                        }
                        else if (msg.type === "error") {
                            reject((0, transport_1.transportError)(msg.message ?? "中继错误"));
                        }
                        return;
                    }
                    catch {
                        /* fallthrough */
                    }
                }
            };
            setTimeout(() => reject((0, transport_1.transportError)("中继建链超时")), 12000);
        });
    }
}
exports.RelayTransport = RelayTransport;
//# sourceMappingURL=relay.js.map