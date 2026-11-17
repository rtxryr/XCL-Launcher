/**
 * Terracotta（陶瓦）P2P 联机 —— 免公网 IP 的 Minecraft 虚拟局域网。
 *
 * 参考 VersePC（GPL-3.0）server/terracotta.js 的实现思路：
 *  - 驱动开源外部二进制 Terracotta（Rust 编写的 MC 联机工具），本机不实现打洞协议；
 *  - 二进制以 `--hmcl <portFilePath>` 启动，它自己在本机 **127.0.0.1** 上开一个控制端口，
 *    并把端口号（JSON）写进该文件；之后用 `http://127.0.0.1:<port>` 驱动它；
 *  - 公共节点（etnode / terracotta.glavo.site）只是【远程】信令 + 打洞跳板，
 *    本机不监听任何对外服务（呼应「服务器不要设在本机」）；
 *  - Terracotta 提供的是「虚拟局域网」（虚拟网卡 + 打洞），而**不是字节流隧道**：
 *    主机侧无需把 Tunnel 桥到游戏端口（游戏自己监听 LAN 端口并广播），
 *    客体侧直接在游戏里连接 `state.url` 给出的虚拟地址即可。
 *
 * 因此本模块的 `join()` 返回的 Tunnel 只是「说明性」对象（info.addr 带虚拟地址），
 * `write()` 会抛错提示用户去游戏内直连 —— 不会伪装成真实的字节隧道。
 */
import { Logger } from "../core/logger";
import { HostHandle, HostOptions, JoinOptions, Transport, Tunnel } from "./transport";
/** 默认 Terracotta 版本（与 VersePC 对齐）。 */
export declare const DEFAULT_VERSION = "0.4.0";
/** 公共节点列表（远程），GET 返回 `[{ url, region? }]`。 */
export declare const NODE_LIST_URL = "https://terracotta.glavo.site/nodes";
/** 节点列表不可用时的兜底公共节点（仍然是远程端点）。 */
export declare const DEFAULT_NODES: string[];
/** 房间码字符集：去掉易混的 I / O / 0 / 1，共 32 个字符（256 % 32 === 0，取模无偏）。 */
export declare const ROOM_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 当前平台的 Terracotta 包架构名。 */
export declare function detectArch(platform?: string, arch?: string): string;
/** 按顺序尝试的多源下载地址（国内镜像优先，官方 GitHub 兜底）。 */
export declare function downloadSources(version: string, arch: string): string[];
/**
 * 生成 6 位房间码（本地预生成 / 测试用；实际房间码由 Terracotta 返回）。
 * 字符集 32 个字符，`byte & 31` 均匀映射，无取模偏差。
 */
export declare function generateRoomCode(): string;
/**
 * 归一化房间码：去空格 / 去横线 / 转大写。
 * 长度不在 4~8 或含非法字符时返回空串（上层据此判定输入非法）。
 */
export declare function normalizeRoomCode(input: string): string;
/**
 * 从节点列表里挑选可用的公共节点 URL。
 * @param list 节点列表（`{ url, region? }`）
 * @param zh 是否中文环境（中文环境只保留 `region === "CN"` 的节点）
 */
export declare function pickNodes(list: Array<{
    url: string;
    region?: string;
}>, zh: boolean): string[];
/** 当前是否为中文（简体）环境：时区上海/重庆，或语言以 zh 开头。 */
export declare function isZhLocale(): boolean;
/**
 * 解析 Terracotta `/state` 的返回体（纯函数）。
 *
 * 典型形态：
 *  - 主机成功：`{ state: "host-ok", room: "ABCDEF" | { code: "ABCDEF" } }`
 *  - 客体成功：`{ state: "guest-ok", url: "10.1.2.3:25565" }`
 *  - 异常：    `{ state: "exception", type: "no-such-room" }`
 */
export declare function parseStatePayload(json: unknown): Partial<TerracottaState>;
export interface TerracottaState {
    running: boolean;
    mode: "host" | "guest" | null;
    roomCode: string;
    /** Terracotta 返回的虚拟地址 `host:port`（guest 模式有意义） */
    virtualIP: string;
    /** 从 virtualIP 解析出的游戏端口，默认 25565 */
    guestPort: number;
    gamePort: number;
    /** 原始 state 字段：host-scanning / host-ok / guest-ok / exception ... */
    state: string | null;
    profiles: unknown[];
    difficulty: string | null;
    errorType: string | null;
    errorMessage: string | null;
}
/**
 * 主机句柄。
 *
 * `connectionInfo` 是**实时 getter**：`host()` 通常已经等到 `host-ok`，因此返回时即可用；
 * 若极端情况下还未拿到房间码，getter 返回空串，可 `await whenReady()` 等待补齐。
 */
export declare class TerracottaHostHandle implements HostHandle {
    private readonly getRoom;
    private readonly ready;
    private readonly onClose;
    private readonly log;
    constructor(getRoom: () => string, ready: Promise<string>, onClose: () => void, log: Logger);
    /** 房间码（可直接分享给朋友）。 */
    get connectionInfo(): string;
    /** 等待房间码就绪（已就绪时立即返回）。 */
    whenReady(): Promise<string>;
    /**
     * Terracotta 主机侧无需 Tunnel 回调：游戏自己监听 LAN 端口，
     * 虚拟网卡把对端流量直接送到本机，不存在「对端建链」事件。
     */
    onTunnel(_cb: (t: Tunnel) => void): void;
    /** 关闭房间（等价于 stop()）。 */
    close(): void;
}
export interface TerracottaOptions {
    /** 二进制存放目录，默认 `<home>/.fusionmc/terracotta` */
    binDir?: string;
    /** Terracotta 版本，默认 0.4.0 */
    version?: string;
    log?: Logger;
    /** 控制 API 超时（默认 10s） */
    timeoutMs?: number;
}
export declare class TerracottaTransport implements Transport {
    readonly id = "terracotta";
    readonly name = "Terracotta P2P\uFF08\u514D\u516C\u7F51 IP\uFF09";
    readonly remoteServer = "https://terracotta.glavo.site/nodes";
    private readonly log;
    private readonly binDir;
    private readonly version;
    private readonly timeoutMs;
    private proc;
    private binPath;
    private httpPort;
    private workDir;
    private portFile;
    private logPath;
    private logBytes;
    private nodesCache;
    private savedMode;
    private restoreCount;
    private restoreTimer;
    private stopping;
    private st;
    constructor(opts?: TerracottaOptions);
    /** 二进制是否已就绪。 */
    isInstalled(): boolean;
    /** 当前状态快照。 */
    state(): TerracottaState;
    private isRunning;
    private findInstalledBinary;
    /**
     * 下载并解包 Terracotta 二进制（多源顺序尝试）。
     * 成功判定：HTTP 2xx 且响应体 > 10000 字节。
     * @returns 可执行文件的绝对路径
     */
    download(onProgress?: (p: {
        received: number;
        total: number;
    }) => void): Promise<string>;
    /** tar -xzf 解包（30s 超时）。 */
    private extract;
    /** Windows：把 exe 和同目录的 .dll 一起搬到 binDir 根，保证路径稳定。 */
    private collectWindowsDeps;
    /** 拉取公共节点（1 小时缓存，失败回退 DEFAULT_NODES）。 */
    fetchNodes(): Promise<string[]>;
    /**
     * 确保有一个可用的 Terracotta 进程。
     * 1) 已有进程且连续 3 次 `GET /state` 成功 → 复用；
     * 2) 否则清理僵尸进程后重新拉起。
     */
    private ensureStarted;
    /** 干掉历史遗留的 terracotta 进程（避免端口/房间冲突）。 */
    private killZombies;
    /** 轮询端口文件，直到 Terracotta 写入可用的控制端口。 */
    private waitPortFile;
    /** 进程退出：异常退出且已保存模式时，2s 后自动恢复（最多 3 次）。 */
    private onClose;
    /** 按保存的模式重放（主机重新开房 / 客体重新加入）。 */
    private restore;
    /** 结束进程并清理临时目录。 */
    private kill;
    /** 追加日志到临时日志文件（超过 LOG_ROTATE 轮转）。 */
    private appendLog;
    /**
     * GET 控制接口（默认重试 5 次，退避 min(200 * 1.5^n, 2000)）。
     * 空 body 视为成功（Terracotta 的 `/state/scanning` 等接口返回 200 空体）。
     */
    private apiGet;
    /** 轮询 `/state`，直到满足条件（或异常 / 超时）。 */
    private waitState;
    /** 主机：请求扫描公共节点并等待 host-ok。 */
    private beginHost;
    /** 客体：请求加入房间并等待 guest-ok。 */
    private beginGuest;
    /**
     * 开房间。
     *
     * Terracotta 是虚拟局域网：主机侧只要把游戏「开放到 LAN」，虚拟网卡会把对端的
     * 游戏流量直接递到本机 LAN 端口，无需 GameBridge。
     */
    host(opts: HostOptions): Promise<HostHandle>;
    /** 等待房间码（正常情况 host() 返回时已就绪，这里只是兜底）。 */
    private waitRoomCode;
    /**
     * 加入房间。
     *
     * 注意：Terracotta 提供的是虚拟网卡而非字节流，因此这里返回的 Tunnel 只是
     * 「说明性」对象 —— `info.addr` 为虚拟地址，`write()` 会抛错提示
     * 「请直接在游戏内连接 {addr}」。上层不应把它接到 GameBridge 上。
     */
    join(opts: JoinOptions): Promise<Tunnel>;
    /** 停止：杀掉进程、清理临时目录、重置状态。 */
    stop(): Promise<void>;
}
//# sourceMappingURL=terracotta.d.ts.map