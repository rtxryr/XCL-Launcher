"use strict";
/**
 * 联机管理器：统一编排「所有联机方式」。
 *
 * 覆盖：
 *  - 局域网（LAN）：UDP 发现 + 直连，点对点；
 *  - 直连（Direct）：IP:port，点对点；
 *  - 端口映射（UPnP/NAT-PMP）：让外网可直连（nat.ts）；
 *  - P2P（WebRTC）：经【远程信令】打洞，DataChannel 虚拟局域网；
 *  - 中继（Relay）：经【远程中继】转发，硬 NAT 兜底；
 *  - 红石联机（Redstone）：远程节点「HTTP 控制面 + TCP 数据面」中继，免公网 IP；
 *  - Terracotta：开源外部二进制的 P2P 虚拟局域网（房间码，免公网 IP）。
 *
 * 信令/中继/节点服务器都是远程端点，本机不驻留对外服务。
 * GameBridge 把字节流型 Tunnel 桥到本机游戏端口；Terracotta 是虚拟网卡语义，不桥接。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiplayerManager = void 0;
const transport_1 = require("./transport");
const lan_1 = require("./lan");
const direct_1 = require("./direct");
const webrtc_1 = require("./webrtc");
const relay_1 = require("./relay");
const redstone_1 = require("./redstone");
const terracotta_1 = require("./terracotta");
const nat_1 = require("./nat");
/** 需要 GameBridge 把 Tunnel 桥到游戏端口的传输（字节流语义）。 */
const BRIDGE_HOST = new Set(["webrtc", "relay"]);
/** join 侧需要本地监听端口再桥到 Tunnel 的传输。 */
const BRIDGE_JOIN = new Set(["webrtc", "relay", "redstone"]);
class MultiplayerManager {
    log;
    transports = new Map();
    constructor(log, cfg = {}) {
        this.log = log;
        this.register(new lan_1.LanTransport());
        this.register(new direct_1.DirectTransport());
        if (cfg.webrtcSignalingUrl) {
            this.register(new webrtc_1.WebRtcTransport({ signalingUrl: cfg.webrtcSignalingUrl }));
        }
        if (cfg.relayUrl) {
            this.register(new relay_1.RelayTransport({ relayUrl: cfg.relayUrl }));
        }
        if (cfg.enableRedstone !== false) {
            this.register(new redstone_1.RedstoneTransport({
                log: this.log.child("redstone"),
                nodes: cfg.redstoneNodes,
                registryUrl: cfg.redstoneRegistryUrl,
            }));
        }
        if (cfg.enableTerracotta !== false) {
            this.register(new terracotta_1.TerracottaTransport({ log: this.log.child("terracotta") }));
        }
    }
    register(t) {
        this.transports.set(t.id, t);
        this.log.debug(`注册联机传输: ${t.id} (${t.name})` + (t.remoteServer ? ` -> ${t.remoteServer}` : ""));
    }
    get(id) {
        const t = this.transports.get(id);
        if (!t)
            throw new Error(`未知联机方式: ${id}`);
        return t;
    }
    list() {
        return [...this.transports.values()].map((t) => ({
            id: t.id,
            name: t.name,
            remoteServer: t.remoteServer,
        }));
    }
    /** 局域网发现（便捷）。 */
    discover(timeoutMs = 3000) {
        return (0, lan_1.discoverLanGames)(timeoutMs);
    }
    /**
     * 开房间（宿主）。
     * @param opts.gamePort MC「开放到 LAN」的游戏端口
     * @param opts.tryPortMapping 是否尝试 UPnP/NAT-PMP 对外暴露
     */
    async host(transportId, opts) {
        const t = this.get(transportId);
        const handle = await t.host(opts);
        let bridge;
        let mapping = null;
        // WebRTC/Relay 产出字节流 Tunnel，需要桥接到游戏端口。
        // 红石联机内部已自建本地转发；Terracotta 是虚拟网卡，均不需要。
        if (BRIDGE_HOST.has(transportId)) {
            bridge = new transport_1.GameBridge();
            handle.onTunnel((tunnel) => {
                this.log.info(`对端经 ${transportId} 建链，桥接到游戏端口 ${opts.gamePort}`);
                bridge.bridgeTunnelToGame(tunnel, opts.gamePort);
            });
        }
        if (opts.tryPortMapping) {
            mapping = await (0, nat_1.openPort)("TCP", opts.gamePort);
            this.log.info(mapping
                ? `端口映射成功: ${mapping.method} 公网 ${mapping.publicIp ?? "?"}:${mapping.publicPort}`
                : "端口映射失败（回退局域网/中继）");
        }
        return { transport: transportId, handle, bridge, mapping };
    }
    /**
     * 加入（客体）。返回本机端口，MC 客户端连 127.0.0.1:localPort 即可。
     * 直连/LAN 时 localPort 直接是远端游戏端口，tunnel 已就绪。
     * Terracotta 是虚拟局域网：直接连 tunnel.info.addr（虚拟 IP:端口），不做桥接。
     */
    async join(transportId, opts) {
        const t = this.get(transportId);
        const tunnel = await t.join(opts);
        if (transportId === "lan" || transportId === "direct") {
            // 直连场景：tunnel 即到游戏，本地端口信息在 connectionInfo 里
            const port = parseInt(opts.connectionInfo.split(":").pop() ?? "0", 10);
            return { transport: transportId, tunnel, localPort: port };
        }
        if (transportId === "terracotta") {
            // 虚拟网卡：客户端在游戏内直连虚拟地址，无需本地端口桥接
            const addr = tunnel.info.addr;
            const port = parseInt(addr.split(":").pop() ?? "0", 10) || 25565;
            this.log.info(`Terracotta 虚拟局域网地址：${addr}（游戏内直接连接该地址）`);
            return { transport: transportId, tunnel, localPort: port };
        }
        // WebRTC/Relay/Redstone：开本地端口桥到 tunnel（虚拟局域网语义）
        const bridge = new transport_1.GameBridge();
        const localPort = await bridge.bridgeLocalPortToTunnel(tunnel, 0);
        this.log.info(`虚拟局域网就绪：MC 客户端连 127.0.0.1:${localPort}`);
        return { transport: transportId, tunnel, localPort, bridge };
    }
}
exports.MultiplayerManager = MultiplayerManager;
//# sourceMappingURL=index.js.map