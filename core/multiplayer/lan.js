"use strict";
/**
 * 局域网（LAN）联机。
 *
 * 两件事：
 *  1. 发现：监听 Minecraft「开放到 LAN」的 UDP 广播（默认 4445），
 *     解析 [MOTD]…[/MOTD][AD]端口[/AD]，得到同网段可加入的世界。
 *  2. 连接：本质是直连 TCP 到游戏端口（MC 客户端连宿主机）。
 *
 * 全程点对点，无任何常驻服务器。UDP socket 用完即关。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanTransport = void 0;
exports.parseLanMotd = parseLanMotd;
exports.buildLanMotd = buildLanMotd;
exports.discoverLanGames = discoverLanGames;
exports.broadcastLan = broadcastLan;
exports.localLanAddress = localLanAddress;
exports.connectTcp = connectTcp;
exports.splitEndpoint = splitEndpoint;
const dgram_1 = require("dgram");
const net_1 = require("net");
const os_1 = require("os");
const transport_1 = require("./transport");
const LAN_PORT = 4445;
/** 解析 MC LAN 广播载荷。 */
function parseLanMotd(payload) {
    const motd = /\[MOTD\]([\s\S]*?)\[\/MOTD\]/.exec(payload)?.[1] ?? "";
    const port = /\[AD\](\d+)\[\/AD\]/.exec(payload)?.[1];
    if (!port)
        return null;
    return { motd, port: parseInt(port, 10) };
}
/** 生成一条 MC LAN 广播载荷（供「开放到 LAN」广播用）。 */
function buildLanMotd(motd, port) {
    return `[MOTD]${motd}[/MOTD][AD]${port}[/AD]`;
}
/** 局域网内发现开放到 LAN 的世界。 */
function discoverLanGames(timeoutMs = 3000) {
    return new Promise((resolve) => {
        const found = new Map();
        let sock;
        try {
            sock = (0, dgram_1.createSocket)({ type: "udp4", reuseAddr: true });
        }
        catch (e) {
            resolve([]);
            return;
        }
        const done = () => {
            try {
                sock.close();
            }
            catch {
                /* noop */
            }
            resolve([...found.values()]);
        };
        sock.on("error", done);
        sock.on("message", (msg, rinfo) => {
            const parsed = parseLanMotd(msg.toString("utf-8"));
            if (!parsed)
                return;
            const endpoint = `${rinfo.address}:${parsed.port}`;
            if (!found.has(endpoint)) {
                found.set(endpoint, {
                    addr: rinfo.address,
                    port: parsed.port,
                    motd: parsed.motd,
                    endpoint,
                });
            }
        });
        sock.bind(LAN_PORT, () => {
            try {
                sock.setBroadcast(true);
            }
            catch {
                /* 某些环境无广播权限，仍可收单播 */
            }
        });
        setTimeout(done, timeoutMs);
    });
}
/** 广播一条「开放到 LAN」通告（宿主用）。 */
function broadcastLan(motd, gamePort, times = 3) {
    const payload = buildLanMotd(motd, gamePort);
    const sock = (0, dgram_1.createSocket)("udp4");
    sock.bind(() => {
        try {
            sock.setBroadcast(true);
        }
        catch {
            /* ignore */
        }
        let sent = 0;
        const send = () => {
            sock.send(payload, LAN_PORT, "255.255.255.255", () => {
                if (++sent < times)
                    setTimeout(send, 500);
                else
                    sock.close();
            });
        };
        send();
    });
}
/** 本机局域网 IP（用于拼直连地址）。 */
function localLanAddress() {
    const nets = (0, os_1.networkInterfaces)();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] ?? []) {
            if (net.family === "IPv4" && !net.internal)
                return net.address;
        }
    }
    return "127.0.0.1";
}
/**
 * LAN 传输：发现 + 直连。
 * host 侧不开常驻服务——MC「开放到 LAN」本身就是游戏在监听；
 * 这里仅负责通告与返回可分享的直连地址。
 */
class LanTransport {
    id = "lan";
    name = "局域网";
    remoteServer = undefined; // 点对点，无远程服务器
    async host(opts) {
        const addr = localLanAddress();
        const endpoint = `${addr}:${opts.gamePort}`;
        // 周期性广播通告，便于同网段发现
        const timer = setInterval(() => broadcastLan(opts.name ?? "X Craft Launcher 世界", opts.gamePort, 1), 2000);
        broadcastLan(opts.name ?? "X Craft Launcher 世界", opts.gamePort);
        return {
            connectionInfo: endpoint,
            onTunnel: () => {
                /* LAN 由游戏端口直接接受连接，无需本地桥接 */
            },
            close: () => clearInterval(timer),
        };
    }
    async join(opts) {
        // connectionInfo = "ip:port"，直连游戏端口
        const [host, portStr] = splitEndpoint(opts.connectionInfo);
        const port = parseInt(portStr, 10);
        if (!host || !port)
            throw (0, transport_1.transportError)(`无效 LAN 连接信息: ${opts.connectionInfo}`);
        return connectTcp(host, port, "lan");
    }
}
exports.LanTransport = LanTransport;
/** 供 direct/lan 共用的 TCP 直连。 */
function connectTcp(host, port, via, name = "peer") {
    return new Promise((resolve, reject) => {
        const sock = (0, net_1.createConnection)({ host, port });
        const info = { id: `${host}:${port}`, name, addr: `${host}:${port}`, via };
        sock.once("connect", () => resolve(new transport_1.TcpTunnel(sock, info)));
        sock.once("error", (e) => reject((0, transport_1.transportError)(`连接失败 ${host}:${port}`, e)));
    });
}
function splitEndpoint(ep) {
    const idx = ep.lastIndexOf(":");
    if (idx < 0)
        return [ep, ""];
    return [ep.slice(0, idx), ep.slice(idx + 1)];
}
//# sourceMappingURL=lan.js.map