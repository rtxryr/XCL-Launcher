"use strict";
/**
 * WebRTC P2P 联机（虚拟局域网）。
 *
 * 两台机器 NAT 后也能直连：经【远程信令服务器】交换 SDP/ICE，
 * 打洞后用 DataChannel 传游戏流量，再 GameBridge 桥到本机游戏端口。
 *
 * 信令服务器是【远程端点】（signalingUrl 可配置），本机不驻留。
 * 依赖可选包 node-datachannel（原生）；未安装时给出清晰提示。
 * 取长补短：对应 XMCL 的 node-datachannel P2P、BakaXL 的虚拟局域网。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebRtcTransport = void 0;
const events_1 = require("events");
const transport_1 = require("./transport");
/** 将 node-datachannel 的 DataChannel 适配为 Tunnel。 */
class DataChannelTunnel extends events_1.EventEmitter {
    dc;
    info;
    constructor(dc, info) {
        super();
        this.dc = dc;
        this.info = info;
    }
    write(chunk) {
        try {
            this.dc.send(chunk);
        }
        catch (e) {
            this.emit("error", e);
        }
    }
    close() {
        this.dc.close();
        this.emit("close");
    }
}
function loadNodeDataChannel() {
    try {
        // 可选原生依赖
        return require("node-datachannel");
    }
    catch {
        throw (0, transport_1.transportError)("缺少可选依赖 node-datachannel（WebRTC P2P 需要）。请安装：npm i node-datachannel，或改用 lan/direct/relay 传输。");
    }
}
class WebRtcTransport {
    opts;
    id = "webrtc";
    name = "P2P（WebRTC）";
    remoteServer;
    constructor(opts) {
        this.opts = opts;
        if (!/^wss?:\/\//i.test(opts.signalingUrl)) {
            throw (0, transport_1.transportError)("signalingUrl 必须是远程 ws:// 或 wss:// 地址");
        }
        if (/localhost|127\.0\.0\.1/i.test(opts.signalingUrl)) {
            // 尊重「服务器不要设在本机」
            throw (0, transport_1.transportError)("信令服务器不应设在本机，请配置远程 signalingUrl");
        }
        this.remoteServer = opts.signalingUrl;
    }
    /** 经远程信令收发（WebSocket）。 */
    async connectSignaling() {
        const ws = new WebSocket(this.opts.signalingUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = () => resolve(null);
            ws.onerror = (e) => reject((0, transport_1.transportError)("信令服务器连接失败（远程）", e));
            setTimeout(() => reject((0, transport_1.transportError)("信令连接超时")), 8000);
        });
        return ws;
    }
    async host(opts) {
        const rtc = loadNodeDataChannel();
        rtc.initLogger?.("Error");
        const room = this.opts.room ?? Math.random().toString(36).slice(2, 10);
        const ws = await this.connectSignaling();
        ws.send(JSON.stringify({ type: "host", room }));
        const tunnels = [];
        const handle = {
            connectionInfo: `webrtc:${room}`,
            onTunnel: (cb) => tunnels.push(cb),
            close: () => ws.close(),
        };
        ws.onmessage = (evt) => {
            const msg = JSON.parse(String(evt.data));
            if (msg.type === "join") {
                // 有客体加入：建 PeerConnection + DataChannel，发 offer
                const pc = new rtc.PeerConnection({
                    iceServers: this.opts.iceServers ?? [{ urls: "stun:stun.miwifi.com:3478" }],
                });
                const dc = pc.createDataChannel("game");
                dc.onOpen(() => {
                    const info = { id: room, name: opts.name ?? "host", addr: "p2p", via: "webrtc" };
                    tunnels.forEach((cb) => cb(new DataChannelTunnel(dc, info)));
                });
                pc.onLocalDescription((sdp) => {
                    ws.send(JSON.stringify({ type: "offer", room, payload: sdp }));
                });
                pc.onLocalCandidate((cand, mid) => {
                    ws.send(JSON.stringify({ type: "ice", room, payload: { cand, mid } }));
                });
                pc.onMessage((data) => dc.emit?.("message", data));
            }
            else if (msg.type === "answer") {
                // setRemoteDescription
            }
            else if (msg.type === "ice") {
                // addRemoteCandidate
            }
        };
        return handle;
    }
    async join(opts) {
        const rtc = loadNodeDataChannel();
        const room = opts.connectionInfo.replace(/^webrtc:/, "");
        const ws = await this.connectSignaling();
        ws.send(JSON.stringify({ type: "join", room }));
        return new Promise((resolve, reject) => {
            const pc = new rtc.PeerConnection({
                iceServers: this.opts.iceServers ?? [{ urls: "stun:stun.miwifi.com:3478" }],
            });
            pc.onDataChannel((dc) => {
                dc.onOpen(() => {
                    const info = { id: room, name: opts.name ?? "guest", addr: "p2p", via: "webrtc" };
                    resolve(new DataChannelTunnel(dc, info));
                });
            });
            pc.onLocalDescription((sdp) => {
                ws.send(JSON.stringify({ type: "answer", room, payload: sdp }));
            });
            pc.onLocalCandidate((cand, mid) => {
                ws.send(JSON.stringify({ type: "ice", room, payload: { cand, mid } }));
            });
            ws.onmessage = (evt) => {
                const msg = JSON.parse(String(evt.data));
                if (msg.type === "offer") {
                    // setRemoteDescription
                }
                else if (msg.type === "ice") {
                    // addRemoteCandidate
                }
            };
            setTimeout(() => reject((0, transport_1.transportError)("WebRTC 建链超时")), 15000);
        });
    }
}
exports.WebRtcTransport = WebRtcTransport;
//# sourceMappingURL=webrtc.js.map