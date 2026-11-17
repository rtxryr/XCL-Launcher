"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerracottaTransport = exports.TerracottaHostHandle = exports.ROOM_CODE_CHARSET = exports.DEFAULT_NODES = exports.NODE_LIST_URL = exports.DEFAULT_VERSION = void 0;
exports.detectArch = detectArch;
exports.downloadSources = downloadSources;
exports.generateRoomCode = generateRoomCode;
exports.normalizeRoomCode = normalizeRoomCode;
exports.pickNodes = pickNodes;
exports.isZhLocale = isZhLocale;
exports.parseStatePayload = parseStatePayload;
const events_1 = require("events");
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const logger_1 = require("../core/logger");
const transport_1 = require("./transport");
// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
/** 默认 Terracotta 版本（与 VersePC 对齐）。 */
exports.DEFAULT_VERSION = "0.4.0";
/** 公共节点列表（远程），GET 返回 `[{ url, region? }]`。 */
exports.NODE_LIST_URL = "https://terracotta.glavo.site/nodes";
/** 节点列表不可用时的兜底公共节点（仍然是远程端点）。 */
exports.DEFAULT_NODES = [
    "https://etnode.zkitefly.eu.org/node1",
    "https://etnode.zkitefly.eu.org/node2",
];
/** 房间码字符集：去掉易混的 I / O / 0 / 1，共 32 个字符（256 % 32 === 0，取模无偏）。 */
exports.ROOM_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** `/state` 轮询间隔。 */
const POLL_INTERVAL = 500;
/** 等待端口文件的最长时间。 */
const PORT_FILE_TIMEOUT = 30_000;
/** 单个控制 API 请求超时。 */
const HTTP_TIMEOUT = 10_000;
/** 控制 API 重试次数（共尝试 API_RETRIES + 1 次）。 */
const API_RETRIES = 5;
/** 等待 `host-ok` / `guest-ok` 的最长时间。 */
const START_TIMEOUT = 30_000;
/** 日志文件超过该字节数后轮转。 */
const LOG_ROTATE = 512_000;
/** 下载二进制的超时（比控制 API 宽松：安装包体积更大）。 */
const DOWNLOAD_TIMEOUT = 120_000;
/** 自动恢复的最大次数。 */
const MAX_RESTORE = 3;
/** 自动恢复的延迟。 */
const RESTORE_DELAY = 2_000;
/** 节点列表缓存时长。 */
const NODE_CACHE_TTL = 3_600_000;
const USER_AGENT = "FusionMC-Core (TerracottaTransport)";
// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function msgOf(e) {
    return e instanceof Error ? e.message : String(e);
}
function defaultPlayerName() {
    const host = os_1.default.hostname().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 10) || "Player";
    return `FusionMC-${host}`;
}
/** 空状态（初始 / 停止后）。 */
function emptyState() {
    return {
        running: false,
        mode: null,
        roomCode: "",
        virtualIP: "",
        guestPort: 25565,
        gamePort: 25565,
        state: null,
        profiles: [],
        difficulty: null,
        errorType: null,
        errorMessage: null,
    };
}
const ERROR_MESSAGES = {
    "no-such-room": "房间不存在，请确认房间码是否正确",
    "room-not-found": "房间不存在，请确认房间码是否正确",
    "invalid-room-code": "房间码格式无效",
    "room-full": "房间已满，无法加入",
    "host-not-online": "主机已离线",
    "host-banned": "你已被主机封禁",
    banned: "你已被主机封禁",
    "version-mismatch": "双方 Terracotta 版本不一致，请升级到同一版本",
    "network-error": "网络错误，请检查网络后重试",
    "network-unreachable": "无法连通公共节点，请稍后重试",
    "node-error": "公共节点异常，请更换节点重试",
    "no-available-node": "暂无可用公共节点，请稍后重试",
    "scan-timeout": "扫描公共节点超时",
    timeout: "连接超时，请稍后重试",
    "guest-rejected": "主机拒绝了你的加入请求",
};
/**
 * 发一个 GET 请求（可跟随重定向）。
 * @param url 目标地址
 * @param timeoutMs 单次请求超时
 * @param maxRedirect 允许的最大重定向跳数
 * @param onProgress 下载进度回调
 */
function rawGet(url, timeoutMs, maxRedirect = 0, onProgress) {
    return new Promise((resolve, reject) => {
        let u;
        try {
            u = new URL(url);
        }
        catch (e) {
            reject((0, transport_1.transportError)(`下载源地址非法：${url}`, e));
            return;
        }
        const mod = u.protocol === "https:" ? https_1.default : http_1.default;
        const req = mod.request({
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port || undefined,
            path: `${u.pathname}${u.search}`,
            method: "GET",
            headers: { "user-agent": USER_AGENT, accept: "*/*" },
            timeout: timeoutMs,
        }, (res) => {
            const status = res.statusCode ?? 0;
            const loc = res.headers.location;
            if (status >= 300 && status < 400 && loc && maxRedirect > 0) {
                res.resume();
                resolve(rawGet(new URL(loc, url).toString(), timeoutMs, maxRedirect - 1, onProgress));
                return;
            }
            const total = Number(res.headers["content-length"] ?? 0) || 0;
            const chunks = [];
            let received = 0;
            res.on("data", (chunk) => {
                chunks.push(chunk);
                received += chunk.length;
                onProgress?.({ received, total });
            });
            res.on("end", () => resolve({ status, body: Buffer.concat(chunks), headers: res.headers }));
            res.on("error", reject);
        });
        req.on("timeout", () => req.destroy((0, transport_1.transportError)(`请求超时：${url}`)));
        req.on("error", reject);
        req.end();
    });
}
// ---------------------------------------------------------------------------
// 平台 / 二进制
// ---------------------------------------------------------------------------
/** 当前平台的 Terracotta 包架构名。 */
function detectArch(platform = process.platform, arch = process.arch) {
    if (platform === "win32")
        return "windows-x86_64";
    if (platform === "darwin")
        return "macos-arm64";
    return arch === "arm64" ? "linux-arm64" : "linux-x86_64";
}
/** 按顺序尝试的多源下载地址（国内镜像优先，官方 GitHub 兜底）。 */
function downloadSources(version, arch) {
    const pkg = `terracotta-${version}-${arch}-pkg.tar.gz`;
    return [
        `https://gitee.com/burningtnt/Terracotta/releases/download/v${version}/${pkg}`,
        `https://cnb.cool/HMCL-Terracotta/Terracotta/-/releases/download/v${version}/${pkg}`,
        `https://cdn.jsdelivr.net/gh/burningtnt/Terracotta@v${version}/${pkg}`,
        `https://ghfast.top/https://github.com/burningtnt/Terracotta/releases/download/v${version}/${pkg}`,
        `https://mirror.ghproxy.com/https://github.com/burningtnt/Terracotta/releases/download/v${version}/${pkg}`,
        `https://github.com/burningtnt/Terracotta/releases/download/v${version}/${pkg}`,
    ];
}
/** 判断某个文件名是否可能是 Terracotta 可执行文件。 */
function isTerracottaBinary(name, windows) {
    const lower = name.toLowerCase();
    if (windows) {
        if (!lower.endsWith(".exe"))
            return false;
        if (lower === "terracotta.exe")
            return true;
        if (lower.includes("terracotta"))
            return true;
        return /^terracotta-[\d.]+.*\.exe$/i.test(lower);
    }
    // 非 Windows：排除压缩包/库/文档等明显不是可执行文件的东西
    if (/\.(tar\.gz|tgz|zip|dll|so|dylib|txt|md|json|sig)$/i.test(lower))
        return false;
    return lower === "terracotta" || lower.includes("terracotta");
}
/** 递归查找已解包的 Terracotta 可执行文件（同步，供 isInstalled 使用）。 */
function findBinarySync(dir, depth = 0) {
    if (depth > 4 || !(0, fs_1.existsSync)(dir))
        return null;
    let entries;
    try {
        entries = (0, fs_1.readdirSync)(dir);
    }
    catch {
        return null;
    }
    const windows = process.platform === "win32";
    for (const name of entries) {
        const full = path_1.default.join(dir, name);
        let isDir = false;
        try {
            isDir = (0, fs_1.statSync)(full).isDirectory();
        }
        catch {
            continue;
        }
        if (isDir) {
            const nested = findBinarySync(full, depth + 1);
            if (nested)
                return nested;
            continue;
        }
        if (isTerracottaBinary(name, windows))
            return full;
    }
    return null;
}
/** 从端口文件内容里取出控制端口（数字 / 对象 / 数字字符串都支持）。 */
function extractPort(data) {
    const asPort = (v) => {
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
        return Number.isInteger(n) && n > 0 && n < 65536 ? n : 0;
    };
    const direct = asPort(data);
    if (direct)
        return direct;
    if (data && typeof data === "object") {
        const o = data;
        for (const key of ["port", "http_port", "httpPort", "http"]) {
            const p = asPort(o[key]);
            if (p)
                return p;
        }
    }
    return 0;
}
// ---------------------------------------------------------------------------
// 纯函数（导出，便于测试）
// ---------------------------------------------------------------------------
/**
 * 生成 6 位房间码（本地预生成 / 测试用；实际房间码由 Terracotta 返回）。
 * 字符集 32 个字符，`byte & 31` 均匀映射，无取模偏差。
 */
function generateRoomCode() {
    const bytes = (0, crypto_1.randomBytes)(6);
    let out = "";
    for (let i = 0; i < 6; i++)
        out += exports.ROOM_CODE_CHARSET[bytes[i] & 31];
    return out;
}
/**
 * 归一化房间码：去空格 / 去横线 / 转大写。
 * 长度不在 4~8 或含非法字符时返回空串（上层据此判定输入非法）。
 */
function normalizeRoomCode(input) {
    if (typeof input !== "string")
        return "";
    const s = input.replace(/[\s-]/g, "").toUpperCase();
    return /^[A-Z0-9]{4,8}$/.test(s) ? s : "";
}
/**
 * 从节点列表里挑选可用的公共节点 URL。
 * @param list 节点列表（`{ url, region? }`）
 * @param zh 是否中文环境（中文环境只保留 `region === "CN"` 的节点）
 */
function pickNodes(list, zh) {
    const items = Array.isArray(list) ? list : [];
    const valid = items.filter((n) => n && typeof n.url === "string" && /^https?:\/\//i.test(n.url.trim()));
    const urls = (arr) => {
        const seen = new Set();
        const out = [];
        for (const n of arr) {
            const u = n.url.trim();
            if (!seen.has(u)) {
                seen.add(u);
                out.push(u);
            }
        }
        return out;
    };
    if (valid.length === 0)
        return [...exports.DEFAULT_NODES];
    if (zh) {
        const cn = urls(valid.filter((n) => (n.region ?? "").toUpperCase() === "CN"));
        return cn.length > 0 ? cn : [...exports.DEFAULT_NODES];
    }
    const all = urls(valid);
    return all.length > 0 ? all : [...exports.DEFAULT_NODES];
}
/** 当前是否为中文（简体）环境：时区上海/重庆，或语言以 zh 开头。 */
function isZhLocale() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
        if (/Shanghai|Chongqing/i.test(tz))
            return true;
    }
    catch {
        /* 某些环境没有 Intl，忽略 */
    }
    const langs = [
        process.env.LC_ALL,
        process.env.LC_MESSAGES,
        process.env.LANGUAGE,
        process.env.LANG,
    ]
        .filter((v) => typeof v === "string" && v.length > 0)
        .join(",");
    return /(^|[,.\s])zh/i.test(langs);
}
/** 从 `state.room` 里取房间码：字符串 / 数字 / `{ code }` 对象。 */
function extractRoomCode(raw) {
    if (typeof raw === "string")
        return normalizeRoomCode(raw) || raw.trim();
    if (typeof raw === "number" && Number.isFinite(raw))
        return String(raw);
    if (raw && typeof raw === "object") {
        const o = raw;
        const c = o.code ?? o.room ?? o.roomCode ?? o.id;
        if (typeof c === "string")
            return normalizeRoomCode(c) || c.trim();
        if (typeof c === "number" && Number.isFinite(c))
            return String(c);
    }
    return "";
}
/**
 * 解析 Terracotta `/state` 的返回体（纯函数）。
 *
 * 典型形态：
 *  - 主机成功：`{ state: "host-ok", room: "ABCDEF" | { code: "ABCDEF" } }`
 *  - 客体成功：`{ state: "guest-ok", url: "10.1.2.3:25565" }`
 *  - 异常：    `{ state: "exception", type: "no-such-room" }`
 */
function parseStatePayload(json) {
    if (!json || typeof json !== "object")
        return {};
    const o = json;
    const out = {};
    if (typeof o.state === "string")
        out.state = o.state;
    const room = extractRoomCode(o.room);
    if (room)
        out.roomCode = room;
    if (typeof o.url === "string" && o.url.trim()) {
        const url = o.url.trim();
        // guest-ok 的 url 形如 `host:port`；无端口时按 MC 默认 25565 处理
        out.virtualIP = url;
        const m = url.match(/:(\d+)$/);
        out.guestPort = m ? Number(m[1]) : 25565;
    }
    if (Array.isArray(o.profiles))
        out.profiles = o.profiles;
    if (typeof o.difficulty === "string")
        out.difficulty = o.difficulty;
    if (out.state === "exception") {
        const rawType = typeof o.type === "string"
            ? o.type
            : typeof o.error === "string"
                ? o.error
                : "unknown";
        out.errorType = rawType;
        out.errorMessage =
            ERROR_MESSAGES[rawType] ??
                ERROR_MESSAGES[rawType.toLowerCase()] ??
                `联机失败（错误码：${rawType}）`;
    }
    return out;
}
/**
 * 「说明性」Tunnel —— Terracotta 是虚拟局域网语义，不存在字节流。
 *
 * 它的存在只为把「连哪里」告诉上层（`info.addr` 即虚拟地址）；
 * `write()` 一律抛错，避免上层误以为可以像 WebRTC/Relay 那样桥接字节。
 */
class VirtualLanTunnel extends events_1.EventEmitter {
    info;
    log;
    constructor(info, log) {
        super();
        this.info = info;
        this.log = log;
    }
    /** 说明：Terracotta 不提供字节流，请直接在游戏内连接 info.addr。 */
    write(_chunk) {
        throw (0, transport_1.transportError)(`Terracotta 为虚拟局域网模式，请直接在游戏内连接 ${this.info.addr}`);
    }
    close() {
        this.log.debug("关闭 Terracotta 虚拟局域网会话");
        this.emit("close");
    }
}
/**
 * 主机句柄。
 *
 * `connectionInfo` 是**实时 getter**：`host()` 通常已经等到 `host-ok`，因此返回时即可用；
 * 若极端情况下还未拿到房间码，getter 返回空串，可 `await whenReady()` 等待补齐。
 */
class TerracottaHostHandle {
    getRoom;
    ready;
    onClose;
    log;
    constructor(getRoom, ready, onClose, log) {
        this.getRoom = getRoom;
        this.ready = ready;
        this.onClose = onClose;
        this.log = log;
    }
    /** 房间码（可直接分享给朋友）。 */
    get connectionInfo() {
        return this.getRoom();
    }
    /** 等待房间码就绪（已就绪时立即返回）。 */
    whenReady() {
        return this.ready;
    }
    /**
     * Terracotta 主机侧无需 Tunnel 回调：游戏自己监听 LAN 端口，
     * 虚拟网卡把对端流量直接送到本机，不存在「对端建链」事件。
     */
    onTunnel(_cb) {
        this.log.debug("Terracotta 为虚拟局域网模式，主机侧无 Tunnel 回调（由游戏自身监听 LAN 端口）");
    }
    /** 关闭房间（等价于 stop()）。 */
    close() {
        this.onClose();
    }
}
exports.TerracottaHostHandle = TerracottaHostHandle;
class TerracottaTransport {
    id = "terracotta";
    name = "Terracotta P2P（免公网 IP）";
    remoteServer = exports.NODE_LIST_URL;
    log;
    binDir;
    version;
    timeoutMs;
    proc = null;
    binPath = null;
    httpPort = null;
    workDir = null;
    portFile = null;
    logPath = null;
    logBytes = 0;
    nodesCache = null;
    savedMode = null;
    restoreCount = 0;
    restoreTimer = null;
    stopping = false;
    st = emptyState();
    constructor(opts = {}) {
        this.log = opts.log ?? new logger_1.Logger("info");
        this.binDir = opts.binDir ?? path_1.default.join(os_1.default.homedir(), ".fusionmc", "terracotta");
        this.version = opts.version ?? exports.DEFAULT_VERSION;
        this.timeoutMs = opts.timeoutMs ?? HTTP_TIMEOUT;
    }
    /** 二进制是否已就绪。 */
    isInstalled() {
        return this.findInstalledBinary() !== null;
    }
    /** 当前状态快照。 */
    state() {
        return { ...this.st, running: this.isRunning(), profiles: [...this.st.profiles] };
    }
    // ---- 进程状态 ----------------------------------------------------------
    isRunning() {
        return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
    }
    findInstalledBinary() {
        if (this.binPath && (0, fs_1.existsSync)(this.binPath))
            return this.binPath;
        const found = findBinarySync(this.binDir);
        if (found)
            this.binPath = found;
        return found;
    }
    // ---- 下载 --------------------------------------------------------------
    /**
     * 下载并解包 Terracotta 二进制（多源顺序尝试）。
     * 成功判定：HTTP 2xx 且响应体 > 10000 字节。
     * @returns 可执行文件的绝对路径
     */
    async download(onProgress) {
        const arch = detectArch();
        const sources = downloadSources(this.version, arch);
        await (0, promises_1.mkdir)(this.binDir, { recursive: true });
        let lastErr = null;
        for (const url of sources) {
            try {
                const host = new URL(url).host;
                this.log.info(`下载 Terracotta（${this.version}/${arch}）：${host}`);
                const res = await rawGet(url, DOWNLOAD_TIMEOUT, 5, onProgress);
                if (res.status < 200 || res.status >= 300) {
                    throw new Error(`HTTP ${res.status}`);
                }
                if (res.body.length <= 10_000) {
                    throw new Error(`包体过小（${res.body.length} 字节），疑似错误页`);
                }
                const pkgPath = path_1.default.join(this.binDir, `terracotta-${this.version}-${arch}-pkg.tar.gz`);
                await (0, promises_1.writeFile)(pkgPath, res.body);
                await this.extract(pkgPath);
                let bin = findBinarySync(this.binDir);
                if (!bin)
                    throw new Error("解包后未找到 terracotta 可执行文件");
                if (process.platform === "win32") {
                    bin = await this.collectWindowsDeps(bin);
                }
                else {
                    await (0, promises_1.chmod)(bin, 0o755);
                }
                this.binPath = bin;
                this.log.info(`Terracotta 安装完成：${bin}`);
                return bin;
            }
            catch (e) {
                lastErr = e;
                this.log.warn(`下载源不可用（${new URL(url).host}）：${msgOf(e)}`);
            }
        }
        throw (0, transport_1.transportError)("Terracotta 下载失败：所有镜像均不可用", lastErr);
    }
    /** tar -xzf 解包（30s 超时）。 */
    extract(pkgPath) {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)("tar", ["-xzf", pkgPath, "-C", this.binDir], {
                stdio: ["ignore", "ignore", "pipe"],
                windowsHide: true,
            });
            const timer = setTimeout(() => {
                try {
                    child.kill();
                }
                catch {
                    /* ignore */
                }
                reject((0, transport_1.transportError)("解包 Terracotta 超时"));
            }, 30_000);
            child.stderr?.on("data", (b) => this.log.debug(`tar: ${b.toString().trim()}`));
            child.on("error", (e) => {
                clearTimeout(timer);
                reject((0, transport_1.transportError)("无法执行 tar 解包", e));
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                if (code === 0)
                    resolve();
                else
                    reject((0, transport_1.transportError)(`tar 解包失败（code=${code}）`));
            });
        });
    }
    /** Windows：把 exe 和同目录的 .dll 一起搬到 binDir 根，保证路径稳定。 */
    async collectWindowsDeps(bin) {
        const dir = path_1.default.dirname(bin);
        if (path_1.default.resolve(dir) === path_1.default.resolve(this.binDir))
            return bin;
        const target = path_1.default.join(this.binDir, path_1.default.basename(bin));
        await (0, promises_1.copyFile)(bin, target);
        try {
            for (const name of (0, fs_1.readdirSync)(dir)) {
                if (name.toLowerCase().endsWith(".dll")) {
                    await (0, promises_1.copyFile)(path_1.default.join(dir, name), path_1.default.join(this.binDir, name));
                }
            }
        }
        catch (e) {
            this.log.warn(`拷贝 Terracotta 依赖 DLL 失败：${msgOf(e)}`);
        }
        return target;
    }
    // ---- 公共节点 ----------------------------------------------------------
    /** 拉取公共节点（1 小时缓存，失败回退 DEFAULT_NODES）。 */
    async fetchNodes() {
        if (this.nodesCache && Date.now() - this.nodesCache.at < NODE_CACHE_TTL) {
            return [...this.nodesCache.list];
        }
        const zh = isZhLocale();
        let list = [...exports.DEFAULT_NODES];
        try {
            const res = await rawGet(exports.NODE_LIST_URL, 8_000, 2);
            if (res.status < 200 || res.status >= 300)
                throw new Error(`HTTP ${res.status}`);
            const json = JSON.parse(res.body.toString("utf8"));
            const arr = Array.isArray(json)
                ? json
                : Array.isArray(json?.nodes)
                    ? json.nodes
                    : Array.isArray(json?.data)
                        ? json.data
                        : [];
            const parsed = arr
                .filter((v) => !!v && typeof v === "object")
                .map((v) => ({
                url: typeof v.url === "string" ? v.url : "",
                region: typeof v.region === "string" ? v.region : undefined,
            }))
                .filter((v) => v.url.length > 0);
            list = pickNodes(parsed, zh);
        }
        catch (e) {
            this.log.warn(`获取公共节点失败，使用默认节点：${msgOf(e)}`);
        }
        this.nodesCache = { at: Date.now(), list };
        return [...list];
    }
    // ---- 生命周期 ----------------------------------------------------------
    /**
     * 确保有一个可用的 Terracotta 进程。
     * 1) 已有进程且连续 3 次 `GET /state` 成功 → 复用；
     * 2) 否则清理僵尸进程后重新拉起。
     */
    async ensureStarted() {
        if (this.httpPort && this.isRunning()) {
            let ok = true;
            for (let i = 0; i < 3; i++) {
                try {
                    await rawGet(`http://127.0.0.1:${this.httpPort}/state`, 2_000);
                }
                catch {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                this.log.debug(`复用已运行的 Terracotta（控制端口 ${this.httpPort}）`);
                return;
            }
            this.log.warn("Terracotta 无响应，重启进程");
            await this.kill();
        }
        await this.killZombies();
        const bin = this.findInstalledBinary();
        if (!bin) {
            throw (0, transport_1.transportError)("Terracotta 未安装，请先调用 download()");
        }
        this.workDir = await (0, promises_1.mkdtemp)(path_1.default.join(os_1.default.tmpdir(), "fusionmc-terracotta-"));
        this.portFile = path_1.default.join(this.workDir, "http");
        this.logPath = path_1.default.join(this.workDir, "terracotta.log");
        this.logBytes = 0;
        this.stopping = false;
        this.log.info(`启动 Terracotta：${bin} --hmcl ${this.portFile}`);
        const proc = (0, child_process_1.spawn)(bin, ["--hmcl", this.portFile], {
            cwd: this.workDir,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        this.proc = proc;
        proc.stdout?.setEncoding("utf8");
        proc.stderr?.setEncoding("utf8");
        proc.stdout?.on("data", (s) => this.appendLog("out", s));
        proc.stderr?.on("data", (s) => this.appendLog("err", s));
        proc.on("error", (e) => this.log.error(`Terracotta 进程错误：${e.message}`));
        proc.on("close", (code) => this.onClose(code));
        try {
            this.httpPort = await this.waitPortFile();
            this.log.info(`Terracotta 控制端口就绪：${this.httpPort}`);
        }
        catch (e) {
            await this.kill();
            throw e;
        }
    }
    /** 干掉历史遗留的 terracotta 进程（避免端口/房间冲突）。 */
    async killZombies() {
        try {
            if (process.platform === "win32") {
                (0, child_process_1.spawnSync)("taskkill", ["/F", "/IM", "terracotta.exe"], { windowsHide: true });
            }
            else {
                (0, child_process_1.spawnSync)("pkill", ["-f", "terracotta"], { windowsHide: true });
            }
        }
        catch (e) {
            this.log.debug(`清理僵尸进程跳过：${msgOf(e)}`);
        }
        await sleep(500);
    }
    /** 轮询端口文件，直到 Terracotta 写入可用的控制端口。 */
    async waitPortFile() {
        const file = this.portFile;
        if (!file)
            throw (0, transport_1.transportError)("端口文件路径未初始化");
        const start = Date.now();
        while (Date.now() - start < PORT_FILE_TIMEOUT) {
            if (!this.isRunning()) {
                throw (0, transport_1.transportError)("Terracotta 进程已退出，未写入控制端口");
            }
            try {
                const raw = await (0, promises_1.readFile)(file, "utf8");
                const port = extractPort(JSON.parse(raw));
                if (port)
                    return port;
            }
            catch {
                /* 端口文件尚未写好 / JSON 未写完，静默继续等待 */
            }
            await sleep(POLL_INTERVAL);
        }
        throw (0, transport_1.transportError)("等待 Terracotta 控制端口超时（30s）");
    }
    /** 进程退出：异常退出且已保存模式时，2s 后自动恢复（最多 3 次）。 */
    onClose(code) {
        const wasRunning = this.proc !== null;
        this.proc = null;
        this.httpPort = null;
        this.st.running = false;
        if (!wasRunning || this.stopping)
            return;
        if (code === 0) {
            this.log.info("Terracotta 已正常退出");
            return;
        }
        const saved = this.savedMode;
        if (!saved || this.restoreCount >= MAX_RESTORE)
            return;
        this.restoreCount++;
        this.log.warn(`Terracotta 异常退出（code=${code}），${RESTORE_DELAY}ms 后进行第 ${this.restoreCount} 次恢复`);
        this.restoreTimer = setTimeout(() => {
            this.restoreTimer = null;
            void this.restore(saved).catch((e) => this.log.error(`Terracotta 恢复失败：${msgOf(e)}`));
        }, RESTORE_DELAY);
    }
    /** 按保存的模式重放（主机重新开房 / 客体重新加入）。 */
    async restore(saved) {
        await this.ensureStarted();
        if (saved.mode === "host")
            await this.beginHost(saved.name, saved.gamePort);
        else
            await this.beginGuest(saved.roomCode, saved.name);
        this.log.info("Terracotta 自动恢复完成");
    }
    /** 结束进程并清理临时目录。 */
    async kill() {
        const proc = this.proc;
        this.proc = null;
        this.httpPort = null;
        if (!proc)
            return;
        const closed = new Promise((resolve) => proc.once("close", () => resolve()));
        try {
            proc.kill();
        }
        catch {
            /* 已退出 */
        }
        const force = setTimeout(() => {
            try {
                if (process.platform === "win32" && proc.pid) {
                    (0, child_process_1.spawnSync)("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { windowsHide: true });
                }
                else {
                    proc.kill("SIGKILL");
                }
            }
            catch {
                /* ignore */
            }
        }, 3_000);
        await Promise.race([closed, sleep(5_000)]);
        clearTimeout(force);
    }
    /** 追加日志到临时日志文件（超过 LOG_ROTATE 轮转）。 */
    appendLog(channel, chunk) {
        const text = chunk.replace(/\s+$/, "");
        if (!text)
            return;
        if (channel === "err")
            this.log.warn(`[terracotta] ${text}`);
        else
            this.log.debug(`[terracotta] ${text}`);
        if (!this.logPath)
            return;
        const buf = Buffer.from(`${text}\n`, "utf8");
        this.logBytes += buf.length;
        if (this.logBytes > LOG_ROTATE) {
            const rotated = `${this.logPath}.1`;
            const src = this.logPath;
            this.logBytes = 0;
            void (0, promises_1.rename)(src, rotated)
                .then(() => (0, promises_1.writeFile)(src, ""))
                .catch(() => undefined);
        }
        void (0, promises_1.appendFile)(this.logPath, buf).catch(() => undefined);
    }
    // ---- 本地控制 API（127.0.0.1） ----------------------------------------
    /**
     * GET 控制接口（默认重试 5 次，退避 min(200 * 1.5^n, 2000)）。
     * 空 body 视为成功（Terracotta 的 `/state/scanning` 等接口返回 200 空体）。
     */
    async apiGet(pathAndQuery, opts = {}) {
        if (!this.httpPort)
            throw (0, transport_1.transportError)("Terracotta 控制端口尚未就绪");
        const retries = opts.retries ?? API_RETRIES;
        const url = `http://127.0.0.1:${this.httpPort}${pathAndQuery}`;
        let lastErr = null;
        for (let i = 0; i <= retries; i++) {
            try {
                const res = await rawGet(url, opts.timeoutMs ?? this.timeoutMs);
                if (res.status >= 200 && res.status < 300)
                    return res.body.toString("utf8");
                lastErr = new Error(`HTTP ${res.status}`);
            }
            catch (e) {
                lastErr = e;
            }
            if (i < retries)
                await sleep(Math.min(200 * Math.pow(1.5, i), 2_000));
        }
        throw (0, transport_1.transportError)(`Terracotta 控制接口请求失败：${pathAndQuery}`, lastErr);
    }
    /** 轮询 `/state`，直到满足条件（或异常 / 超时）。 */
    async waitState(done, timeoutMs = START_TIMEOUT) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            let body = null;
            try {
                body = await this.apiGet("/state", {
                    retries: 0,
                    timeoutMs: Math.min(this.timeoutMs, 5_000),
                });
            }
            catch {
                body = null;
            }
            if (body !== null) {
                let payload = null;
                if (body.trim()) {
                    try {
                        payload = JSON.parse(body);
                    }
                    catch {
                        payload = null;
                    }
                }
                const patch = parseStatePayload(payload);
                const next = {
                    ...this.st,
                    ...patch,
                    running: this.isRunning(),
                    errorType: patch.errorType ?? null,
                    errorMessage: patch.errorMessage ?? null,
                };
                this.st = next;
                if (next.state === "exception") {
                    throw (0, transport_1.transportError)(next.errorMessage ?? "Terracotta 联机异常");
                }
                if (done(next.state))
                    return;
            }
            await sleep(POLL_INTERVAL);
        }
        throw (0, transport_1.transportError)("等待 Terracotta 状态超时（30s）");
    }
    /** 主机：请求扫描公共节点并等待 host-ok。 */
    async beginHost(name, gamePort) {
        const nodes = await this.fetchNodes();
        const q = new URLSearchParams();
        q.append("player", name);
        for (const n of nodes)
            q.append("public_nodes", n); // 数组用重复 key 追加
        await this.apiGet(`/state/scanning?${q.toString()}`);
        this.st.mode = "host";
        this.st.gamePort = gamePort;
        await this.waitState((s) => s === "host-ok");
        if (!this.st.roomCode)
            throw (0, transport_1.transportError)("Terracotta 未返回房间码");
        this.log.info(`Terracotta 房间已就绪：${this.st.roomCode}（游戏端口 ${gamePort}）`);
    }
    /** 客体：请求加入房间并等待 guest-ok。 */
    async beginGuest(roomCode, name) {
        const nodes = await this.fetchNodes();
        const q = new URLSearchParams();
        q.append("room", roomCode);
        q.append("player", name);
        for (const n of nodes)
            q.append("public_nodes", n);
        await this.apiGet(`/state/guesting?${q.toString()}`);
        this.st.mode = "guest";
        this.st.roomCode = roomCode;
        await this.waitState((s) => s === "guest-ok");
        this.log.info(`Terracotta 已加入房间 ${roomCode}，虚拟地址 ${this.st.virtualIP}`);
    }
    // ---- Transport ---------------------------------------------------------
    /**
     * 开房间。
     *
     * Terracotta 是虚拟局域网：主机侧只要把游戏「开放到 LAN」，虚拟网卡会把对端的
     * 游戏流量直接递到本机 LAN 端口，无需 GameBridge。
     */
    async host(opts) {
        const name = opts.name?.trim() || defaultPlayerName();
        await this.ensureStarted();
        this.restoreCount = 0;
        this.savedMode = { mode: "host", gamePort: opts.gamePort, roomCode: "", name };
        await this.beginHost(name, opts.gamePort);
        this.savedMode.roomCode = this.st.roomCode;
        const ready = this.waitRoomCode();
        return new TerracottaHostHandle(() => this.st.roomCode, ready, () => {
            void this.stop();
        }, this.log);
    }
    /** 等待房间码（正常情况 host() 返回时已就绪，这里只是兜底）。 */
    async waitRoomCode() {
        const start = Date.now();
        while (!this.st.roomCode && Date.now() - start < START_TIMEOUT) {
            await sleep(POLL_INTERVAL);
        }
        return this.st.roomCode;
    }
    /**
     * 加入房间。
     *
     * 注意：Terracotta 提供的是虚拟网卡而非字节流，因此这里返回的 Tunnel 只是
     * 「说明性」对象 —— `info.addr` 为虚拟地址，`write()` 会抛错提示
     * 「请直接在游戏内连接 {addr}」。上层不应把它接到 GameBridge 上。
     */
    async join(opts) {
        const roomCode = normalizeRoomCode(opts.connectionInfo) || opts.connectionInfo.trim();
        if (!roomCode)
            throw (0, transport_1.transportError)("房间码无效，请检查输入");
        const name = opts.name?.trim() || defaultPlayerName();
        await this.ensureStarted();
        this.restoreCount = 0;
        this.savedMode = { mode: "guest", gamePort: 25565, roomCode, name };
        await this.beginGuest(roomCode, name);
        if (!this.st.virtualIP)
            throw (0, transport_1.transportError)("Terracotta 未返回虚拟地址，无法加入房间");
        const info = {
            id: roomCode,
            name,
            addr: this.st.virtualIP,
            via: "terracotta",
        };
        this.log.info(`请在 Minecraft 中直接连接 ${info.addr}`);
        return new VirtualLanTunnel(info, this.log);
    }
    /** 停止：杀掉进程、清理临时目录、重置状态。 */
    async stop() {
        this.stopping = true;
        this.savedMode = null;
        this.restoreCount = 0;
        if (this.restoreTimer) {
            clearTimeout(this.restoreTimer);
            this.restoreTimer = null;
        }
        await this.kill();
        if (this.workDir) {
            const dir = this.workDir;
            this.workDir = null;
            await (0, promises_1.rm)(dir, { recursive: true, force: true }).catch(() => undefined);
        }
        this.portFile = null;
        this.logPath = null;
        this.st = emptyState();
        this.stopping = false;
        this.log.info("Terracotta 已停止");
    }
}
exports.TerracottaTransport = TerracottaTransport;
//# sourceMappingURL=terracotta.js.map