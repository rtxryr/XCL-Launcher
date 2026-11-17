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
import { Logger } from "../core/logger";
import { GameBridge, HostHandle, HostOptions, JoinOptions, Transport, Tunnel } from "./transport";
import { LanGame } from "./lan";
import { RedstoneNode } from "./redstone";
import { MappingResult } from "./nat";
export interface MultiplayerConfig {
    /** WebRTC 远程信令地址 */
    webrtcSignalingUrl?: string;
    /** 中继远程地址 */
    relayUrl?: string;
    /** 红石联机节点（可选；不给则用内置注册表） */
    redstoneNodes?: RedstoneNode[];
    /** 红石联机节点注册表 URL */
    redstoneRegistryUrl?: string;
    /** 是否启用红石联机（默认启用） */
    enableRedstone?: boolean;
    /** 是否启用 Terracotta（默认启用，首次开房按需下载二进制） */
    enableTerracotta?: boolean;
}
export interface HostedSession {
    transport: string;
    handle: HostHandle;
    /** 仅字节流型传输（WebRTC/Relay）需要的本机桥接 */
    bridge?: GameBridge;
    /** 端口映射结果（若做了） */
    mapping?: MappingResult | null;
}
export interface JoinedSession {
    transport: string;
    tunnel: Tunnel;
    /** 客户端应连接的本机端口（虚拟局域网）；直连/LAN 时为游戏端口 */
    localPort: number;
    bridge?: GameBridge;
}
export declare class MultiplayerManager {
    private log;
    private transports;
    constructor(log: Logger, cfg?: MultiplayerConfig);
    register(t: Transport): void;
    get(id: string): Transport;
    list(): Array<{
        id: string;
        name: string;
        remoteServer?: string;
    }>;
    /** 局域网发现（便捷）。 */
    discover(timeoutMs?: number): Promise<LanGame[]>;
    /**
     * 开房间（宿主）。
     * @param opts.gamePort MC「开放到 LAN」的游戏端口
     * @param opts.tryPortMapping 是否尝试 UPnP/NAT-PMP 对外暴露
     */
    host(transportId: string, opts: HostOptions & {
        tryPortMapping?: boolean;
    }): Promise<HostedSession>;
    /**
     * 加入（客体）。返回本机端口，MC 客户端连 127.0.0.1:localPort 即可。
     * 直连/LAN 时 localPort 直接是远端游戏端口，tunnel 已就绪。
     * Terracotta 是虚拟局域网：直接连 tunnel.info.addr（虚拟 IP:端口），不做桥接。
     */
    join(transportId: string, opts: JoinOptions): Promise<JoinedSession>;
}
//# sourceMappingURL=index.d.ts.map