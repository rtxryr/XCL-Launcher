"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopBridge = exports.BRIDGE_CHANNELS = void 0;
exports.toFriendlyError = toFriendlyError;
const redstone_1 = require("../multiplayer/redstone");
const terracotta_1 = require("../multiplayer/terracotta");
const cli_commands_1 = require("./cli-commands");
const account_service_1 = require("./account-service");
const os_1 = require("os");
const path_1 = require("path");
const resource_monitor_1 = require("./resource-monitor");
/** 全部通道名（顺序即 `channels()` 的输出）。 */
exports.BRIDGE_CHANNELS = [
    "server:list",
    "server:create",
    "server:start",
    "server:stop",
    "server:status",
    "server:command",
    "server:remove",
    "redstone:nodes",
    "redstone:host",
    "redstone:join",
    "redstone:stop",
    "redstone:lobby",
    "terracotta:status",
    "terracotta:download",
    "terracotta:host",
    "terracotta:join",
    "terracotta:stop",
    "app:transports",
    "cli:exec",
    "account:list",
    "account:addOffline",
    "account:loginMicrosoft",
    "account:cancelLogin",
    "account:remove",
    "account:setActive",
    "account:active",
    "sys:resource",
];
/** 后端事件名（原样转发给渲染进程）。 */
const FORWARDED_EVENTS = [
    "progress",
    "log",
    "gameOutput",
    "gameExit",
    "peer",
    "peerStatus",
    "server:log",
    "server:status",
];
// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------
/** 参数校验失败（与业务异常区分，文案可直接展示）。 */
class BridgeValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "BridgeValidationError";
    }
}
/** 把未知载荷安全地收窄成对象。 */
function asRecord(payload) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return payload;
    }
    return {};
}
function requireString(obj, key, label) {
    const v = obj[key];
    if (typeof v !== "string" || v.trim() === "") {
        throw new BridgeValidationError(`参数 ${key} 不能为空（${label}）`);
    }
    return v.trim();
}
function optionalString(obj, key) {
    const v = obj[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
function requireInt(obj, key, label, min, max) {
    const v = obj[key];
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
        throw new BridgeValidationError(`参数 ${key} 必须是整数（${label}）`);
    }
    if (v < min || v > max) {
        throw new BridgeValidationError(`参数 ${key} 超出范围 ${min}-${max}（${label}）`);
    }
    return v;
}
function optionalInt(obj, key, label, min, max) {
    if (obj[key] === undefined || obj[key] === null)
        return undefined;
    return requireInt(obj, key, label, min, max);
}
/** 类型守卫：判断 Tunnel 是否带 localPort（不使用 any）。 */
function hasLocalPort(t) {
    const v = t.localPort;
    return typeof v === "number" && Number.isFinite(v);
}
/** 常见系统错误 → 中文友好文案。 */
const ERROR_HINTS = [
    [/ECONNREFUSED/, "连不上远程节点（对方未监听或已关闭）"],
    [/ECONNRESET|EPIPE/, "连接被对端重置，请重试"],
    [/ETIMEDOUT|ESOCKETTIMEDOUT|timeout|超时/i, "连接超时，请检查网络后重试"],
    [/ENOTFOUND|EAI_AGAIN/, "域名解析失败，请检查网络或 DNS 设置"],
    [/EHOSTUNREACH|ENETUNREACH/, "网络不可达，请检查网络连接"],
    [/EACCES|EPERM/, "没有权限（可能被杀毒软件或系统拦截）"],
    [/ENOSPC/, "磁盘空间不足"],
    [/HTTP 429/, "请求过于频繁，请稍后再试"],
    [/HTTP 5\d\d/, "远程服务异常，请稍后重试"],
    [/HTTP 4\d\d/, "远程服务拒绝了请求，请检查配置"],
];
function rawMessage(e) {
    if (e instanceof Error)
        return e.message;
    if (typeof e === "string")
        return e;
    try {
        const json = JSON.stringify(e);
        if (typeof json === "string")
            return json;
    }
    catch {
        /* 循环引用等，退回 String() */
    }
    return String(e);
}
/** 把任意异常转成可展示的中文文案。 */
function toFriendlyError(e) {
    const msg = rawMessage(e);
    for (const [re, hint] of ERROR_HINTS) {
        if (re.test(msg))
            return hint;
    }
    return msg.trim() === "" ? "未知错误" : msg;
}
// ---------------------------------------------------------------------------
// DesktopBridge
// ---------------------------------------------------------------------------
class DesktopBridge {
    backend;
    log;
    allowRemove;
    /** 由宿主（Electron 主进程）设置，用于把下载进度转发给渲染进程 */
    progressSink = null;
    /** 自己持有的两个联机传输实例（惰性：构造时不联网、不启进程） */
    redstone;
    terracotta;
    /** 内置终端的命令行执行器（与前端终端共享同一套命令语义） */
    cli;
    /** 账号服务（正版设备码登录 + 离线账号）；惰性 init，首次访问账号通道时载入 */
    accounts;
    accountsReady = null;
    /** 系统剩余资源探测器；默认走 Node 的 os.totalmem/freemem，Electron 主进程可注入更精确实现 */
    resourceProbe = resource_monitor_1.probeSystemResource;
    handlers;
    constructor(opts) {
        this.backend = opts.backend;
        this.log = (opts.log ?? opts.backend.log).child("desktop-bridge");
        this.allowRemove = opts.allowRemove ?? true;
        // 这两个类不在 MultiplayerManager 里直接可取，故在桥接层各持有一份。
        this.redstone = new redstone_1.RedstoneTransport({ log: this.log.child("redstone") });
        this.terracotta = new terracotta_1.TerracottaTransport({ log: this.log.child("terracotta") });
        this.cli = new cli_commands_1.CliCommands({ backend: this.backend, log: this.log.child("cli") });
        this.accounts = new account_service_1.AccountService({
            dataDir: this.accountDataDir(),
            log: this.log.child("account"),
            clientId: this.accountClientId(),
            onEvent: (event, data) => this.emitHostEvent(event, data),
        });
        this.handlers = {
            "server:list": () => this.serverList(),
            "server:create": (p) => this.serverCreate(p),
            "server:start": (p) => this.serverStart(p),
            "server:stop": (p) => this.serverStop(p),
            "server:status": (p) => this.serverStatus(p),
            "server:command": (p) => this.serverCommand(p),
            "server:remove": (p) => this.serverRemove(p),
            "redstone:nodes": () => this.redstoneNodes(),
            "redstone:host": (p) => this.redstoneHost(p),
            "redstone:join": (p) => this.redstoneJoin(p),
            "redstone:stop": () => this.redstoneStop(),
            "redstone:lobby": (p) => this.redstoneLobby(p),
            "terracotta:status": () => this.terracottaStatus(),
            "terracotta:download": () => this.terracottaDownload(),
            "terracotta:host": (p) => this.terracottaHost(p),
            "terracotta:join": (p) => this.terracottaJoin(p),
            "terracotta:stop": () => this.terracottaStop(),
            "app:transports": () => Promise.resolve(this.backend.listTransports()),
            "cli:exec": (p) => this.cliExec(p),
            "account:list": () => this.accountList(),
            "account:addOffline": (p) => this.accountAddOffline(p),
            "account:loginMicrosoft": () => this.accountLoginMicrosoft(),
            "account:cancelLogin": () => this.accountCancelLogin(),
            "account:remove": (p) => this.accountRemove(p),
            "account:setActive": (p) => this.accountSetActive(p),
            "account:active": () => this.accountActive(),
            "sys:resource": () => this.sysResource(),
        };
    }
    /** 统一入口：所有通道都从这里分发，返回 `{ ok, data?, error? }`，绝不抛异常。 */
    async handle(channel, payload) {
        const fn = this.handlers[channel];
        if (!fn) {
            this.log.warn(`收到未知通道：${channel}`);
            return { ok: false, error: `未知通道：${channel}` };
        }
        try {
            const data = await fn(payload ?? {});
            this.log.debug(`通道 ${channel} 完成`);
            return { ok: true, data };
        }
        catch (e) {
            const error = e instanceof BridgeValidationError ? e.message : toFriendlyError(e);
            if (e instanceof BridgeValidationError) {
                this.log.warn(`通道 ${channel} 参数非法：${error}`);
            }
            else {
                this.log.error(`通道 ${channel} 失败：${rawMessage(e)}`);
            }
            return { ok: false, error };
        }
    }
    /** 把后端事件转成前端事件（返回取消函数）。 */
    attachEmitter(emit) {
        const offs = [];
        for (const name of FORWARDED_EVENTS) {
            offs.push(this.backend.events.on(name, (payload) => {
                try {
                    emit(name, payload);
                }
                catch (e) {
                    // 渲染进程已销毁时 ipc 发送会抛错，这里吞掉避免打断后端
                    this.log.warn(`转发事件 ${name} 失败：${rawMessage(e)}`);
                }
            }));
        }
        this.log.info(`事件转发已挂载：${FORWARDED_EVENTS.join(", ")}`);
        return () => {
            for (const off of offs)
                off();
            this.log.info("事件转发已卸载");
        };
    }
    /** 通道清单（用于诊断）。 */
    channels() {
        return [...exports.BRIDGE_CHANNELS];
    }
    /** 由宿主（Electron 主进程）设置，用于把下载进度转发给渲染进程。 */
    setProgressSink(sink) {
        this.progressSink = sink;
    }
    /** 由宿主（Electron 主进程）注入更精确的系统内存探测（如 process.getSystemMemoryInfo）。 */
    setResourceProbe(fn) {
        this.resourceProbe = fn;
    }
    /** sys:resource：采样并判定当前系统剩余资源。 */
    sysResource() {
        return (0, resource_monitor_1.assessResources)(this.resourceProbe());
    }
    /** 关闭桥接层持有的联机会话（应用退出时调用，避免残留进程）。 */
    async dispose() {
        this.accounts.dispose();
        await Promise.allSettled([this.redstone.stop(), this.terracotta.stop()]);
        this.progressSink = null;
        this.log.info("桌面桥接层已释放");
    }
    // -------------------------------------------------------------------------
    // server:*
    // -------------------------------------------------------------------------
    serverList() {
        const entries = this.backend.listServers();
        const raw = this.backend.serverStatus();
        const statuses = Array.isArray(raw) ? raw : [raw];
        const byId = new Map(statuses.map((s) => [s.id, s]));
        return entries.map((entry) => {
            const st = byId.get(entry.id);
            const item = { ...entry, state: st?.state ?? "stopped" };
            if (st?.pid !== undefined)
                item.pid = st.pid;
            if (st?.startedAt !== undefined)
                item.startedAt = st.startedAt;
            if (st?.message !== undefined)
                item.message = st.message;
            return item;
        });
    }
    async serverCreate(payload) {
        const obj = asRecord(payload);
        const spec = {
            name: requireString(obj, "name", "服务端名称"),
            versionId: requireString(obj, "versionId", "游戏版本"),
        };
        const port = optionalInt(obj, "port", "监听端口", 1, 65535);
        if (port !== undefined)
            spec.port = port;
        const maxMemoryMB = optionalInt(obj, "maxMemoryMB", "最大内存(MB)", 512, 32768);
        if (maxMemoryMB !== undefined)
            spec.maxMemoryMB = maxMemoryMB;
        const maxPlayers = optionalInt(obj, "maxPlayers", "最大玩家数", 1, 1000);
        if (maxPlayers !== undefined)
            spec.maxPlayers = maxPlayers;
        const viewDistance = optionalInt(obj, "viewDistance", "视距", 2, 32);
        if (viewDistance !== undefined)
            spec.viewDistance = viewDistance;
        const motd = optionalString(obj, "motd");
        if (motd !== undefined)
            spec.motd = motd;
        const difficulty = optionalString(obj, "difficulty");
        if (difficulty !== undefined)
            spec.difficulty = difficulty;
        const gamemode = optionalString(obj, "gamemode");
        if (gamemode !== undefined)
            spec.gamemode = gamemode;
        const levelName = optionalString(obj, "levelName");
        if (levelName !== undefined)
            spec.levelName = levelName;
        const clientDir = optionalString(obj, "clientDir");
        if (clientDir !== undefined)
            spec.clientDir = clientDir;
        const dir = optionalString(obj, "dir");
        if (dir !== undefined)
            spec.dir = dir;
        if (typeof obj["onlineMode"] === "boolean")
            spec.onlineMode = obj["onlineMode"];
        if (typeof obj["syncClientMods"] === "boolean")
            spec.syncClientMods = obj["syncClientMods"];
        this.log.info(`创建服务端：${spec.name}（${spec.versionId}）`);
        return this.backend.createServer(spec);
    }
    async serverStart(payload) {
        const id = requireString(asRecord(payload), "id", "服务端 id");
        this.log.info(`启动服务端：${id}`);
        return this.backend.startServer(id);
    }
    async serverStop(payload) {
        const id = requireString(asRecord(payload), "id", "服务端 id");
        this.log.info(`停止服务端：${id}`);
        return this.backend.stopServer(id);
    }
    serverStatus(payload) {
        const id = optionalString(asRecord(payload), "id");
        return this.backend.serverStatus(id);
    }
    serverCommand(payload) {
        const obj = asRecord(payload);
        const id = requireString(obj, "id", "服务端 id");
        const cmd = requireString(obj, "cmd", "控制台命令");
        this.backend.serverCommand(id, cmd);
        return { sent: true };
    }
    async serverRemove(payload) {
        if (!this.allowRemove) {
            throw new BridgeValidationError("当前配置禁止删除服务端目录（allowRemove=false）");
        }
        const id = requireString(asRecord(payload), "id", "服务端 id");
        this.log.warn(`删除服务端：${id}`);
        await this.backend.removeServer(id);
        return { removed: true };
    }
    // -------------------------------------------------------------------------
    // redstone:*
    // -------------------------------------------------------------------------
    redstoneNodes() {
        return this.redstone.fetchNodes();
    }
    async redstoneHost(payload) {
        const obj = asRecord(payload);
        const gamePort = requireInt(obj, "gamePort", "游戏端口（开放到 LAN）", 1, 65535);
        const name = optionalString(obj, "name");
        const handle = await this.redstone.host({ gamePort, name });
        this.log.info(`红石房间已开启：${handle.connectionInfo}`);
        return { connectionInfo: handle.connectionInfo };
    }
    async redstoneJoin(payload) {
        const obj = asRecord(payload);
        const connectionInfo = requireString(obj, "connectionInfo", "红石连接信息 host:port");
        const name = optionalString(obj, "name");
        const tunnel = await this.redstone.join({ connectionInfo, name });
        return {
            localPort: hasLocalPort(tunnel) ? tunnel.localPort : 0,
            address: tunnel.info.addr,
        };
    }
    async redstoneStop() {
        await this.redstone.stop();
        this.log.info("红石联机已停止");
        return { stopped: true };
    }
    async redstoneLobby(payload) {
        const offset = optionalInt(asRecord(payload), "offset", "分页偏移", 0, 1_000_000) ?? 0;
        return this.redstone.listTunnels(offset);
    }
    // -------------------------------------------------------------------------
    // terracotta:*
    // -------------------------------------------------------------------------
    terracottaStatus() {
        const st = this.terracotta.state();
        return {
            installed: this.terracotta.isInstalled(),
            running: st.running,
            mode: st.mode,
            roomCode: st.roomCode,
            virtualIP: st.virtualIP,
            state: st.state,
            errorMessage: st.errorMessage,
        };
    }
    async terracottaDownload() {
        this.log.info("开始下载 Terracotta 二进制");
        const binPath = await this.terracotta.download((p) => {
            this.progressSink?.("terracotta:progress", {
                received: p.received,
                total: p.total,
                percent: p.total > 0 ? Math.round((p.received / p.total) * 100) : null,
            });
        });
        this.progressSink?.("terracotta:progress", { done: true, path: binPath });
        this.log.info(`Terracotta 安装完成：${binPath}`);
        return { path: binPath };
    }
    async terracottaHost(payload) {
        const obj = asRecord(payload);
        const gamePort = requireInt(obj, "gamePort", "游戏端口（开放到 LAN）", 1, 65535);
        const name = optionalString(obj, "name");
        const handle = await this.terracotta.host({ gamePort, name });
        const st = this.terracotta.state();
        const roomCode = st.roomCode || handle.connectionInfo;
        if (!roomCode)
            throw new Error("Terracotta 未返回房间码，请稍后重试");
        this.log.info(`Terracotta 房间已开启：${roomCode}`);
        return { roomCode, virtualIP: st.virtualIP };
    }
    async terracottaJoin(payload) {
        const obj = asRecord(payload);
        const connectionInfo = requireString(obj, "connectionInfo", "房间码");
        const name = optionalString(obj, "name");
        const tunnel = await this.terracotta.join({ connectionInfo, name });
        const st = this.terracotta.state();
        return { address: tunnel.info.addr, roomCode: st.roomCode || connectionInfo };
    }
    async terracottaStop() {
        await this.terracotta.stop();
        return { stopped: true };
    }
    // -------------------------------------------------------------------------
    // cli:*
    // -------------------------------------------------------------------------
    /** 内置终端：整行命令交给 CliCommands 解析执行，返回 { lines, mutated }。 */
    cliExec(payload) {
        const line = optionalString(asRecord(payload), "line") ?? "";
        return this.cli.exec(line);
    }
    // -------------------------------------------------------------------------
    // account:*（正版设备码登录 + 离线账号）
    // -------------------------------------------------------------------------
    /** 账号数据的落盘目录：优先取后端 config.root，取不到退回 ~/.fusionmc。 */
    accountDataDir() {
        const cfg = this.backend.config;
        const root = cfg?.value?.root;
        if (typeof root === "string" && root.trim() !== "")
            return root;
        return (0, path_1.join)((0, os_1.homedir)(), ".fusionmc");
    }
    /** Microsoft OAuth client_id：优先读 config.runtime.msClientId，未配置则用内置默认。 */
    accountClientId() {
        const cfg = this.backend.config;
        const id = cfg?.runtime?.msClientId;
        return typeof id === "string" && id.trim() !== "" ? id : undefined;
    }
    /** 惰性载入账号存储；并发调用共享同一个 Promise，失败后允许重试。 */
    ensureAccounts() {
        if (!this.accountsReady) {
            this.accountsReady = this.accounts.init().catch((e) => {
                this.accountsReady = null;
                throw e;
            });
        }
        return this.accountsReady;
    }
    /** 账号事件走与进度事件相同的出口（宿主注入的 emit），事件名原样透传。 */
    emitHostEvent(event, data) {
        try {
            this.progressSink?.(event, data);
        }
        catch (e) {
            this.log.warn(`转发账号事件 ${event} 失败：${rawMessage(e)}`);
        }
    }
    async accountList() {
        await this.ensureAccounts();
        return this.accounts.list();
    }
    async accountAddOffline(payload) {
        await this.ensureAccounts();
        const username = requireString(asRecord(payload), "username", "离线玩家名");
        const account = await this.accounts.addOffline(username);
        const { accounts, activeId } = this.accounts.list();
        return { account, accounts, activeId };
    }
    async accountLoginMicrosoft() {
        await this.ensureAccounts();
        const deviceCode = await this.accounts.startMicrosoftLogin();
        return { deviceCode };
    }
    async accountCancelLogin() {
        this.accounts.cancelLogin();
        return { ok: true };
    }
    async accountRemove(payload) {
        await this.ensureAccounts();
        const id = requireString(asRecord(payload), "id", "账号 id");
        const ok = await this.accounts.remove(id);
        const { accounts, activeId } = this.accounts.list();
        return { ok, accounts, activeId };
    }
    async accountSetActive(payload) {
        await this.ensureAccounts();
        const id = requireString(asRecord(payload), "id", "账号 id");
        const ok = await this.accounts.setActive(id);
        return { ok, activeId: this.accounts.list().activeId };
    }
    async accountActive() {
        await this.ensureAccounts();
        const { accounts, activeId } = this.accounts.list();
        const account = accounts.find((a) => a.id === activeId) ?? null;
        const identity = await this.accounts.activeIdentity();
        return { account, identity };
    }
}
exports.DesktopBridge = DesktopBridge;
//# sourceMappingURL=bridge.js.map