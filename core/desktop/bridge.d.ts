/**
 * 桌面桥接层（DesktopBridge）—— 把 FusionBackend 的本地能力暴露给 Electron/Tauri 渲染进程。
 *
 * ⚠️ 桥接层【不监听任何端口】，仅做进程内 IPC 分发：
 *   - Electron：主进程 `ipcMain.handle("fmbridge:invoke", (_, ch, p) => bridge.handle(ch, p))`，
 *     渲染进程经 preload 暴露的 `window.FMBridge.invoke()` 调用；
 *   - Tauri：主进程把 `#[tauri::command]` 直接转给 `bridge.handle()`。
 * 也就是说，本文件只做「函数表 + 参数校验 + 错误文案本地化」，不新增任何网络面。
 *
 * 所有通道统一返回 `{ ok, data?, error? }`，绝不向上抛异常 —— 渲染进程永远拿得到结构化结果。
 */
import type { FusionBackend } from "../backend";
import { Logger } from "../core/logger";
import type { ServerEntry, ServerState } from "../server";
import type { SystemResourceSample } from "./resource-monitor";
/** 宿主（Electron 主进程 / Tauri 命令层）需要实现的最小接口。 */
export interface BridgeTransportLike {
    handle(channel: string, payload: unknown): Promise<unknown>;
}
export interface BridgeOptions {
    backend: FusionBackend;
    log?: Logger;
    /** 是否允许 server:remove 删除目录（默认 true） */
    allowRemove?: boolean;
}
/** 统一返回结构。 */
export interface BridgeResult {
    ok: boolean;
    data?: unknown;
    error?: string;
}
/** server:list 的每一项：ServerEntry + 运行时状态。 */
export interface ServerListItem extends ServerEntry {
    state: ServerState;
    pid?: number;
    startedAt?: number;
    message?: string;
}
/** 全部通道名（顺序即 `channels()` 的输出）。 */
export declare const BRIDGE_CHANNELS: readonly ["server:list", "server:create", "server:start", "server:stop", "server:status", "server:command", "server:remove", "redstone:nodes", "redstone:host", "redstone:join", "redstone:stop", "redstone:lobby", "terracotta:status", "terracotta:download", "terracotta:host", "terracotta:join", "terracotta:stop", "app:transports", "cli:exec", "account:list", "account:addOffline", "account:loginMicrosoft", "account:cancelLogin", "account:remove", "account:setActive", "account:active", "sys:resource"];
export type BridgeChannel = (typeof BRIDGE_CHANNELS)[number];
/** 把任意异常转成可展示的中文文案。 */
export declare function toFriendlyError(e: unknown): string;
export declare class DesktopBridge implements BridgeTransportLike {
    private readonly backend;
    private readonly log;
    private readonly allowRemove;
    /** 由宿主（Electron 主进程）设置，用于把下载进度转发给渲染进程 */
    private progressSink;
    /** 自己持有的两个联机传输实例（惰性：构造时不联网、不启进程） */
    private readonly redstone;
    private readonly terracotta;
    /** 内置终端的命令行执行器（与前端终端共享同一套命令语义） */
    private readonly cli;
    /** 账号服务（正版设备码登录 + 离线账号）；惰性 init，首次访问账号通道时载入 */
    private readonly accounts;
    private accountsReady;
    /** 系统剩余资源探测器；默认走 Node 的 os.totalmem/freemem，Electron 主进程可注入更精确实现 */
    private resourceProbe;
    private readonly handlers;
    constructor(opts: BridgeOptions);
    /** 统一入口：所有通道都从这里分发，返回 `{ ok, data?, error? }`，绝不抛异常。 */
    handle(channel: string, payload?: unknown): Promise<BridgeResult>;
    /** 把后端事件转成前端事件（返回取消函数）。 */
    attachEmitter(emit: (event: string, data: unknown) => void): () => void;
    /** 通道清单（用于诊断）。 */
    channels(): string[];
    /** 由宿主（Electron 主进程）设置，用于把下载进度转发给渲染进程。 */
    setProgressSink(sink: ((event: string, data: unknown) => void) | null): void;
    /** 由宿主（Electron 主进程）注入更精确的系统内存探测（如 process.getSystemMemoryInfo）。 */
    setResourceProbe(fn: () => SystemResourceSample): void;
    /** sys:resource：采样并判定当前系统剩余资源。 */
    private sysResource;
    /** 关闭桥接层持有的联机会话（应用退出时调用，避免残留进程）。 */
    dispose(): Promise<void>;
    private serverList;
    private serverCreate;
    private serverStart;
    private serverStop;
    private serverStatus;
    private serverCommand;
    private serverRemove;
    private redstoneNodes;
    private redstoneHost;
    private redstoneJoin;
    private redstoneStop;
    private redstoneLobby;
    private terracottaStatus;
    private terracottaDownload;
    private terracottaHost;
    private terracottaJoin;
    private terracottaStop;
    /** 内置终端：整行命令交给 CliCommands 解析执行，返回 { lines, mutated }。 */
    private cliExec;
    /** 账号数据的落盘目录：优先取后端 config.root，取不到退回 ~/.fusionmc。 */
    private accountDataDir;
    /** Microsoft OAuth client_id：优先读 config.runtime.msClientId，未配置则用内置默认。 */
    private accountClientId;
    /** 惰性载入账号存储；并发调用共享同一个 Promise，失败后允许重试。 */
    private ensureAccounts;
    /** 账号事件走与进度事件相同的出口（宿主注入的 emit），事件名原样透传。 */
    private emitHostEvent;
    private accountList;
    private accountAddOffline;
    private accountLoginMicrosoft;
    private accountCancelLogin;
    private accountRemove;
    private accountSetActive;
    private accountActive;
}
//# sourceMappingURL=bridge.d.ts.map