"use strict";
/**
 * 联机传输抽象层 —— 整合「所有联机方式」的统一接口。
 *
 * 设计要点（呼应「服务器不要设在本机」）：
 *  - 每种联机方式都是一个 Transport，负责在「两台机器」间建一条双向字节通道（Tunnel）。
 *  - 需要协调的「信令 / 中继 / 房间」服务器一律是【远程端点】（可配置 URL），
 *    本机不驻留任何常驻服务；LAN/直连/端口映射是点对点，更无服务器。
 *  - GameBridge 把 Tunnel 与本机 Minecraft 游戏端口做 TCP 桥接（虚拟局域网语义）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TcpTunnel = exports.GameBridge = void 0;
exports.transportError = transportError;
const events_1 = require("events");
const net_1 = require("net");
const errors_1 = require("../core/errors");
/**
 * 把 Tunnel 与本机 TCP 做双向桥接。
 * host 侧：Tunnel <-> 127.0.0.1:gamePort
 * join 侧：本地监听端口 <-> Tunnel（MC 客户端连本地端口）
 */
class GameBridge {
    server = null;
    /** host：把 Tunnel 桥到本机游戏端口。 */
    bridgeTunnelToGame(tunnel, gamePort) {
        const sock = (0, net_1.createConnection)({ host: "127.0.0.1", port: gamePort });
        tunnel.on("data", (chunk) => {
            if (!sock.destroyed)
                sock.write(chunk);
        });
        sock.on("data", (chunk) => tunnel.write(chunk));
        const teardown = () => {
            if (!sock.destroyed)
                sock.destroy();
            tunnel.close();
        };
        sock.on("close", teardown);
        sock.on("error", teardown);
        tunnel.on("close", () => sock.destroy());
        return sock;
    }
    /** join：在本地开一个端口，把进来的 TCP 桥到 Tunnel（MC 客户端连它）。 */
    bridgeLocalPortToTunnel(tunnel, localPort = 0) {
        return new Promise((resolve, reject) => {
            const server = (0, net_1.createServer)((client) => {
                client.on("data", (chunk) => tunnel.write(chunk));
                tunnel.on("data", (chunk) => {
                    if (!client.destroyed)
                        client.write(chunk);
                });
                client.on("close", () => tunnel.close());
                client.on("error", () => tunnel.close());
                tunnel.on("close", () => client.destroy());
            });
            this.server = server;
            server.on("error", reject);
            server.listen(localPort, "127.0.0.1", () => {
                const addr = server.address();
                resolve(typeof addr === "object" && addr ? addr.port : localPort);
            });
        });
    }
    close() {
        this.server?.close();
        this.server = null;
    }
}
exports.GameBridge = GameBridge;
/** 简单的内存/Socket Tunnel 适配（TCP 场景）。 */
class TcpTunnel extends events_1.EventEmitter {
    sock;
    info;
    constructor(sock, info) {
        super();
        this.sock = sock;
        this.info = info;
        sock.on("data", (chunk) => this.emit("data", chunk));
        sock.on("close", () => this.emit("close"));
        sock.on("error", (e) => this.emit("error", e));
    }
    write(chunk) {
        if (!this.sock.destroyed)
            this.sock.write(chunk);
    }
    close() {
        this.sock.destroy();
        this.emit("close");
    }
}
exports.TcpTunnel = TcpTunnel;
function transportError(msg, cause) {
    return new errors_1.FusionError("MULTIPLAYER", msg, { cause });
}
//# sourceMappingURL=transport.js.map