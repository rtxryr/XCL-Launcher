/**
 * 红石联机（Redstone Online）—— 远程中继隧道传输，免公网 IP 联机。
 *
 * 协议参考 VersePC（GPL-3.0）main/redstone-online.js。
 *
 * 结构：「HTTP 控制面 + TCP 数据面」的中继方案。
 *   - 控制面：HTTP(:3000) 申请 apikey / 创建隧道 / 查询隧道列表。
 *   - 数据面：TCP(:7000) 一条长连接承载某个隧道的全部玩家字节流。
 *
 * ⚠️ 本模块只是【远程节点的客户端】：
 *   - 房间注册、隧道分配、玩家流量中继全部发生在远程红石节点（HTTP 3000 / TCP 7000）；
 *   - 本机不监听任何对公网可达的端口。join 侧仅在 127.0.0.1 开一个随机端口给
 *     本机 Minecraft 客户端连（虚拟局域网的必要本地转发，外部不可达）；
 *   - host 侧不开任何监听端口，只是连出到节点。
 */
import { EventEmitter } from "events";
import { Socket } from "net";
import { Logger } from "../core/logger";
import { HostHandle, HostOptions, JoinOptions, PeerInfo, Transport, Tunnel } from "./transport";
/** 控制面 HTTP 端口（远端节点）。 */
export declare const HTTP_PORT = 3000;
/** 数据面 TCP 端口（远端节点）。 */
export declare const TCP_PORT = 7000;
/** apikey 字符集。 */
export declare const APIKEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** 游戏端口未连上时最多缓存的待写批次。 */
export declare const MAX_PENDING = 8;
/** 节点注册表（返回 { "上海": "122.51.108.96", ... }）。 */
export declare const DEFAULT_REGISTRY_URL = "https://shithub.site/server.json";
/** 注册表不可用时的兜底节点。 */
export declare const DEFAULT_NODES: RedstoneNode[];
export interface RedstoneNode {
    name: string;
    address: string;
}
export interface RedstoneOptions {
    /** 手动指定节点；不给则从 registry 拉取 */
    nodes?: RedstoneNode[];
    /** 节点注册表地址 */
    registryUrl?: string;
    /** 房间名（≤8 字） */
    title?: string;
    /** 房间描述（≤100 字） */
    description?: string;
    /** 是否公开到大厅（默认 true） */
    publicAccess?: boolean;
    /** 是否允许离线（默认 true → online:false） */
    allowOffline?: boolean;
    log?: Logger;
    /** apikey 持久化路径（可选） */
    apikeyFile?: string;
}
/**
 * 生成 apikey：默认 20 位，字符集 [A-Za-z0-9]。
 * 使用 crypto 随机字节 + 拒绝采样，避免 Math.random 的弱随机与取模偏差。
 */
export declare function makeApikey(len?: number): string;
/**
 * 从字节流里切出【首行】（0x0A 结尾），返回行文本与剩余字节。
 *
 * 注意：必须全程按字节操作。Minecraft 协议载荷含 0x80-0xFF，
 * 一旦 `.toString("utf8")` 再转回 Buffer 就会把非法序列替换成 U+FFFD，
 * 破坏玩家二进制数据。所以剩余部分直接 `subarray` 原样返回（零拷贝）。
 */
export declare function parseControlLine(buf: Buffer): {
    line: string;
    rest: Buffer;
} | null;
/** 是否是 HTTP 探测包（节点/中间设备偶尔会用 HTTP 探活，必须丢弃，不能转给游戏）。 */
export declare function isHttpProbe(buf: Buffer): boolean;
/**
 * 是否是一个 Minecraft 握手包（Handshake，packetId=0x00）。
 * 用于识别「新玩家进来」，此时要强制重建 gameSocket，否则会把新玩家的
 * 握手字节发给上一个玩家残留的连接。
 *
 * 判定条件（对齐 VersePC）：
 *   包长 ∈ [0x10, 0x20]、packetId === 0x00、协议号为双字节 varint、
 *   协议号 ∈ [393, 800]、服务器地址长度 ∈ [5, 30]。
 */
export declare function isMinecraftHandshake(buf: Buffer): boolean;
interface RoomOptions {
    apikey: string;
    publicAccess: boolean;
    title: string;
    description: string;
    allowOffline: boolean;
}
/** 大厅列表：先 offset，再退到 from，最后带 Authorization 重试。 */
export declare function listTunnelsOn(node: RedstoneNode, offset?: number, apikey?: string): Promise<{
    tunnels: unknown[];
    serverAddress: string;
}>;
/** 查隧道模组列表；404 视为「没有模组」。 */
export declare function getTunnelMods(node: RedstoneNode, id: string): Promise<unknown[]>;
export declare function closeTunnel(node: RedstoneNode, apikey: string, log?: Logger): Promise<boolean>;
/**
 * join 侧的 Tunnel：在 127.0.0.1 上开一个随机端口给本机 MC 客户端连，
 * 每个进来的连接各自 `net.connect(远端 host:port)` 做双向转发。
 *
 * 之所以可以在本机监听：它只绑 127.0.0.1，外部不可达，等价于「虚拟网卡」。
 */
export declare class RedstoneJoinTunnel extends EventEmitter implements Tunnel {
    private readonly target;
    private readonly log;
    /** 本机接入端口（游戏客户端连这个）。 */
    localPort: number;
    readonly info: PeerInfo;
    private server;
    private readonly clients;
    private readonly remotes;
    private closed;
    constructor(target: {
        host: string;
        port: number;
    }, name: string, log: Logger);
    /** 开始监听本机接入端口。 */
    listen(): Promise<number>;
    private handleClient;
    write(chunk: Buffer): void;
    close(): void;
}
/** 带告警回调的 HostHandle（HostHandle 接口之外的扩展能力）。 */
export declare class RedstoneHostHandle implements HostHandle {
    readonly node: RedstoneNode;
    readonly listenPort: number | undefined;
    private readonly session;
    readonly connectionInfo: string;
    private readonly tunnelCbs;
    private readonly warnCbs;
    private readonly seen;
    private closed;
    constructor(node: RedstoneNode, listenPort: number | undefined, session: HostSession);
    onTunnel(cb: (t: Tunnel) => void): void;
    /** 监听运行期告警（如「游戏局域网可能已关闭」）。 */
    onWarning(cb: (msg: string) => void): void;
    close(): void;
    /** @internal */
    _add(t: Tunnel): void;
    /** @internal */
    _warn(msg: string): void;
}
interface HostSessionConfig {
    node: RedstoneNode;
    room: RoomOptions;
    gamePort: number;
    listenPort?: number;
    log: Logger;
    onClosed: () => void;
}
/**
 * 一次开房会话：控制连接即数据通道，负责
 *   中继 → 游戏端口、懒连接、HTTP 探测过滤、新玩家握手重建、
 *   控制连接健康检查/指数退避重连、游戏端口健康检查。
 */
export declare class HostSession {
    private readonly cfg;
    readonly handle: RedstoneHostHandle;
    private control;
    private tunnel;
    private gameSocket;
    private gameReady;
    private pending;
    private closed;
    private reconnectAttempts;
    private gameProbeFailures;
    private gotGameData;
    private controlTimer;
    private gameTimer;
    private lanTimer;
    private reconnectTimer;
    constructor(cfg: HostSessionConfig);
    get listenPort(): number | undefined;
    get attempts(): number;
    get running(): boolean;
    /** 用已握手的控制 socket 启动会话。 */
    start(firstSocket: Socket): void;
    private attach;
    private scheduleReconnect;
    private reconnect;
    private onPlayerData;
    private enqueue;
    /** 懒连接：只在真的有玩家数据时才去连本机游戏端口。 */
    private connectGame;
    private resetGameSocket;
    private flushGame;
    /**
     * 写一批数据到游戏端口；失败时重建连接并在 300ms 后重试（最多 3 次）。
     * 数据先回填队列，重连成功后由 flushGame 自然送出。
     */
    private writeChunk;
    private startLanWatch;
    private clearLanWatch;
    private probeGameLoop;
    close(): void;
}
export declare class RedstoneTransport implements Transport {
    readonly id = "redstone";
    readonly name = "\u7EA2\u77F3\u8054\u673A\uFF08\u8FDC\u7A0B\u4E2D\u7EE7\uFF09";
    private readonly opts;
    private readonly log;
    private apikey;
    private nodesCache;
    private session;
    private node;
    private room;
    constructor(opts?: RedstoneOptions);
    /**
     * 依赖的远程端点：开房后是当前节点地址；未开房时给出节点注册表，
     * 便于 UI 明确「这套联机依赖远程节点，而非本机服务」。
     */
    get remoteServer(): string | undefined;
    fetchNodes(): Promise<RedstoneNode[]>;
    listTunnels(offset?: number): Promise<{
        tunnels: unknown[];
        serverAddress: string;
    }>;
    getTunnelMods(id: string): Promise<unknown[]>;
    closeTunnel(): Promise<boolean>;
    status(): {
        running: boolean;
        address?: string;
        listenPort?: number;
        reconnectAttempts: number;
    };
    host(opts: HostOptions): Promise<HostHandle>;
    private buildRoom;
    private hostOnNode;
    /**
     * 加入：connectionInfo 形如 `host:port`（host 是红石节点地址，port 是该隧道端口）。
     * 在 127.0.0.1 开一个随机端口供本机 MC 客户端连接，字节双向转发到远端。
     */
    join(opts: JoinOptions): Promise<Tunnel>;
    stop(): Promise<void>;
    private ensureApikey;
}
export {};
//# sourceMappingURL=redstone.d.ts.map