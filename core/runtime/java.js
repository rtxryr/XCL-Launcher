"use strict";
/**
 * Java 运行时：检测已安装 JRE + 按 javaVersion 自动下载（多源）。
 *
 * 检测策略（跨平台）：
 *  - JAVA_HOME / PATH 上的 java；
 *  - 各平台常见安装目录扫描（含 HMCL/Prism/Modrinth 等启动器自带 JRE 目录）；
 *  - 解析 `java -version` 得到 major 版本，按版本匹配最佳 JRE。
 *
 * 自动下载（对齐 VersePC 的三源策略）：
 *  1) Mojang 官方 java-runtime 清单（piston-meta）；
 *  2) BMCLAPI 镜像清单；
 *  3) Adoptium Temurin 直链兜底（api.adoptium.net）。
 * 单个文件的下载本身也走「多镜像候选 + 聚合择优」。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JavaService = void 0;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const yauzl = __importStar(require("yauzl"));
const errors_1 = require("../core/errors");
const util_1 = require("../core/util");
const http_1 = require("../net/http");
const downloader_1 = require("../net/downloader");
const aggregator_1 = require("../download/aggregator");
const sources_1 = require("../net/sources");
/**
 * Java 运行时清单候选（多源）：
 *  1) Mojang 官方 piston-meta；
 *  2) BMCLAPI 镜像；
 * 全部失败时走 Adoptium Temurin 直链兜底。
 */
const RUNTIME_MANIFEST_CANDIDATES = (0, sources_1.javaRuntimeManifestCandidates)();
function javaExe() {
    return process.platform === "win32" ? "java.exe" : "java";
}
function runVersion(javaPath) {
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(javaPath, ["-version"], { timeout: 8000 }, (err, _stdout, stderr) => {
            // java -version 输出到 stderr
            const out = `${stderr || ""}${_stdout || ""}`;
            if (out.trim())
                resolve(out);
            else
                resolve(null);
        });
    });
}
function parseMajor(versionOutput) {
    // 匹配 version "17.0.9" 或 version "1.8.0_382"
    const m = /version\s+"([^"]+)"/i.exec(versionOutput);
    const full = m?.[1];
    if (!full)
        return { major: 0 };
    if (full.startsWith("1.")) {
        // 老式：1.8.x → major 8
        const second = full.split(".")[1];
        return { major: parseInt(second, 10) || 0, full };
    }
    return { major: parseInt(full.split(".")[0], 10) || 0, full };
}
async function probe(javaPath, source) {
    if (!(0, util_1.pathExists)(javaPath))
        return null;
    const out = await runVersion(javaPath);
    if (!out)
        return null;
    const { major, full } = parseMajor(out);
    if (!major)
        return null;
    return { javaPath, major, full, source };
}
/** 各平台常见 JRE 目录。 */
function candidateDirs() {
    const dirs = [];
    const win = process.platform === "win32";
    const mac = process.platform === "darwin";
    const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] ?? (0, path_1.join)((0, os_1.homedir)(), "AppData", "Local");
    if (win) {
        dirs.push((0, path_1.join)(pf, "Java"), (0, path_1.join)(pf, "Eclipse Adoptium"), (0, path_1.join)(pf, "Microsoft"), (0, path_1.join)(pf, "Amazon Corretto"), (0, path_1.join)(pf, "Zulu"), (0, path_1.join)(pf, "BellSoft"), (0, path_1.join)(pf86, "Java"), (0, path_1.join)(local, "Programs", "Eclipse Adoptium"), (0, path_1.join)(local, "Programs", "Microsoft"));
    }
    else if (mac) {
        dirs.push("/Library/Java/JavaVirtualMachines", (0, path_1.join)((0, os_1.homedir)(), "Library/Java/JavaVirtualMachines"));
    }
    else {
        dirs.push("/usr/lib/jvm", "/usr/java", "/opt/java", "/opt/jdk");
    }
    return dirs;
}
async function scanJavaBinaries() {
    const bins = [];
    for (const dir of candidateDirs()) {
        if (!(0, fs_1.existsSync)(dir))
            continue;
        let entries = [];
        try {
            entries = (await fs_1.promises.readdir(dir)).map((e) => (0, path_1.join)(dir, e));
        }
        catch {
            continue;
        }
        for (const e of entries) {
            // mac: */Contents/Home/bin/java ; 其它: */bin/java
            const candidates = [
                (0, path_1.join)(e, "bin", javaExe()),
                (0, path_1.join)(e, "Contents", "Home", "bin", javaExe()),
            ];
            for (const c of candidates)
                if ((0, util_1.pathExists)(c))
                    bins.push(c);
        }
    }
    return bins;
}
class JavaService {
    mirrors;
    log;
    runtimeRoot;
    constructor(mirrors, log, runtimeRoot) {
        this.mirrors = mirrors;
        this.log = log;
        this.runtimeRoot = runtimeRoot;
    }
    /** 枚举本机所有可用 JRE。 */
    async detectAll() {
        const found = [];
        const seen = new Set();
        const add = (p, source) => {
            if (p && !seen.has(p))
                return probe(p, source).then((j) => {
                    if (j) {
                        seen.add(p);
                        found.push(j);
                    }
                });
            return Promise.resolve();
        };
        await add(process.env["JAVA_HOME"] ? (0, path_1.join)(process.env["JAVA_HOME"], "bin", javaExe()) : undefined, "env");
        // PATH
        const pathEnv = process.env["PATH"] ?? process.env["Path"] ?? "";
        for (const p of pathEnv.split(path_1.delimiter)) {
            if (p)
                await add((0, path_1.join)(p, javaExe()), "path");
        }
        // 扫描目录
        for (const bin of await scanJavaBinaries()) {
            await add(bin, "scan");
        }
        // 已由本服务自动下载的运行时（否则每次启动都会重新下载一遍）
        for (const bin of await scanRuntimeRoot(this.runtimeRoot)) {
            await add(bin, "download");
        }
        found.sort((a, b) => b.major - a.major);
        return found;
    }
    /**
     * 找到满足 requiredMajor（可选）的最佳 JRE。
     * 优先精确 major 匹配；无则取最高 major。
     */
    async findBest(requiredMajor) {
        const all = await this.detectAll();
        if (all.length === 0)
            return null;
        if (requiredMajor) {
            const exact = all.find((j) => j.major === requiredMajor);
            if (exact)
                return exact;
            const higher = all.find((j) => j.major >= requiredMajor);
            if (higher)
                return higher;
        }
        return all[0];
    }
    /**
     * 解析出用于启动的 Java：配置指定 > 本机检测 > 自动下载。
     */
    async resolve(requiredMajor, configuredPath) {
        if (configuredPath && (0, util_1.pathExists)(configuredPath)) {
            const j = await probe(configuredPath, "configured");
            if (j)
                return j;
        }
        const best = await this.findBest(requiredMajor);
        if (best) {
            this.log.info(`使用 Java ${best.major} (${best.source}): ${best.javaPath}`);
            return best;
        }
        // 自动下载
        if (requiredMajor) {
            this.log.info(`未检测到 Java ${requiredMajor}，尝试自动下载…`);
            return this.downloadRuntime(requiredMajor);
        }
        throw new errors_1.FusionError("JAVA", "未找到可用 Java，且无法自动下载");
    }
    /**
     * 自动下载匹配 major 的 JRE（按 Mojang java-runtime 清单，多源）。
     * 结构：清单 → 当前 OS/架构的 component 条目 → 文件清单 → 并发下载。
     * 清单或文件全部失败时回退 Adoptium Temurin。
     */
    async downloadRuntime(major, component) {
        const osName = (0, util_1.mojangOs)();
        const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : "x64";
        const platformKey = platformRuntimeKey(osName, arch);
        let manifest = null;
        let lastErr;
        for (const url of RUNTIME_MANIFEST_CANDIDATES) {
            try {
                manifest = await (0, http_1.httpGetJson)(url, { timeoutMs: 25_000 });
                this.log.debug(`Java 运行时清单来源: ${hostOf(url)}`);
                break;
            }
            catch (e) {
                lastErr = e;
                this.log.warn(`Java 清单源失败 ${hostOf(url)}: ${errMsg(e)}`);
            }
        }
        if (!manifest) {
            this.log.warn("Java 运行时清单全部失败，改用 Adoptium Temurin");
            return this.downloadTemurin(major, lastErr);
        }
        const picked = pickRuntimeEntry(manifest, platformKey, major, component);
        if (!picked) {
            this.log.warn(`清单中无 ${platformKey} 的可用运行时，改用 Adoptium Temurin`);
            return this.downloadTemurin(major);
        }
        let fileManifest;
        try {
            fileManifest = await (0, http_1.httpGetJson)(picked.url, { timeoutMs: 25_000 });
        }
        catch (e) {
            this.log.warn(`运行时文件清单失败，改用 Adoptium Temurin: ${errMsg(e)}`);
            return this.downloadTemurin(major, e);
        }
        const destDir = (0, path_1.join)(this.runtimeRoot, picked.key);
        await (0, util_1.ensureDirAsync)(destDir);
        // 收集需下载的文件；兼容 raw 与 downloads.raw 两种结构
        const toDownload = [];
        for (const [relPath, meta] of Object.entries(fileManifest.files ?? {})) {
            if (meta.type !== "file")
                continue;
            const raw = meta.raw ?? meta.downloads?.raw;
            if (!raw?.url)
                continue;
            toDownload.push({
                urls: this.mirrors.candidates(raw.url),
                dest: (0, path_1.join)(destDir, relPath),
                sha1: raw.sha1,
            });
        }
        if (toDownload.length === 0) {
            this.log.warn("运行时文件清单为空，改用 Adoptium Temurin");
            return this.downloadTemurin(major);
        }
        this.log.info(`下载 Java 运行时 ${picked.key}，文件数 ${toDownload.length}`);
        const res = await (0, downloader_1.downloadMany)(toDownload, {
            onProgress: (d, t) => this.log.debug(`java 运行时下载 ${d}/${t}`),
        });
        if (res.failed.length) {
            this.log.warn(`Java 运行时下载有 ${res.failed.length} 个文件失败`);
        }
        const javaPath = (0, path_1.join)(destDir, "bin", javaExe());
        if (!(0, util_1.pathExists)(javaPath)) {
            this.log.warn("运行时目录缺少 java 可执行文件，改用 Adoptium Temurin");
            return this.downloadTemurin(major);
        }
        const rt = await probe(javaPath, "download");
        if (!rt) {
            this.log.warn("下载的 Java 无法执行，改用 Adoptium Temurin");
            return this.downloadTemurin(major);
        }
        return rt;
    }
    /**
     * Adoptium Temurin 直链兜底（Verse 的第三源）。
     * Windows 为 zip，macOS/Linux 为 tar.gz。
     */
    async downloadTemurin(major, cause) {
        const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
        const arch = process.arch === "arm64" ? "arm64" : "x64";
        const url = (0, sources_1.temurinUrl)(major, os, arch);
        const destDir = (0, path_1.join)(this.runtimeRoot, `temurin-${major}-${os}-${arch}`);
        await (0, util_1.ensureDirAsync)(destDir);
        const isWin = process.platform === "win32";
        const archive = (0, path_1.join)(destDir, isWin ? "jre.zip" : "jre.tar.gz");
        this.log.info(`从 Adoptium 下载 Java ${major}: ${url}`);
        try {
            // Temurin 的直链会 302 到 GitHub 资产，部分 CDN 对 Range 支持不一致，
            // 因此这里强制单流下载（49MB 单流足够快，换来的是「内容一定正确」）。
            await fs_1.promises.rm(archive, { force: true });
            await (0, aggregator_1.aggregatedDownload)([url], archive, {
                mode: "official-first",
                timeoutMs: 600_000,
                stallTimeoutMs: 120_000,
                chunkThreshold: Number.MAX_SAFE_INTEGER,
            });
            if (isWin)
                await extractZipSafe(archive, destDir);
            else
                await untar(archive, destDir);
            await fs_1.promises.rm(archive, { force: true });
        }
        catch (e) {
            throw (0, errors_1.wrapError)("JAVA", `Adoptium 下载 Java ${major} 失败`, e ?? cause, true);
        }
        const javaPath = await findJavaBinary(destDir);
        if (!javaPath)
            throw new errors_1.FusionError("JAVA", "Temurin 解压后未找到 java 可执行文件");
        const rt = await probe(javaPath, "temurin");
        if (!rt)
            throw new errors_1.FusionError("JAVA", "Temurin 下载的 Java 无法执行");
        return rt;
    }
}
exports.JavaService = JavaService;
/**
 * Mojang java-runtime 清单的平台 key。
 * 真实清单的顶层 key 只有：gamecore / linux / linux-i386 / mac-os / mac-os-arm64 /
 * windows-arm64 / windows-x64 / windows-x86；component 在第二层，值是数组。
 */
function platformRuntimeKey(os, arch) {
    if (os === "windows") {
        return arch === "arm64" ? "windows-arm64" : arch === "x86" ? "windows-x86" : "windows-x64";
    }
    if (os === "osx" || os === "mac") {
        return arch === "arm64" ? "mac-os-arm64" : "mac-os";
    }
    if (os === "linux") {
        return arch === "x86" ? "linux-i386" : arch === "arm64" ? "linux-arm64" : "linux";
    }
    return `${os}-${arch}`;
}
/** 按 Java 主版本选 component 名。 */
function runtimeComponent(major) {
    return major >= 21 ? "java-runtime-delta" : major >= 17 ? "java-runtime-gamma" : "jre-legacy";
}
/**
 * 在清单里挑运行时：
 *   manifest[platformKey][component] = [ { manifest: { url, sha1 } } ]
 * 找不到精确 component 时按 delta → gamma → jre-legacy → 任意顺序回退。
 */
function pickRuntimeEntry(manifest, platformKey, major, preferComponent) {
    const platform = manifest[platformKey];
    if (!platform)
        return null;
    const order = [
        preferComponent,
        runtimeComponent(major),
        "java-runtime-delta",
        "java-runtime-gamma",
        "jre-legacy",
        ...Object.keys(platform),
    ].filter((x) => !!x);
    for (const comp of order) {
        const arr = platform[comp];
        const entry = Array.isArray(arr) ? arr[0] : undefined;
        if (entry?.manifest?.url) {
            return { key: `${platformKey}__${comp}`, component: comp, url: entry.manifest.url };
        }
    }
    return null;
}
function hostOf(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return url;
    }
}
function errMsg(e) {
    return e instanceof Error ? e.message : String(e);
}
/** 扫描本服务已下载的运行时目录（runtimeRoot/<platform__component>/bin/java）。 */
async function scanRuntimeRoot(root) {
    let dirs = [];
    try {
        dirs = (await fs_1.promises.readdir(root)).map((d) => (0, path_1.join)(root, d));
    }
    catch {
        return [];
    }
    const out = [];
    for (const d of dirs) {
        const j = await findJavaBinary(d);
        if (j)
            out.push(j);
    }
    return out;
}
/** 递归查找 java 可执行文件（限制深度，避免全盘扫描）。 */
async function findJavaBinary(root, depth = 0) {
    if (depth > 5)
        return null;
    let entries = [];
    try {
        entries = await fs_1.promises.readdir(root, { withFileTypes: true });
    }
    catch {
        return null;
    }
    // 命中 bin/java
    const direct = (0, path_1.join)(root, "bin", javaExe());
    if ((0, util_1.pathExists)(direct))
        return direct;
    for (const e of entries) {
        if (!e.isDirectory())
            continue;
        const found = await findJavaBinary((0, path_1.join)(root, e.name), depth + 1);
        if (found)
            return found;
    }
    return null;
}
/** 安全解压 zip：拒绝越界路径（zip slip），保留目录结构。 */
function extractZipSafe(zipPath, destDir) {
    const root = (0, path_1.resolve)(destDir) + path_1.sep;
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
            if (err || !zipfile)
                return reject((0, errors_1.wrapError)("JAVA", "打开 Temurin 压缩包失败", err));
            zipfile.readEntry();
            zipfile.on("entry", (entry) => {
                const name = entry.fileName;
                if (name.endsWith("/")) {
                    zipfile.readEntry();
                    return;
                }
                const outPath = (0, path_1.resolve)(destDir, name);
                if (!outPath.startsWith(root)) {
                    zipfile.readEntry();
                    return;
                }
                (0, util_1.ensureDirAsync)((0, path_1.join)(outPath, ".."))
                    .then(() => {
                    zipfile.openReadStream(entry, (e2, rs) => {
                        if (e2 || !rs) {
                            zipfile.readEntry();
                            return;
                        }
                        const ws = (0, fs_1.createWriteStream)(outPath);
                        rs.pipe(ws);
                        ws.on("close", () => zipfile.readEntry());
                        ws.on("error", (e3) => reject((0, errors_1.wrapError)("JAVA", `写 Java 文件失败: ${name}`, e3)));
                    });
                })
                    .catch(reject);
            });
            zipfile.on("end", () => resolve());
            zipfile.on("error", (e) => reject((0, errors_1.wrapError)("JAVA", "读取 Temurin 压缩包出错", e)));
        });
    });
}
/** 非 Windows 用系统 tar 解包（tar.gz 在 Node 里没有内置实现）。 */
function untar(archive, destDir) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)("tar", ["-xzf", archive, "-C", destDir], { timeout: 300_000 }, (err) => {
            if (err)
                reject((0, errors_1.wrapError)("JAVA", "解压 Temurin tar.gz 失败", err));
            else
                resolve();
        });
    });
}
//# sourceMappingURL=java.js.map