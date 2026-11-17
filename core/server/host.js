"use strict";
/**
 * 一键开服务器（Server Host）—— 参考 VersePC（GPL-3.0）实现思路。
 *
 * 目标：给定一个已安装（或仅有版本号）的版本，一键把「原版 / Forge / NeoForge / Fabric 服务端」
 * 落盘、配好 eula 与 server.properties、同步客户端 mods，并能启动 / 发命令 / 停止 / 删除。
 *
 * 关键设计（与 VersePC 对齐）：
 *  - 目录与索引：rootDir/index.json 记录所有服务器，每个服务器一个子目录；
 *  - 服务端 jar：downloads.server + 多镜像候选（BMCLAPI 兜底 URL），聚合下载带 sha1 校验；
 *  - 模组端：从 version.libraries 判定加载器，下载 installer 后 spawn java 完成安装；
 *  - 启动：端口探测避让、按 launchKind 拼命令、JVM 参数固定为 G1GC 一套、
 *    readline 逐行转发日志并按关键字判定 running / Java 版本过低。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerHost = void 0;
exports.serverPropertiesDefaults = serverPropertiesDefaults;
exports.sanitizeServerName = sanitizeServerName;
exports.detectLaunchKindFromFiles = detectLaunchKindFromFiles;
exports.requiredJavaMajor = requiredJavaMajor;
exports.renderServerProperties = renderServerProperties;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const net_1 = require("net");
const path_1 = require("path");
const readline_1 = require("readline");
const util_1 = require("../core/util");
const aggregator_1 = require("../download/aggregator");
/** 启动脚本相关文件名（判优先级用）。 */
const LAUNCH_SCRIPTS = ["run.bat", "run.sh"];
/** 客户端专用 mod 提示词：这些 jar 只对客户端有意义，复制到服务端会崩。 */
const CLIENT_ONLY_MOD_HINTS = [
    "optifine",
    "sodium",
    "iris",
    "rubidium",
    "oculus",
    "modmenu",
    "journeymap",
    "xaero",
    "minimap",
    "litematica",
    "replaymod",
    "freecam",
    "bobby",
    "immediatelyfast",
    "entityculling",
    "sodiumextra",
    "reeses-sodium-options",
    "zoomify",
    "okzoomer",
    "shulkerbox",
    "betterf3",
    "capes",
];
/** server.properties 默认键值全集（顺序与 Mojang 生成的一致）。 */
const DEFAULT_PROPERTIES = [
    "enable-jmx-monitoring=false",
    "rcon.port=25575",
    "level-seed=",
    "gamemode=survival",
    "enable-command-block=false",
    "enable-query=false",
    "generator-settings={}",
    "level-name=world",
    "motd=A Minecraft Server",
    "query.port=25565",
    "pvp=true",
    "generate-structures=true",
    "difficulty=easy",
    "network-compression-threshold=256",
    "max-tick-time=60000",
    "require-resource-pack=false",
    "max-players=20",
    "use-native-transport=true",
    "online-mode=true",
    "enable-status=true",
    "allow-flight=false",
    "broadcast-rcon-to-ops=true",
    "view-distance=10",
    "server-ip=",
    "allow-nether=true",
    "server-port=25565",
    "enable-rcon=false",
    "sync-chunk-writes=true",
    "op-permission-level=4",
    "prevent-proxy-connections=false",
    "hide-online-players=false",
    "resource-pack=",
    "entity-broadcast-range-percentage=100",
    "simulation-distance=10",
    "player-idle-timeout=0",
    "force-gamemode=false",
    "rate-limit=0",
    "hardcore=false",
    "white-list=false",
    "broadcast-console-to-ops=true",
    "spawn-npcs=true",
    "spawn-animals=true",
    "function-permission-level=2",
    "initial-enabled-packs=vanilla",
    "level-type=minecraft\\:normal",
    "text-filtering-config=",
    "spawn-monsters=true",
    "enforce-whitelist=false",
    "spawn-protection=16",
    "resource-pack-sha1=",
    "max-world-size=29999984",
];
// ---------------------------------------------------------------------------
// 纯函数区（可单测）
// ---------------------------------------------------------------------------
/** 默认 server.properties 行（`key=value` 数组，顺序固定）。 */
function serverPropertiesDefaults() {
    return [...DEFAULT_PROPERTIES];
}
/** 清洗服务器名作为目录名：替换非法字符、压缩空白、截断 64 字符。 */
function sanitizeServerName(name) {
    let s = (name ?? "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    s = s.replace(/\s+/g, " ").trim();
    // Windows 不允许目录以点或空格结尾
    s = s.replace(/[. ]+$/g, "").trim();
    if (s.length > 64)
        s = s.slice(0, 64).trim();
    return s.length === 0 ? "MyServer" : s;
}
/** 按文件列表（可含路径）判定启动方式。 */
function detectLaunchKindFromFiles(files) {
    const names = files.map((f) => (0, path_1.basename)(f.replace(/\\/g, "/")).toLowerCase());
    if (names.some((n) => LAUNCH_SCRIPTS.includes(n)))
        return "run-script";
    if (names.includes("fabric-server-launch.jar"))
        return "fabric-launch";
    const forgeJar = files
        .map((f) => (0, path_1.basename)(f.replace(/\\/g, "/")))
        .find((n) => /^forge-.*\.jar$/i.test(n) &&
        !/installer/i.test(n) &&
        n.toLowerCase() !== "server.jar");
    if (forgeJar)
        return `forge-jar:${forgeJar}`;
    if (names.includes("server.jar"))
        return "server-jar";
    return "unknown";
}
/** 该 MC 版本建议的 Java 主版本（Verse 同款规则）。 */
function requiredJavaMajor(mcVersion) {
    const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec((mcVersion ?? "").trim());
    if (!m)
        return 17;
    const a = Number(m[1]);
    const b = m[2] === undefined ? 0 : Number(m[2]);
    const c = m[3] === undefined ? 0 : Number(m[3]);
    if (a >= 26)
        return 25; // 新版版本号方案（26.x）
    if (a === 1 && b >= 21)
        return 21; // 1.21+
    if (a === 1 && b === 20)
        return c >= 5 ? 21 : 17; // 1.20.5+ 起需要 21
    return 17; // 1.18+ 与更早（原版启动器统一 17）
}
/** motd 单行化（properties 不支持换行）。 */
function singleLine(value) {
    return (value ?? "").replace(/[\r\n]+/g, " ").trim();
}
/** 需要覆盖的关键键值。 */
function overrideEntries(spec, port) {
    const out = [];
    out.push(["server-port", String(port)]);
    out.push(["query.port", String(port)]);
    if (spec.motd !== undefined)
        out.push(["motd", singleLine(spec.motd)]);
    if (spec.onlineMode !== undefined)
        out.push(["online-mode", String(spec.onlineMode)]);
    out.push(["server-ip", ""]);
    if (spec.maxPlayers !== undefined)
        out.push(["max-players", String(spec.maxPlayers)]);
    if (spec.difficulty !== undefined)
        out.push(["difficulty", spec.difficulty]);
    if (spec.gamemode !== undefined)
        out.push(["gamemode", spec.gamemode]);
    if (spec.levelName !== undefined)
        out.push(["level-name", spec.levelName]);
    if (spec.viewDistance !== undefined)
        out.push(["view-distance", String(spec.viewDistance)]);
    return out;
}
/**
 * 渲染 server.properties。
 * - 不传 existing：输出默认全集 + 用户覆盖项；
 * - 传 existing：只改写关键键（`^key=`），其余行原样保留，缺失的关键键补在末尾。
 */
function renderServerProperties(spec, existing) {
    const port = spec.port ?? 25565;
    const overrides = new Map(overrideEntries(spec, port));
    if (existing === undefined) {
        const lines = serverPropertiesDefaults().map((line) => {
            const key = line.slice(0, line.indexOf("="));
            const v = overrides.get(key);
            return v === undefined ? line : `${key}=${v}`;
        });
        return lines.join("\n") + "\n";
    }
    const pending = new Set(overrides.keys());
    const out = [];
    for (const raw of existing.split(/\r?\n/)) {
        const m = /^([^#=][^=]*)=(.*)$/.exec(raw);
        if (!m) {
            out.push(raw);
            continue;
        }
        const key = m[1].trim();
        const v = overrides.get(key);
        if (v === undefined) {
            out.push(raw);
        }
        else {
            out.push(`${key}=${v}`);
            pending.delete(key);
        }
    }
    for (const [k, v] of overrides) {
        if (pending.has(k))
            out.push(`${k}=${v}`);
    }
    // 去掉尾部空行后补一个换行
    while (out.length > 0 && out[out.length - 1] === "")
        out.pop();
    return out.join("\n") + "\n";
}
/** 判定版本链上的加载器类型。 */
function detectModLoader(chain) {
    for (const v of chain) {
        for (const lib of v.libraries ?? []) {
            const n = lib.name ?? "";
            if (n.startsWith("net.minecraftforge:forge"))
                return "forge";
            if (n.startsWith("net.neoforged:neoforge"))
                return "neoforge";
            if (n.startsWith("net.fabricmc:fabric-loader"))
                return "fabric";
        }
    }
    return null;
}
/** 从 maven 坐标中取版本号（group:artifact:version[:classifier]）。 */
function libVersion(libName) {
    const parts = libName.split(":");
    return parts[2] ?? "";
}
/** 端口是否空闲（监听 0.0.0.0 探测）。 */
function isPortFree(port) {
    return new Promise((resolveP) => {
        const srv = (0, net_1.createServer)();
        srv.once("error", () => resolveP(false));
        srv.once("listening", () => {
            srv.close(() => resolveP(true));
        });
        try {
            srv.listen(port, "0.0.0.0");
        }
        catch {
            resolveP(false);
        }
    });
}
/** 从 port 起向上找一个空闲端口（最多 20 个），全忙则返回原端口。 */
async function findFreePort(port) {
    for (let i = 0; i < 20; i++) {
        const p = port + i;
        if (p > 65535)
            break;
        if (await isPortFree(p))
            return p;
    }
    return port;
}
/** Windows 强制结束整个进程树。 */
function killTree(pid) {
    return new Promise((resolveP) => {
        try {
            const p = (0, child_process_1.spawn)("taskkill", ["/PID", String(pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore",
            });
            p.once("close", () => resolveP());
            p.once("error", () => resolveP());
        }
        catch {
            resolveP();
        }
    });
}
/** 生成服务器 id：srv_<36进制时间戳>_<5 位随机>。 */
function genServerId() {
    const rand = Math.random().toString(36).slice(2, 7).padEnd(5, "0");
    return `srv_${Date.now().toString(36)}_${rand}`;
}
// ---------------------------------------------------------------------------
// ServerHost
// ---------------------------------------------------------------------------
class ServerHost {
    opts;
    rootDir;
    indexFile;
    entries = [];
    specs = new Map();
    statuses = new Map();
    runtimes = new Map();
    rootReady;
    constructor(opts) {
        this.opts = opts;
        this.rootDir = (0, path_1.resolve)(opts.rootDir);
        this.indexFile = (0, path_1.join)(this.rootDir, "index.json");
        void this.ensureRoot().catch(() => {
            /* 首次调用 create 时会再次尝试并抛出真实错误 */
        });
    }
    // --- 基础设施 ---------------------------------------------------------
    /** 初始化根目录与 index.json。 */
    async ensureRoot() {
        if (!this.rootReady) {
            this.rootReady = (async () => {
                await (0, util_1.ensureDirAsync)(this.rootDir);
                if ((0, util_1.pathExists)(this.indexFile)) {
                    try {
                        const raw = await fs_1.promises.readFile(this.indexFile, "utf-8");
                        const parsed = JSON.parse(raw);
                        this.entries.length = 0;
                        if (Array.isArray(parsed?.servers))
                            this.entries.push(...parsed.servers);
                    }
                    catch (e) {
                        this.opts.log.warn(`index.json 解析失败，已重置：${String(e)}`);
                        this.entries.length = 0;
                    }
                }
                await this.writeIndex();
            })();
        }
        return this.rootReady;
    }
    async writeIndex() {
        await (0, util_1.ensureDirAsync)(this.rootDir);
        const data = { servers: this.entries };
        const tmp = `${this.indexFile}.tmp-${process.pid}-${Date.now()}`;
        await fs_1.promises.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
        await fs_1.promises.rename(tmp, this.indexFile);
    }
    async upsertEntry(entry) {
        const i = this.entries.findIndex((e) => e.id === entry.id);
        if (i >= 0)
            this.entries[i] = entry;
        else
            this.entries.push(entry);
        await this.writeIndex();
    }
    setStatus(s) {
        this.statuses.set(s.id, s);
        try {
            this.opts.onStatus?.(s);
        }
        catch (e) {
            this.opts.log.warn(`onStatus 回调异常：${String(e)}`);
        }
    }
    emit(id, line, level) {
        try {
            this.opts.onLog?.({ id, line, level });
        }
        catch {
            /* 用户回调异常不影响主流程 */
        }
    }
    /** 读取版本链（自身 + inheritsFrom 父版本，最多 12 层）。 */
    async loadChain(versionId) {
        const chain = [];
        let cur = versionId;
        for (let depth = 0; depth < 12 && cur; depth++) {
            const v = await this.opts.manifest.loadVersionById(cur);
            chain.push(v);
            cur = v.inheritsFrom;
        }
        if (chain.length === 0)
            throw new Error(`无法解析版本: ${versionId}`);
        return chain;
    }
    /** 目录选择：自定义目录优先，否则用清洗后的名字（冲突时加 id 后缀）。 */
    pickDir(spec, id) {
        if (spec.dir && spec.dir.trim()) {
            return (0, path_1.resolve)(this.rootDir, spec.dir.trim());
        }
        const base = sanitizeServerName(spec.name);
        const first = (0, path_1.join)(this.rootDir, base);
        if (!(0, util_1.pathExists)(first) || !this.entries.some((e) => (0, path_1.resolve)(e.dir) === (0, path_1.resolve)(first))) {
            return first;
        }
        return `${first}-${id.slice(-5)}`;
    }
    // --- 创建 -------------------------------------------------------------
    /** 一键创建（安装）服务器。 */
    async create(spec) {
        await this.ensureRoot();
        if (!spec.versionId || !spec.versionId.trim()) {
            throw new Error("versionId 不能为空");
        }
        const id = genServerId();
        const name = (spec.name ?? "").trim() || "MyServer";
        const port = typeof spec.port === "number" && spec.port > 0 ? Math.floor(spec.port) : 25565;
        const dir = this.pickDir(spec, id);
        const now = Date.now();
        await (0, util_1.ensureDirAsync)(dir);
        const entry = {
            id,
            name,
            versionId: spec.versionId,
            port,
            dir,
            createdAt: now,
            updatedAt: now,
        };
        this.specs.set(id, { ...spec, name, port });
        await this.upsertEntry(entry);
        this.setStatus({ id, state: "installing", port, message: "正在安装服务端" });
        try {
            const chain = await this.loadChain(spec.versionId);
            const baseVersionId = chain[chain.length - 1].id;
            const loader = detectModLoader(chain);
            if (loader) {
                await this.installModded(loader, chain, baseVersionId, dir, id);
            }
            else {
                await this.installVanilla(chain, baseVersionId, dir, id);
            }
            await this.writeEula(dir);
            await this.writeProperties(dir, spec, port);
            await this.syncMods(dir, spec);
            const launchKind = await this.detectLaunchKind(dir);
            const javaMajor = requiredJavaMajor(baseVersionId);
            const updated = {
                ...entry,
                launchKind,
                javaMajor,
                updatedAt: Date.now(),
            };
            await this.upsertEntry(updated);
            this.opts.log.info(`服务器 ${name} 安装完成（${launchKind}）`);
            this.setStatus({ id, state: "ready", port, message: "安装完成" });
            return updated;
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.opts.log.error(`服务器 ${name} 安装失败：${message}`);
            this.setStatus({ id, state: "error", port, message });
            throw e;
        }
    }
    /** 原版：下载 server.jar。 */
    async installVanilla(chain, baseVersionId, dir, id) {
        let artifact;
        for (const v of chain) {
            if (v.downloads?.server?.url) {
                artifact = v.downloads.server;
                break;
            }
        }
        if (!artifact?.url)
            throw new Error(`版本 ${baseVersionId} 没有 downloads.server，无法开原版服`);
        const dest = (0, path_1.join)(dir, "server.jar");
        if (artifact.size && (0, util_1.pathExists)(dest)) {
            const st = await fs_1.promises.stat(dest).catch(() => null);
            if (st && st.size === artifact.size) {
                this.emit(id, `server.jar 已存在（${st.size} 字节），跳过下载`, "info");
                return;
            }
        }
        const urls = this.opts.mirrors.candidates(artifact.url);
        const fallback = `https://bmclapi2.bangbang93.com/version/${baseVersionId}/server`;
        if (!urls.includes(fallback))
            urls.push(fallback);
        this.emit(id, `开始下载服务端 jar（${urls.length} 个候选源）`, "info");
        const r = await (0, aggregator_1.aggregatedDownload)(urls, dest, {
            sha1: artifact.sha1,
            mode: "china-first",
            timeoutMs: 300_000,
            onLog: (level, msg) => this.emit(id, msg, level),
        });
        this.emit(id, `server.jar 就绪：${r.bytes} 字节${r.reused ? "（复用已有文件）" : ""}`, "info");
    }
    /** 模组端：下载 installer 并 spawn java 安装。 */
    async installModded(loader, chain, baseVersionId, dir, id) {
        const mcVersion = baseVersionId;
        let urls = [];
        let installerName = "";
        let installerArgs = [];
        if (loader === "forge" || loader === "neoforge") {
            let ver = "";
            for (const v of chain) {
                for (const lib of v.libraries ?? []) {
                    const n = lib.name ?? "";
                    if (loader === "forge" && n.startsWith("net.minecraftforge:forge"))
                        ver = libVersion(n);
                    if (loader === "neoforge" && n.startsWith("net.neoforged:neoforge"))
                        ver = libVersion(n);
                }
                if (ver)
                    break;
            }
            if (!ver)
                throw new Error(`版本 ${mcVersion} 中找不到 ${loader} 的版本号`);
            if (loader === "forge") {
                urls = [
                    `https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/${ver}/forge-${ver}-installer.jar`,
                    `https://maven.minecraftforge.net/net/minecraftforge/forge/${ver}/forge-${ver}-installer.jar`,
                ];
                installerName = `fusionmc-forge-${ver}-installer.jar`;
            }
            else {
                urls = [
                    `https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`,
                    `https://maven.neoforged.net/releases/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`,
                ];
                installerName = `fusionmc-neoforge-${ver}-installer.jar`;
            }
            installerArgs = ["--installServer"];
        }
        else {
            let loaderVer = "";
            for (const v of chain) {
                for (const lib of v.libraries ?? []) {
                    const n = lib.name ?? "";
                    if (n.startsWith("net.fabricmc:fabric-loader"))
                        loaderVer = libVersion(n);
                }
                if (loaderVer)
                    break;
            }
            if (!loaderVer)
                throw new Error(`版本 ${mcVersion} 中找不到 fabric-loader 版本号`);
            urls = [
                "https://bmclapi2.bangbang93.com/maven/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar",
                "https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar",
            ];
            installerName = "fusionmc-fabric-installer.jar";
            installerArgs = [
                "server",
                "-mcversion",
                mcVersion,
                "-loader",
                loaderVer,
                "-dir",
                dir,
                "-downloadMinecraft",
            ];
        }
        const installerPath = (0, path_1.join)(dir, installerName);
        this.emit(id, `下载 ${loader} 安装器…`, "info");
        const ok = await this.downloadInstaller(urls, installerPath, id);
        if (!ok)
            throw new Error(`${loader} 安装器下载失败（所有源）`);
        const required = requiredJavaMajor(mcVersion);
        const rt = await this.opts.java.resolve(required);
        this.emit(id, `使用 Java ${rt.major}（${rt.javaPath}）执行 ${loader} 安装`, "info");
        await this.runProcess(rt.javaPath, ["-jar", installerPath, ...installerArgs], dir, id, 900_000);
        this.emit(id, `${loader} 服务端安装完成`, "info");
    }
    /** 多源逐个试下载 installer，成功判据：文件 size > 1024。 */
    async downloadInstaller(urls, dest, id) {
        for (const url of urls) {
            try {
                await (0, aggregator_1.aggregatedDownload)([url], dest, {
                    mode: "auto",
                    timeoutMs: 300_000,
                    force: true,
                    onLog: (level, msg) => this.emit(id, msg, level),
                });
                const st = await fs_1.promises.stat(dest).catch(() => null);
                if (st && st.size > 1024)
                    return true;
            }
            catch (e) {
                this.emit(id, `安装器源失败：${url}（${e instanceof Error ? e.message : String(e)}）`, "warn");
            }
        }
        return false;
    }
    /** 运行子进程并把输出转发为日志，超时强杀。 */
    runProcess(cmd, args, cwd, id, timeoutMs) {
        return new Promise((resolveP, rejectP) => {
            const child = (0, child_process_1.spawn)(cmd, args, {
                cwd,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
                env: this.childEnv(cmd),
            });
            let timer;
            let settled = false;
            const finish = (err) => {
                if (settled)
                    return;
                settled = true;
                if (timer)
                    clearTimeout(timer);
                if (err)
                    rejectP(err);
                else
                    resolveP();
            };
            const pipe = (stream) => {
                const rl = (0, readline_1.createInterface)({ input: stream });
                rl.on("line", (line) => this.emit(id, line, "info"));
            };
            if (child.stdout)
                pipe(child.stdout);
            if (child.stderr)
                pipe(child.stderr);
            timer = setTimeout(() => {
                try {
                    child.kill("SIGKILL");
                }
                catch {
                    /* ignore */
                }
                finish(new Error(`安装进程超时（${Math.round(timeoutMs / 1000)}s）：${cmd}`));
            }, timeoutMs);
            child.once("error", (e) => finish(new Error(`无法启动安装进程：${e.message}`)));
            child.once("close", (code) => {
                if (code === 0)
                    finish();
                else
                    finish(new Error(`安装进程退出码 ${code}`));
            });
        });
    }
    /** eula.txt（已同意 EULA，否则服务端会直接退出）。 */
    async writeEula(dir) {
        await fs_1.promises.writeFile((0, path_1.join)(dir, "eula.txt"), "# Generated by FusionMC Server Host\neula=true\n", "utf-8");
    }
    /** 写 server.properties（首次全量，之后只改关键项）。 */
    async writeProperties(dir, spec, port) {
        const file = (0, path_1.join)(dir, "server.properties");
        const existing = (0, util_1.pathExists)(file)
            ? await fs_1.promises.readFile(file, "utf-8").catch(() => undefined)
            : undefined;
        await fs_1.promises.writeFile(file, renderServerProperties({ ...spec, port }, existing), "utf-8");
    }
    /** 同步客户端 mods 到服务端目录。 */
    async syncMods(dir, spec) {
        const enabled = spec.syncClientMods !== false;
        if (!enabled || !spec.clientDir)
            return;
        const clientMods = (0, path_1.join)((0, path_1.resolve)(spec.clientDir), "mods");
        if (!(0, util_1.pathExists)(clientMods))
            return;
        const list = await fs_1.promises.readdir(clientMods).catch(() => []);
        const jars = list.filter((f) => f.toLowerCase().endsWith(".jar"));
        if (jars.length === 0)
            return;
        const serverMods = (0, path_1.join)(dir, "mods");
        await (0, util_1.ensureDirAsync)(serverMods);
        let copied = 0;
        let skipped = 0;
        for (const jar of jars) {
            const low = jar.toLowerCase();
            if (CLIENT_ONLY_MOD_HINTS.some((h) => low.includes(h))) {
                skipped++;
                continue;
            }
            try {
                await fs_1.promises.copyFile((0, path_1.join)(clientMods, jar), (0, path_1.join)(serverMods, jar));
                copied++;
            }
            catch (e) {
                this.opts.log.warn(`复制 mod 失败 ${jar}: ${String(e)}`);
            }
        }
        this.opts.log.info(`mods 同步完成：复制 ${copied} 个，跳过客户端专用 ${skipped} 个`);
    }
    /** 按目录内容判定 launchKind。 */
    async detectLaunchKind(dir) {
        const files = await fs_1.promises.readdir(dir).catch(() => []);
        return detectLaunchKindFromFiles(files);
    }
    // --- 启动 / 停止 -------------------------------------------------------
    /** 启动服务器。 */
    async start(id) {
        await this.ensureRoot();
        const entry = this.entries.find((e) => e.id === id);
        if (!entry)
            throw new Error(`服务器不存在: ${id}`);
        if (this.runtimes.has(id)) {
            return this.statuses.get(id) ?? { id, state: "running", port: entry.port };
        }
        const dir = entry.dir;
        if (!(0, util_1.pathExists)(dir))
            throw new Error(`服务器目录不存在: ${dir}`);
        // 端口避让
        const freePort = await findFreePort(entry.port);
        if (freePort !== entry.port) {
            this.emit(id, `端口 ${entry.port} 被占用，改用 ${freePort}`, "warn");
            entry.port = freePort;
            entry.updatedAt = Date.now();
            await this.upsertEntry(entry);
        }
        const spec = this.specs.get(id) ?? { name: entry.name, versionId: entry.versionId, port: freePort };
        await this.writeProperties(dir, { ...spec, port: freePort }, freePort);
        const launchKind = entry.launchKind ?? (await this.detectLaunchKind(dir));
        if (launchKind === "unknown") {
            const msg = "无法识别启动方式（缺少 run 脚本 / server.jar），请重新安装";
            this.setStatus({ id, state: "error", port: freePort, message: msg });
            throw new Error(msg);
        }
        const javaMajor = requiredJavaMajor(entry.versionId);
        const rt = await this.opts.java.resolve(javaMajor);
        this.emit(id, `使用 Java ${rt.major}（${rt.source}）：${rt.javaPath}`, "info");
        const maxMem = Math.max(512, Math.floor(spec.maxMemoryMB ?? 2048));
        const jvm = [
            `-Xms${Math.max(256, Math.floor(maxMem / 4))}M`,
            `-Xmx${maxMem}M`,
            "-XX:+UseG1GC",
            "-XX:+ParallelRefProcEnabled",
            "-XX:MaxGCPauseMillis=200",
            "-Dfile.encoding=UTF-8",
        ];
        const { cmd, args } = this.buildLaunchCommand(launchKind, rt.javaPath, jvm, dir);
        this.setStatus({ id, state: "starting", port: freePort, message: "正在启动" });
        this.emit(id, `启动命令：${cmd} ${args.join(" ")}`, "cmd");
        const child = (0, child_process_1.spawn)(cmd, args, {
            cwd: dir,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
            env: this.childEnv(rt.javaPath),
        });
        let markExited = () => { };
        const exited = new Promise((r) => {
            markExited = r;
        });
        const runtime = {
            id,
            proc: child,
            port: freePort,
            startedAt: Date.now(),
            exited,
            markExited,
        };
        this.runtimes.set(id, runtime);
        this.setStatus({
            id,
            state: "starting",
            port: freePort,
            pid: child.pid,
            startedAt: runtime.startedAt,
        });
        const onLine = (level, line) => {
            this.emit(id, line, level);
            this.inspectLine(id, runtime, line, entry.versionId);
        };
        if (child.stdout) {
            const rl = (0, readline_1.createInterface)({ input: child.stdout });
            rl.on("line", (l) => onLine("info", l));
        }
        if (child.stderr) {
            const rl = (0, readline_1.createInterface)({ input: child.stderr });
            rl.on("line", (l) => onLine("warn", l));
        }
        child.once("error", (e) => {
            this.emit(id, `进程启动失败：${e.message}`, "err");
            this.setStatus({ id, state: "error", port: freePort, message: e.message });
            this.runtimes.delete(id);
            markExited();
        });
        child.once("close", (code) => {
            if (runtime.readyTimer)
                clearTimeout(runtime.readyTimer);
            this.runtimes.delete(id);
            this.emit(id, `服务器进程已退出（code=${code ?? "null"}）`, "info");
            const prev = this.statuses.get(id);
            if (prev?.state !== "error") {
                this.setStatus({ id, state: "stopped", port: runtime.port, message: "已停止" });
            }
            markExited();
        });
        // 启动超时保护：首次生成世界较慢，90s 后仍未判定为 running 也放行
        runtime.readyTimer = setTimeout(() => {
            const cur = this.statuses.get(id);
            if (cur?.state === "starting") {
                this.emit(id, "已超过 90s 仍未检测到就绪标志，按运行中处理（首次生成世界较慢）", "warn");
                this.setStatus({
                    id,
                    state: "running",
                    port: runtime.port,
                    pid: child.pid,
                    startedAt: runtime.startedAt,
                    message: "服务器已就绪（超时放行）",
                });
            }
        }, 90_000);
        return this.statuses.get(id) ?? {
            id,
            state: "starting",
            port: freePort,
            pid: child.pid,
            startedAt: runtime.startedAt,
        };
    }
    /** 按 launchKind 拼启动命令。 */
    buildLaunchCommand(launchKind, javaPath, jvm, dir) {
        if (launchKind === "run-script") {
            if (process.platform === "win32") {
                const bat = (0, util_1.pathExists)((0, path_1.join)(dir, "run.bat")) ? "run.bat" : "run.sh";
                const useBat = bat === "run.bat";
                return useBat
                    ? { cmd: "cmd.exe", args: ["/c", "run.bat", "nogui"] }
                    : { cmd: "bash", args: ["run.sh", "nogui"] };
            }
            return { cmd: "bash", args: ["run.sh", "nogui"] };
        }
        if (launchKind === "fabric-launch") {
            return { cmd: javaPath, args: [...jvm, "-jar", "fabric-server-launch.jar", "--nogui"] };
        }
        if (launchKind.startsWith("forge-jar:")) {
            const jar = launchKind.slice("forge-jar:".length);
            return { cmd: javaPath, args: [...jvm, "-jar", jar, "--nogui"] };
        }
        return { cmd: javaPath, args: [...jvm, "-jar", "server.jar", "--nogui"] };
    }
    /** 逐行判定服务器状态 / Java 版本问题。 */
    inspectLine(id, rt, line, versionId) {
        if (/Done \(|For help, type "help"/i.test(line)) {
            const cur = this.statuses.get(id);
            if (cur?.state !== "running") {
                if (rt.readyTimer) {
                    clearTimeout(rt.readyTimer);
                    rt.readyTimer = undefined;
                }
                this.setStatus({
                    id,
                    state: "running",
                    port: rt.port,
                    pid: rt.proc.pid,
                    startedAt: rt.startedAt,
                    message: "服务器已就绪",
                });
            }
            return;
        }
        if (/UnsupportedClassVersionError|has been compiled by a more recent version/i.test(line)) {
            const m = /class file version (\d+(?:\.\d+)?)/.exec(line);
            const need = m ? Math.round(Number(m[1]) - 44) : requiredJavaMajor(versionId);
            this.emit(id, `Java 版本过低：该服务端需要 Java ${need} 或更高，请在设置中指定对应 JDK 后重试`, "err");
            this.setStatus({
                id,
                state: "error",
                port: rt.port,
                pid: rt.proc.pid,
                message: `Java 版本过低，需要 Java ${need}+`,
            });
        }
    }
    /** 子进程环境：注入 JAVA_HOME / PATH，移除 JAVA_TOOL_OPTIONS。 */
    childEnv(javaPathOrCmd) {
        const env = { ...process.env };
        // java 可执行文件绝对路径才能推出 JAVA_HOME
        const looksLikePath = javaPathOrCmd.includes(path_1.sep) || javaPathOrCmd.includes("/");
        if (looksLikePath) {
            const binDir = (0, path_1.dirname)((0, path_1.resolve)(javaPathOrCmd));
            env.JAVA_HOME = (0, path_1.dirname)(binDir);
            env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
        }
        delete env.JAVA_TOOL_OPTIONS;
        delete env.java_tool_options;
        return env;
    }
    /** 停止服务器（优雅 stop，15s 未退出则强杀）。 */
    async stop(id) {
        const rt = this.runtimes.get(id);
        if (!rt)
            return { forced: false };
        try {
            if (rt.proc.stdin && !rt.proc.stdin.destroyed)
                rt.proc.stdin.write("stop\n");
        }
        catch {
            /* stdin 可能已关闭 */
        }
        this.emit(id, "已发送 stop 命令，等待服务器保存并退出…", "cmd");
        let timer;
        const timeout = new Promise((r) => {
            timer = setTimeout(() => r(true), 15_000);
        });
        const forced = await Promise.race([rt.exited.then(() => false), timeout]);
        if (timer)
            clearTimeout(timer);
        if (forced) {
            this.emit(id, "等待超时，强制结束服务器进程", "warn");
            try {
                rt.proc.kill("SIGKILL");
            }
            catch {
                /* ignore */
            }
            if (process.platform === "win32" && rt.proc.pid)
                await killTree(rt.proc.pid);
            this.runtimes.delete(id);
            this.setStatus({ id, state: "stopped", port: rt.port, message: "已强制停止" });
        }
        return { forced };
    }
    /** 向服务器 stdin 发送命令（如 say / op / whitelist）。 */
    command(id, cmd) {
        const rt = this.runtimes.get(id);
        if (!rt || !rt.proc.stdin || rt.proc.stdin.destroyed) {
            throw new Error(`服务器未运行: ${id}`);
        }
        const clean = cmd.replace(/[\r\n]+/g, " ").trim();
        if (!clean)
            return;
        rt.proc.stdin.write(`${clean}\n`);
        this.emit(id, clean, "cmd");
    }
    /** 删除服务器（运行中先停）。 */
    async remove(id) {
        await this.ensureRoot();
        const idx = this.entries.findIndex((e) => e.id === id);
        if (idx < 0)
            return;
        const entry = this.entries[idx];
        if (this.runtimes.has(id)) {
            await this.stop(id);
        }
        await fs_1.promises.rm(entry.dir, { recursive: true, force: true }).catch((e) => {
            this.opts.log.warn(`删除服务器目录失败：${String(e)}`);
        });
        this.entries.splice(idx, 1);
        this.statuses.delete(id);
        this.specs.delete(id);
        await this.writeIndex();
        this.opts.log.info(`服务器已删除：${entry.name}`);
    }
    /** 服务器列表。 */
    list() {
        return this.entries.map((e) => ({ ...e }));
    }
    /** 运行状态（不传 id 返回全部）。 */
    status(id) {
        if (id) {
            const e = this.entries.find((x) => x.id === id);
            return (this.statuses.get(id) ?? {
                id,
                state: e ? "stopped" : "error",
                port: e?.port ?? 25565,
                message: e ? "未启动" : "服务器不存在",
            });
        }
        return this.entries.map((e) => {
            const s = this.statuses.get(e.id);
            return s ?? { id: e.id, state: "stopped", port: e.port, message: "未启动" };
        });
    }
    /** 应用退出时停止全部服务器。 */
    async stopAll() {
        const ids = [...this.runtimes.keys()];
        await Promise.all(ids.map((id) => this.stop(id).catch((e) => {
            this.opts.log.warn(`停止服务器 ${id} 失败：${String(e)}`);
        })));
        // 兜底：给残留进程一点时间
        if (ids.length > 0)
            await (0, util_1.sleep)(200);
    }
}
exports.ServerHost = ServerHost;
//# sourceMappingURL=host.js.map