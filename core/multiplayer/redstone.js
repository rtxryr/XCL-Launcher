"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedstoneTransport = exports.HostSession = exports.RedstoneHostHandle = exports.RedstoneJoinTunnel = exports.DEFAULT_NODES = exports.DEFAULT_REGISTRY_URL = exports.MAX_PENDING = exports.APIKEY_CHARS = exports.TCP_PORT = exports.HTTP_PORT = void 0;
exports.makeApikey = makeApikey;
exports.parseControlLine = parseControlLine;
exports.isHttpProbe = isHttpProbe;
exports.isMinecraftHandshake = isMinecraftHandshake;
exports.listTunnelsOn = listTunnelsOn;
exports.getTunnelMods = getTunnelMods;
exports.closeTunnel = closeTunnel;
const events_1 = require("events");
const crypto_1 = require("crypto");
const net_1 = require("net");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const logger_1 = require("../core/logger");
const transport_1 = require("./transport");
// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
/** 控制面 HTTP 端口（远端节点）。 */
exports.HTTP_PORT = 3000;
/** 数据面 TCP 端口（远端节点）。 */
exports.TCP_PORT = 7000;
/** apikey 字符集。 */
exports.APIKEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** 游戏端口未连上时最多缓存的待写批次。 */
exports.MAX_PENDING = 8;
/** 节点注册表（返回 { "上海": "122.51.108.96", ... }）。 */
exports.DEFAULT_REGISTRY_URL = "https://shithub.site/server.json";
/** 注册表不可用时的兜底节点。 */
exports.DEFAULT_NODES = [{ name: "上海", address: "122.51.108.96" }];
// ---------------------------------------------------------------------------
// 纯函数（供测试与内部复用）
// ---------------------------------------------------------------------------
/**
 * 生成 apikey：默认 20 位，字符集 [A-Za-z0-9]。
 * 使用 crypto 随机字节 + 拒绝采样，避免 Math.random 的弱随机与取模偏差。
 */
function makeApikey(len = 20) {
    if (len <= 0)
        return "";
    const limit = 256 - (256 % exports.APIKEY_CHARS.length); // 248，>=limit 的字节丢弃
    const out = [];
    while (out.length < len) {
        const bytes = (0, crypto_1.randomBytes)(len * 2);
        for (const b of bytes) {
            if (b >= limit)
                continue;
            out.push(exports.APIKEY_CHARS[b % exports.APIKEY_CHARS.length]);
            if (out.length >= len)
                break;
        }
    }
    return out.join("");
}
/**
 * 从字节流里切出【首行】（0x0A 结尾），返回行文本与剩余字节。
 *
 * 注意：必须全程按字节操作。Minecraft 协议载荷含 0x80-0xFF，
 * 一旦 `.toString("utf8")` 再转回 Buffer 就会把非法序列替换成 U+FFFD，
 * 破坏玩家二进制数据。所以剩余部分直接 `subarray` 原样返回（零拷贝）。
 */
function parseControlLine(buf) {
    const idx = buf.indexOf(0x0a);
    if (idx < 0)
        return null;
    // 控制行本身是 ASCII，用 latin1 解码不会改动任何字节
    const raw = buf.subarray(0, idx).toString("latin1");
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    return { line, rest: buf.subarray(idx + 1) };
}
const HTTP_METHOD_PREFIXES = [
    "GET",
    "POST",
    "PUT",
    "HEAD",
    "DELETE",
    "PATCH",
    "OPTIONS",
    "CONNECT",
    "TRACE",
];
/** 是否是 HTTP 探测包（节点/中间设备偶尔会用 HTTP 探活，必须丢弃，不能转给游戏）。 */
function isHttpProbe(buf) {
    if (buf.length < 3)
        return false;
    const head = buf.subarray(0, 8).toString("latin1").toUpperCase();
    return HTTP_METHOD_PREFIXES.some((m) => head.startsWith(m));
}
/** 读 Minecraft 协议的无符号 varint（最多 5 字节）。 */
function readVarInt(buf, offset, maxBytes = 5) {
    let value = 0;
    let shift = 0;
    for (let i = 0; i < maxBytes; i++) {
        const pos = offset + i;
        if (pos >= buf.length)
            return null;
        const b = buf[pos];
        value |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0)
            return { value: value >>> 0, next: pos + 1 };
        shift += 7;
    }
    return null;
}
/**
 * 是否是一个 Minecraft 握手包（Handshake，packetId=0x00）。
 * 用于识别「新玩家进来」，此时要强制重建 gameSocket，否则会把新玩家的
 * 握手字节发给上一个玩家残留的连接。
 *
 * 判定条件（对齐 VersePC）：
 *   包长 ∈ [0x10, 0x20]、packetId === 0x00、协议号为双字节 varint、
 *   协议号 ∈ [393, 800]、服务器地址长度 ∈ [5, 30]。
 */
function isMinecraftHandshake(buf) {
    if (buf.length < 4)
        return false;
    const pktLen = buf[0];
    if (pktLen < 0x10 || pktLen > 0x20)
        return false;
    if (buf[1] !== 0x00)
        return false;
    // 协议号 393+ 必然是双字节 varint，首字节高位必为 1
    if (buf[2] < 0x80)
        return false;
    const proto = readVarInt(buf, 2);
    if (!proto)
        return false;
    if (proto.value < 393 || proto.value > 800)
        return false;
    const addrLen = readVarInt(buf, proto.next);
    if (!addrLen)
        return false;
    if (addrLen.value < 5 || addrLen.value > 30)
        return false;
    return true;
}
async function httpRequest(url, init = {}) {
    const res = await fetch(url, {
        method: init.method ?? "GET",
        headers: init.headers,
        body: init.body,
        signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
    });
    const text = await res.text();
    let json = undefined;
    try {
        json = text ? JSON.parse(text) : undefined;
    }
    catch {
        json = undefined;
    }
    return { status: res.status, text, json };
}
/** 从各种可能形态的响应里挑出 listenPort。 */
function pickListenPort(data) {
    const seen = new Set();
    const walk = (v, depth) => {
        if (!v || typeof v !== "object" || depth > 3)
            return undefined;
        if (seen.has(v))
            return undefined;
        seen.add(v);
        const obj = v;
        for (const key of ["listenPort", "listen_port", "port", "tcpPort"]) {
            const n = obj[key];
            if (typeof n === "number" && Number.isFinite(n) && n > 0)
                return n;
        }
        for (const key of ["tunnel", "data", "result", "server"]) {
            const found = walk(obj[key], depth + 1);
            if (found !== undefined)
                return found;
        }
        return undefined;
    };
    return walk(data, 0);
}
/** 把 `/tunnels` 的各种返回形态归一成数组。 */
function normalizeTunnels(data) {
    if (Array.isArray(data))
        return data;
    if (data && typeof data === "object") {
        const obj = data;
        for (const key of ["tunnels", "list", "data", "items"]) {
            if (Array.isArray(obj[key]))
                return obj[key];
        }
    }
    return [];
}
function parseListenPortFromLine(line) {
    const m = /^OK\s+TUNNEL\b\s*(\d+)?/i.exec(line.trim());
    if (!m || !m[1])
        return undefined;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
// ---------------------------------------------------------------------------
// TCP 小工具
// ---------------------------------------------------------------------------
/** 建立一个带超时的 TCP 连接。 */
function connectTcp(host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        const sock = (0, net_1.connect)({ host, port });
        const timer = setTimeout(() => {
            sock.destroy();
            reject((0, transport_1.transportError)(`连接 ${host}:${port} 超时（${timeoutMs}ms）`));
        }, timeoutMs);
        const onFail = (e) => {
            clearTimeout(timer);
            sock.destroy();
            reject((0, transport_1.transportError)(`连接 ${host}:${port} 失败`, e));
        };
        sock.once("error", onFail);
        sock.once("connect", () => {
            clearTimeout(timer);
            sock.off("error", onFail);
            sock.on("error", () => {
                /* 后续错误由业务层处理，这里防止 unhandled 'error' 崩溃 */
            });
            resolve(sock);
        });
    });
}
/** 探测端口是否可连（健康检查用）。 */
function probePort(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const sock = (0, net_1.connect)({ host, port });
        let settled = false;
        const done = (ok) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            sock.destroy();
            resolve(ok);
        };
        const timer = setTimeout(() => done(false), timeoutMs);
        sock.once("connect", () => done(true));
        sock.once("error", () => done(false));
    });
}
/**
 * 等待控制面的一行响应。
 * 全程按字节缓冲，切出首行后把剩余字节 `unshift` 回 socket（可能已是玩家数据）。
 */
function waitControlLine(sock, timeoutMs) {
    return new Promise((resolve, reject) => {
        let buf = Buffer.alloc(0);
        let done = false;
        let timer;
        const cleanup = () => {
            if (done)
                return;
            done = true;
            if (timer)
                clearTimeout(timer);
            sock.off("data", onData);
            sock.off("error", onError);
            sock.pause();
        };
        const onData = (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            const parsed = parseControlLine(buf);
            if (!parsed)
                return;
            cleanup();
            // 剩余字节回填到可读队列头部，交给后续数据通道
            if (parsed.rest.length > 0)
                sock.unshift(parsed.rest);
            resolve(parsed);
        };
        const onError = (e) => {
            cleanup();
            reject((0, transport_1.transportError)("控制连接出错", e));
        };
        timer = setTimeout(() => {
            cleanup();
            reject((0, transport_1.transportError)("等待控制面响应超时"));
        }, timeoutMs);
        sock.on("data", onData);
        sock.on("error", onError);
        sock.resume();
    });
}
function nodeBase(node) {
    return `http://${node.address}:${exports.HTTP_PORT}`;
}
/** 申请 apikey（幂等：200 与 409 都算成功）。 */
async function registerApikey(node, apikey) {
    const res = await httpRequest(`${nodeBase(node)}/apikey`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey }),
    });
    if (res.status !== 200 && res.status !== 409 && res.status >= 400) {
        throw (0, transport_1.transportError)(`申请 apikey 失败：HTTP ${res.status}`);
    }
}
/** 查询当前 apikey 已分配的隧道端口。 */
async function queryListenPort(node, apikey, log) {
    try {
        const res = await httpRequest(`${nodeBase(node)}/tunnels`, {
            headers: { Authorization: apikey },
        });
        if (res.status >= 400)
            return undefined;
        const direct = pickListenPort(res.json);
        if (direct)
            return direct;
        const list = normalizeTunnels(res.json);
        for (const item of list) {
            const port = pickListenPort(item);
            if (port)
                return port;
        }
        return undefined;
    }
    catch (e) {
        log.debug(`查询隧道端口失败：${e.message}`);
        return undefined;
    }
}
/** 创建隧道；429 时先删除旧隧道再重试一次。 */
async function createTunnel(node, room, log) {
    const url = `${nodeBase(node)}/tunnels?publicAccess=${room.publicAccess ? 1 : 0}`;
    const headers = { Authorization: room.apikey };
    let body;
    if (room.publicAccess) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({
            title: room.title,
            description: room.description,
            online: !room.allowOffline,
        });
    }
    const send = () => httpRequest(url, { method: "POST", headers, body });
    let res = await send();
    if (res.status === 429) {
        log.warn("创建隧道过于频繁（HTTP 429），先删除旧隧道再重试一次");
        await closeTunnelOn(node, room.apikey, log);
        res = await send();
    }
    if (res.status >= 400 && res.status !== 409) {
        throw (0, transport_1.transportError)(`创建隧道失败：HTTP ${res.status} ${res.text.slice(0, 120)}`);
    }
    return pickListenPort(res.json) ?? (await queryListenPort(node, room.apikey, log));
}
/**
 * 建立控制连接并完成握手：
 *   TCP(:7000) → 写 `apikey\n` → 读首行
 *     - `OK TUNNEL xx` 已有隧道
 *     - `OK WAITING`   需创建（HTTP POST /tunnels），随后等 `OK TUNNEL` 通知
 *     - `ERR ...`      报错
 */
async function openControlSocket(node, room, log) {
    const socket = await connectTcp(node.address, exports.TCP_PORT, 8000);
    socket.write(`${room.apikey}\n`);
    socket.pause();
    let first;
    try {
        first = await waitControlLine(socket, 8000);
    }
    catch (e) {
        socket.destroy();
        throw e;
    }
    const line = first.line.trim();
    if (/^OK\s+TUNNEL\b/i.test(line)) {
        const listenPort = parseListenPortFromLine(line) ?? (await queryListenPort(node, room.apikey, log));
        log.info(`复用已有隧道${listenPort ? `，端口 ${listenPort}` : ""}`);
        return { socket, listenPort };
    }
    if (/^OK\s+WAITING$/i.test(line)) {
        log.info("节点已就绪，正在创建隧道…");
        const created = await createTunnel(node, room, log);
        try {
            // 创建成功后节点会推一行 `OK TUNNEL <port>`；8s 内没来也放行
            const notify = await waitControlLine(socket, 8000);
            log.info(`隧道已创建：${notify.line.trim()}`);
            return { socket, listenPort: parseListenPortFromLine(notify.line) ?? created };
        }
        catch {
            log.warn("未收到 OK TUNNEL 通知（继续按已创建处理）");
            return { socket, listenPort: created };
        }
    }
    socket.destroy();
    if (/^ERR/i.test(line))
        throw (0, transport_1.transportError)(`红石节点返回错误：${line}`);
    throw (0, transport_1.transportError)(`未知的控制面响应：${line.slice(0, 120)}`);
}
async function closeTunnelOn(node, apikey, log) {
    try {
        const res = await httpRequest(`${nodeBase(node)}/tunnels`, {
            method: "DELETE",
            headers: { Authorization: apikey },
        });
        if (res.status >= 400) {
            log.debug(`删除隧道返回 HTTP ${res.status}`);
            return false;
        }
        return true;
    }
    catch (e) {
        log.debug(`删除隧道失败：${e.message}`);
        return false;
    }
}
/** 大厅列表：先 offset，再退到 from，最后带 Authorization 重试。 */
async function listTunnelsOn(node, offset = 0, apikey) {
    const base = `${nodeBase(node)}/tunnels/list`;
    const urls = [`${base}?offset=${offset}`, `${base}?from=${offset}`];
    for (const url of urls) {
        try {
            const res = await httpRequest(url);
            if (res.status < 400) {
                return { tunnels: normalizeTunnels(res.json), serverAddress: `${node.address}:${exports.TCP_PORT}` };
            }
        }
        catch {
            /* 换下一个形态再试 */
        }
    }
    if (apikey) {
        for (const url of urls) {
            try {
                const res = await httpRequest(url, { headers: { Authorization: apikey } });
                if (res.status < 400) {
                    return {
                        tunnels: normalizeTunnels(res.json),
                        serverAddress: `${node.address}:${exports.TCP_PORT}`,
                    };
                }
            }
            catch {
                /* 忽略 */
            }
        }
    }
    return { tunnels: [], serverAddress: `${node.address}:${exports.TCP_PORT}` };
}
/** 查隧道模组列表；404 视为「没有模组」。 */
async function getTunnelMods(node, id) {
    try {
        const res = await httpRequest(`${nodeBase(node)}/tunnels/mods?id=${encodeURIComponent(id)}`);
        if (res.status === 404)
            return [];
        if (res.status >= 400)
            return [];
        if (Array.isArray(res.json))
            return res.json;
        const obj = res.json;
        if (obj && Array.isArray(obj["mods"]))
            return obj["mods"];
        return [];
    }
    catch {
        return [];
    }
}
async function closeTunnel(node, apikey, log = logger_1.rootLogger) {
    return closeTunnelOn(node, apikey, log);
}
// ---------------------------------------------------------------------------
// Tunnel 实现
// ---------------------------------------------------------------------------
/** 控制连接包装成的 Tunnel（host 侧数据通道）。 */
class ControlTunnel extends events_1.EventEmitter {
    sock;
    info;
    constructor(sock, info) {
        super();
        this.sock = sock;
        this.info = info;
        // 防止无人监听 'error' 时 EventEmitter 抛异常
        this.on("error", () => { });
        sock.on("data", (chunk) => this.emit("data", chunk));
        sock.on("close", () => this.emit("close"));
        sock.on("error", (e) => this.emit("error", e));
    }
    write(chunk) {
        if (!this.sock.destroyed)
            this.sock.write(chunk);
    }
    close() {
        if (!this.sock.destroyed)
            this.sock.destroy();
    }
    get destroyed() {
        return this.sock.destroyed;
    }
}
/**
 * join 侧的 Tunnel：在 127.0.0.1 上开一个随机端口给本机 MC 客户端连，
 * 每个进来的连接各自 `net.connect(远端 host:port)` 做双向转发。
 *
 * 之所以可以在本机监听：它只绑 127.0.0.1，外部不可达，等价于「虚拟网卡」。
 */
class RedstoneJoinTunnel extends events_1.EventEmitter {
    target;
    log;
    /** 本机接入端口（游戏客户端连这个）。 */
    localPort = 0;
    info;
    server = null;
    clients = new Set();
    remotes = new Set();
    closed = false;
    constructor(target, name, log) {
        super();
        this.target = target;
        this.log = log;
        this.on("error", () => { });
        this.info = {
            id: `redstone-join-${target.host}:${target.port}`,
            name,
            addr: `${target.host}:${target.port}`,
            via: "redstone",
        };
    }
    /** 开始监听本机接入端口。 */
    listen() {
        return new Promise((resolve, reject) => {
            const server = (0, net_1.createServer)((client) => this.handleClient(client));
            this.server = server;
            const onError = (e) => {
                server.off("error", onError);
                reject((0, transport_1.transportError)("本机接入端口监听失败", e));
            };
            server.on("error", onError);
            server.listen(0, "127.0.0.1", () => {
                server.off("error", onError);
                server.on("error", (e) => this.log.debug(`接入端口错误：${e.message}`));
                const addr = server.address();
                this.localPort = typeof addr === "object" && addr ? addr.port : 0;
                resolve(this.localPort);
            });
        });
    }
    handleClient(client) {
        if (this.closed) {
            client.destroy();
            return;
        }
        client.on("error", () => {
            /* 忽略：客户端先断开是常态 */
        });
        const remote = (0, net_1.connect)({ host: this.target.host, port: this.target.port });
        this.clients.add(client);
        this.remotes.add(remote);
        remote.on("error", (e) => {
            this.log.debug(`连接远端隧道失败：${e.message}`);
            client.destroy();
        });
        remote.once("connect", () => {
            client.pipe(remote);
            remote.pipe(client);
            // 同时对外 emit，方便调用方直接把本 Tunnel 交给 GameBridge 使用
            remote.on("data", (chunk) => this.emit("data", chunk));
        });
        const finish = () => {
            this.clients.delete(client);
            this.remotes.delete(remote);
            client.destroy();
            remote.destroy();
            if (this.clients.size === 0 && !this.closed)
                this.log.debug("全部玩家已断开");
        };
        client.on("close", finish);
        remote.on("close", finish);
    }
    write(chunk) {
        for (const r of this.remotes)
            if (!r.destroyed)
                r.write(chunk);
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        for (const c of this.clients)
            c.destroy();
        for (const r of this.remotes)
            r.destroy();
        this.clients.clear();
        this.remotes.clear();
        const server = this.server;
        this.server = null;
        if (server) {
            server.close(() => this.emit("close"));
            // 已经有连接时 close 不会立刻回调，兜底再发一次
            setTimeout(() => this.emit("close"), 50).unref();
        }
        else {
            this.emit("close");
        }
    }
}
exports.RedstoneJoinTunnel = RedstoneJoinTunnel;
// ---------------------------------------------------------------------------
// host 侧：HostHandle + 数据面中继 + 健康检查/重连
// ---------------------------------------------------------------------------
/** 带告警回调的 HostHandle（HostHandle 接口之外的扩展能力）。 */
class RedstoneHostHandle {
    node;
    listenPort;
    session;
    connectionInfo;
    tunnelCbs = [];
    warnCbs = [];
    seen = [];
    closed = false;
    constructor(node, listenPort, session) {
        this.node = node;
        this.listenPort = listenPort;
        this.session = session;
        this.connectionInfo = listenPort
            ? `${node.address}:${listenPort}`
            : `${node.address}:${exports.TCP_PORT}`;
    }
    onTunnel(cb) {
        this.tunnelCbs.push(cb);
        // 补发已经建立的隧道（重连后重新注册时不会漏）
        for (const t of this.seen)
            cb(t);
    }
    /** 监听运行期告警（如「游戏局域网可能已关闭」）。 */
    onWarning(cb) {
        this.warnCbs.push(cb);
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.session.close();
    }
    /** @internal */
    _add(t) {
        this.seen.push(t);
        for (const cb of this.tunnelCbs)
            cb(t);
    }
    /** @internal */
    _warn(msg) {
        for (const cb of this.warnCbs)
            cb(msg);
    }
}
exports.RedstoneHostHandle = RedstoneHostHandle;
/**
 * 一次开房会话：控制连接即数据通道，负责
 *   中继 → 游戏端口、懒连接、HTTP 探测过滤、新玩家握手重建、
 *   控制连接健康检查/指数退避重连、游戏端口健康检查。
 */
class HostSession {
    cfg;
    handle;
    control = null;
    tunnel = null;
    gameSocket = null;
    gameReady = false;
    pending = [];
    closed = false;
    reconnectAttempts = 0;
    gameProbeFailures = 0;
    gotGameData = false;
    controlTimer = null;
    gameTimer = null;
    lanTimer = null;
    reconnectTimer = null;
    constructor(cfg) {
        this.cfg = cfg;
        this.handle = new RedstoneHostHandle(cfg.node, cfg.listenPort, this);
    }
    get listenPort() {
        return this.cfg.listenPort;
    }
    get attempts() {
        return this.reconnectAttempts;
    }
    get running() {
        return !this.closed;
    }
    /** 用已握手的控制 socket 启动会话。 */
    start(firstSocket) {
        this.attach(firstSocket);
        // 控制连接健康检查（半开连接兜底）
        this.controlTimer = setInterval(() => {
            if (this.closed)
                return;
            if (!this.control || this.control.destroyed) {
                this.cfg.log.warn("控制连接已断开，触发重连");
                this.scheduleReconnect();
            }
        }, 30_000);
        this.controlTimer.unref();
        // 游戏端口健康检查：首次 60s，之后每 30s；连续 3 次失败才关闭隧道
        this.gameTimer = setTimeout(() => void this.probeGameLoop(), 60_000);
        this.gameTimer.unref();
    }
    // -- 控制连接 ------------------------------------------------------------
    attach(socket) {
        this.control = socket;
        const info = {
            id: this.cfg.room.apikey,
            name: this.cfg.room.title,
            addr: `${this.cfg.node.address}:${exports.TCP_PORT}`,
            via: "redstone",
        };
        const tunnel = new ControlTunnel(socket, info);
        this.tunnel = tunnel;
        tunnel.on("data", (chunk) => this.onPlayerData(chunk));
        tunnel.on("close", () => {
            if (this.closed)
                return;
            if (this.control !== socket)
                return;
            this.control = null;
            this.tunnel = null;
            this.cfg.log.warn("数据通道已关闭");
            this.scheduleReconnect();
        });
        this.handle._add(tunnel);
        socket.resume();
    }
    scheduleReconnect() {
        if (this.closed)
            return;
        if (this.reconnectTimer)
            return; // 已在等待
        if (this.reconnectAttempts >= 5) {
            this.cfg.log.error("红石重连次数已达上限（5 次），关闭隧道");
            this.close();
            return;
        }
        this.reconnectAttempts++;
        // 指数退避：3000 * 2^(n-1)
        const delay = 3000 * Math.pow(2, this.reconnectAttempts - 1);
        this.cfg.log.info(`将在 ${delay}ms 后进行第 ${this.reconnectAttempts} 次重连`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.reconnect();
        }, delay);
        this.reconnectTimer.unref();
    }
    async reconnect() {
        if (this.closed)
            return;
        try {
            const { socket, listenPort } = await openControlSocket(this.cfg.node, this.cfg.room, this.cfg.log);
            if (this.closed) {
                socket.destroy();
                return;
            }
            if (listenPort && !this.cfg.listenPort)
                this.cfg.listenPort = listenPort;
            this.cfg.log.info("控制连接已恢复");
            this.reconnectAttempts = 0;
            this.attach(socket);
        }
        catch (e) {
            this.cfg.log.warn(`重连失败：${e.message}`);
            this.scheduleReconnect();
        }
    }
    // -- 数据面 --------------------------------------------------------------
    onPlayerData(chunk) {
        if (this.closed)
            return;
        // 节点/中间设备可能用 HTTP 探活，绝不能转给游戏
        if (isHttpProbe(chunk)) {
            this.cfg.log.debug("丢弃 HTTP 探测包");
            return;
        }
        // 新玩家握手 → 上一个玩家的 gameSocket 必须重建，否则字节会串
        if (isMinecraftHandshake(chunk)) {
            this.cfg.log.debug("检测到新玩家握手，重建游戏连接");
            this.resetGameSocket();
        }
        this.enqueue(chunk);
        if (this.gameReady && this.gameSocket && !this.gameSocket.destroyed) {
            this.flushGame();
        }
        else {
            this.connectGame();
        }
    }
    enqueue(chunk) {
        this.pending.push(chunk);
        while (this.pending.length > exports.MAX_PENDING) {
            this.pending.shift();
            this.cfg.log.warn(`待写队列超过 ${exports.MAX_PENDING} 批，丢弃最旧数据`);
        }
    }
    /** 懒连接：只在真的有玩家数据时才去连本机游戏端口。 */
    connectGame() {
        if (this.closed)
            return;
        if (this.gameSocket && !this.gameSocket.destroyed)
            return;
        const port = this.cfg.gamePort;
        const sock = (0, net_1.connect)({ host: "127.0.0.1", port });
        this.gameSocket = sock;
        this.gameReady = false;
        this.gotGameData = false;
        sock.once("connect", () => {
            if (this.gameSocket !== sock)
                return;
            this.gameReady = true;
            this.cfg.log.debug(`已连接本机游戏端口 ${port}`);
            this.startLanWatch();
            this.flushGame();
        });
        sock.on("data", (chunk) => {
            this.gotGameData = true;
            this.tunnel?.write(chunk);
        });
        sock.on("error", (e) => {
            this.cfg.log.debug(`游戏端口连接错误：${e.message}`);
        });
        sock.on("close", () => {
            if (this.gameSocket === sock) {
                this.gameSocket = null;
                this.gameReady = false;
            }
            this.clearLanWatch();
        });
    }
    resetGameSocket() {
        const sock = this.gameSocket;
        this.gameSocket = null;
        this.gameReady = false;
        this.clearLanWatch();
        if (sock && !sock.destroyed)
            sock.destroy();
    }
    flushGame() {
        if (this.closed)
            return;
        const gs = this.gameSocket;
        if (!gs || gs.destroyed || !this.gameReady)
            return;
        const items = this.pending;
        this.pending = [];
        for (const item of items)
            this.writeChunk(item, 3);
    }
    /**
     * 写一批数据到游戏端口；失败时重建连接并在 300ms 后重试（最多 3 次）。
     * 数据先回填队列，重连成功后由 flushGame 自然送出。
     */
    writeChunk(data, retries) {
        if (this.closed)
            return;
        const gs = this.gameSocket;
        if (!gs || gs.destroyed || !this.gameReady) {
            this.pending.unshift(data);
            this.connectGame();
            return;
        }
        gs.write(data, (err) => {
            if (!err)
                return;
            this.cfg.log.warn(`写入游戏端口失败：${err.message}`);
            this.pending.unshift(data);
            this.resetGameSocket();
            if (retries > 0) {
                const t = setTimeout(() => {
                    this.connectGame();
                    this.writeChunk(data, retries - 1);
                }, 300);
                t.unref();
            }
            else {
                this.cfg.log.warn("游戏端口写入重试耗尽，丢弃该批数据");
            }
        });
    }
    // -- 局域网关闭检测 ------------------------------------------------------
    startLanWatch() {
        this.clearLanWatch();
        this.lanTimer = setTimeout(() => {
            this.lanTimer = null;
            if (this.closed || !this.gameReady)
                return;
            if (this.gotGameData)
                return;
            const msg = "游戏局域网可能已关闭，请在游戏内按 Esc → 对局域网开放";
            this.cfg.log.warn(msg);
            this.handle._warn(msg);
        }, 2000);
        this.lanTimer.unref();
    }
    clearLanWatch() {
        if (this.lanTimer) {
            clearTimeout(this.lanTimer);
            this.lanTimer = null;
        }
    }
    // -- 游戏端口健康检查 ----------------------------------------------------
    async probeGameLoop() {
        if (this.closed)
            return;
        const ok = await probePort("127.0.0.1", this.cfg.gamePort, 3000);
        if (this.closed)
            return;
        if (ok) {
            this.gameProbeFailures = 0;
        }
        else {
            this.gameProbeFailures++;
            this.cfg.log.warn(`本机游戏端口 ${this.cfg.gamePort} 探测失败（第 ${this.gameProbeFailures}/3 次）`);
            if (this.gameProbeFailures >= 3) {
                this.cfg.log.error("游戏端口连续 3 次不可用，关闭隧道");
                this.close();
                return;
            }
        }
        this.gameTimer = setTimeout(() => void this.probeGameLoop(), 30_000);
        this.gameTimer.unref();
    }
    // -- 收尾 ----------------------------------------------------------------
    close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.controlTimer)
            clearInterval(this.controlTimer);
        if (this.gameTimer)
            clearTimeout(this.gameTimer);
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.controlTimer = null;
        this.gameTimer = null;
        this.reconnectTimer = null;
        this.clearLanWatch();
        this.pending = [];
        this.resetGameSocket();
        const ctrl = this.control;
        this.control = null;
        this.tunnel = null;
        if (ctrl && !ctrl.destroyed)
            ctrl.destroy();
        this.cfg.log.info("红石隧道已关闭");
        this.cfg.onClosed();
    }
}
exports.HostSession = HostSession;
// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
class RedstoneTransport {
    id = "redstone";
    name = "红石联机（远程中继）";
    opts;
    log;
    apikey = null;
    nodesCache = null;
    session = null;
    node = null;
    room = null;
    constructor(opts = {}) {
        this.opts = opts;
        this.log = (opts.log ?? logger_1.rootLogger).child("redstone");
        // 节点顺序：手动指定 > 注册表 > 内置兜底
        if (opts.nodes && opts.nodes.length > 0)
            this.nodesCache = opts.nodes;
    }
    /**
     * 依赖的远程端点：开房后是当前节点地址；未开房时给出节点注册表，
     * 便于 UI 明确「这套联机依赖远程节点，而非本机服务」。
     */
    get remoteServer() {
        return this.node ? `${this.node.address}:${exports.HTTP_PORT}` : (this.opts.registryUrl ?? exports.DEFAULT_REGISTRY_URL);
    }
    // -- 节点 ----------------------------------------------------------------
    async fetchNodes() {
        if (this.nodesCache)
            return this.nodesCache;
        const url = this.opts.registryUrl ?? exports.DEFAULT_REGISTRY_URL;
        try {
            const res = await httpRequest(url, { timeoutMs: 3000 });
            if (res.status >= 400)
                throw new Error(`HTTP ${res.status}`);
            const obj = res.json;
            if (!obj || typeof obj !== "object")
                throw new Error("响应不是对象");
            const list = [];
            for (const [name, addr] of Object.entries(obj)) {
                if (typeof addr === "string" && addr.length > 0)
                    list.push({ name, address: addr });
            }
            if (list.length === 0)
                throw new Error("节点列表为空");
            this.nodesCache = list;
            this.log.info(`已获取 ${list.length} 个红石节点`);
            return list;
        }
        catch (e) {
            this.log.warn(`获取节点列表失败，使用内置兜底节点：${e.message}`);
            this.nodesCache = [...exports.DEFAULT_NODES];
            return this.nodesCache;
        }
    }
    // -- 大厅 ----------------------------------------------------------------
    async listTunnels(offset = 0) {
        const nodes = await this.fetchNodes();
        return listTunnelsOn(nodes[0], offset, this.apikey ?? undefined);
    }
    async getTunnelMods(id) {
        const nodes = await this.fetchNodes();
        return getTunnelMods(nodes[0], id);
    }
    async closeTunnel() {
        if (!this.node || !this.apikey)
            return false;
        return closeTunnelOn(this.node, this.apikey, this.log);
    }
    // -- 状态 ----------------------------------------------------------------
    status() {
        const s = this.session;
        if (!s || !s.running)
            return { running: false, reconnectAttempts: 0 };
        return {
            running: true,
            address: s.handle.connectionInfo,
            listenPort: s.listenPort,
            reconnectAttempts: s.attempts,
        };
    }
    // -- 开房 ----------------------------------------------------------------
    async host(opts) {
        if (this.session && this.session.running) {
            throw (0, transport_1.transportError)("红石联机已在运行，请先 stop() 再重新开房");
        }
        if (!opts.gamePort || opts.gamePort <= 0) {
            throw (0, transport_1.transportError)("gamePort 无效，请先在游戏内「对局域网开放」");
        }
        this.room = this.buildRoom(opts);
        const nodes = await this.fetchNodes();
        const failures = [];
        for (const node of nodes) {
            try {
                const handle = await this.hostOnNode(node, opts);
                this.node = node;
                this.log.info(`红石房间已开启：${handle.connectionInfo}`);
                return handle;
            }
            catch (e) {
                failures.push(`${node.name}(${node.address}): ${e.message}`);
                this.log.warn(`节点 ${node.name} 开房失败：${e.message}`);
            }
        }
        throw (0, transport_1.transportError)(`所有红石节点均不可用：${failures.join("；")}`);
    }
    buildRoom(opts) {
        const title = (this.opts.title ?? opts.name ?? "FusionMC").slice(0, 8);
        const description = (this.opts.description ?? `FusionMC 红石联机房间（端口 ${opts.gamePort}）`).slice(0, 100);
        return {
            apikey: "", // 真正值在 ensureApikey 后填入
            publicAccess: this.opts.publicAccess ?? true,
            title,
            description,
            allowOffline: this.opts.allowOffline ?? true,
        };
    }
    async hostOnNode(node, opts) {
        const apikey = await this.ensureApikey();
        const room = { ...(this.room ?? this.buildRoom(opts)), apikey };
        this.room = room;
        await registerApikey(node, apikey);
        const { socket, listenPort } = await openControlSocket(node, room, this.log);
        const session = new HostSession({
            node,
            room,
            gamePort: opts.gamePort,
            listenPort,
            log: this.log,
            onClosed: () => {
                if (this.session === session)
                    this.session = null;
            },
        });
        this.session = session;
        session.start(socket);
        return session.handle;
    }
    // -- 加入 ----------------------------------------------------------------
    /**
     * 加入：connectionInfo 形如 `host:port`（host 是红石节点地址，port 是该隧道端口）。
     * 在 127.0.0.1 开一个随机端口供本机 MC 客户端连接，字节双向转发到远端。
     */
    async join(opts) {
        const { host, port } = parseEndpoint(opts.connectionInfo);
        if (!host || !port) {
            throw (0, transport_1.transportError)(`无效的红石连接信息：${opts.connectionInfo}（应为 host:port）`);
        }
        const tunnel = new RedstoneJoinTunnel({ host, port }, opts.name ?? "玩家", this.log);
        await tunnel.listen();
        this.log.info(`红石接入端口已就绪：127.0.0.1:${tunnel.localPort} → ${host}:${port}`);
        return tunnel;
    }
    // -- 收尾 ----------------------------------------------------------------
    async stop() {
        const s = this.session;
        this.session = null;
        s?.close();
    }
    // -- apikey --------------------------------------------------------------
    async ensureApikey() {
        if (this.apikey)
            return this.apikey;
        const file = this.opts.apikeyFile;
        if (file) {
            try {
                const txt = (await (0, promises_1.readFile)(file, "utf8")).trim();
                if (/^[A-Za-z0-9]{16,32}$/.test(txt)) {
                    this.apikey = txt;
                    return txt;
                }
            }
            catch {
                /* 首次运行没有文件，正常 */
            }
        }
        const key = makeApikey();
        this.apikey = key;
        if (file) {
            try {
                await (0, promises_1.mkdir)((0, path_1.dirname)(file), { recursive: true });
                await (0, promises_1.writeFile)(file, key, "utf8");
            }
            catch (e) {
                this.log.warn(`apikey 持久化失败：${e.message}`);
            }
        }
        return key;
    }
}
exports.RedstoneTransport = RedstoneTransport;
/** `host:port` → 拆分（支持 `[::1]:port`）。 */
function parseEndpoint(info) {
    const s = info.trim();
    const m = /^\[([^\]]+)\]:(\d+)$/.exec(s) ?? /^([^:]+):(\d+)$/.exec(s);
    if (!m)
        return { host: "", port: 0 };
    const port = parseInt(m[2], 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535)
        return { host: "", port: 0 };
    return { host: m[1], port };
}
//# sourceMappingURL=redstone.js.map