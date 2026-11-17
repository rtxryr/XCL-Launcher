"use strict";
/**
 * 直连（Direct）联机：按 IP:port 直接 TCP 连到宿主游戏端口。
 * 无发现、无服务器——纯客户端连出。常配合端口映射（nat.ts）让外网可直连。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectTransport = void 0;
exports.loopbackTunnelPair = loopbackTunnelPair;
const events_1 = require("events");
const transport_1 = require("./transport");
const lan_1 = require("./lan");
class DirectTransport {
    id = "direct";
    name = "直连";
    remoteServer = undefined;
    async host(opts) {
        // 直连场景：宿主游戏端口已在监听（游戏本身），这里只给出可分享地址。
        // 外网直连需先用 nat.ts 做端口映射；此处返回内网地址作为兜底。
        const addr = (0, lan_1.localLanAddress)();
        const endpoint = `${addr}:${opts.gamePort}`;
        return {
            connectionInfo: endpoint,
            onTunnel: () => {
                /* 直连由游戏端口接受，无需本地桥接 */
            },
            close: () => { },
        };
    }
    async join(opts) {
        const [host, portStr] = (0, lan_1.splitEndpoint)(opts.connectionInfo);
        const port = parseInt(portStr, 10);
        if (!host || !port)
            throw (0, transport_1.transportError)(`无效直连地址: ${opts.connectionInfo}`);
        return (0, lan_1.connectTcp)(host, port, "direct");
    }
}
exports.DirectTransport = DirectTransport;
/**
 * 极简隧道（Relay/WebRTC 兜底用）：内存对，测试与本地演示用。
 * 生产用 WebRTC/Relay；这里只作抽象的最小可跑实现。
 */
function loopbackTunnelPair() {
    // 用内存事件实现两个互联 Tunnel（测试/本地演示用）
    class MemTunnel extends events_1.EventEmitter {
        peer = null;
        info;
        constructor(info) {
            super();
            this.info = info;
        }
        write(chunk) {
            this.peer?.emit("data", chunk);
        }
        close() {
            this.emit("close");
        }
    }
    const a = new MemTunnel({ id: "a", name: "a", addr: "mem", via: "loopback" });
    const b = new MemTunnel({ id: "b", name: "b", addr: "mem", via: "loopback" });
    a.peer = b;
    b.peer = a;
    return [a, b];
}
//# sourceMappingURL=direct.js.map