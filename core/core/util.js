"use strict";
/**
 * 通用工具：路径、哈希、并发控制、重试、文件原子写。
 * 各模块共享，尽量少依赖第三方。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDir = ensureDir;
exports.ensureDirAsync = ensureDirAsync;
exports.pathExists = pathExists;
exports.fileSize = fileSize;
exports.sha1File = sha1File;
exports.sha1String = sha1String;
exports.atomicWrite = atomicWrite;
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.abs = abs;
exports.joinPath = joinPath;
exports.mapConcurrent = mapConcurrent;
exports.withRetry = withRetry;
exports.sleep = sleep;
exports.mojangOs = mojangOs;
exports.classpathSep = classpathSep;
exports.humanSize = humanSize;
exports.debounce = debounce;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const errors_1 = require("./errors");
function ensureDir(dir) {
    if (!(0, fs_1.existsSync)(dir))
        (0, fs_1.mkdirSync)(dir, { recursive: true });
    return dir;
}
async function ensureDirAsync(dir) {
    await fs_1.promises.mkdir(dir, { recursive: true });
    return dir;
}
function pathExists(p) {
    return (0, fs_1.existsSync)(p);
}
async function fileSize(p) {
    try {
        const st = await fs_1.promises.stat(p);
        return st.size;
    }
    catch {
        return 0;
    }
}
/** 计算文件 SHA1（Minecraft 用 sha1 校验资源/库）。 */
function sha1File(path) {
    return new Promise((resolveP, reject) => {
        const hash = (0, crypto_1.createHash)("sha1");
        const rs = (0, fs_1.createReadStream)(path);
        rs.on("error", (e) => reject(new errors_1.FusionError("IO", "sha1 read failed", { cause: e })));
        rs.on("data", (chunk) => hash.update(chunk));
        rs.on("end", () => resolveP(hash.digest("hex")));
    });
}
function sha1String(s) {
    return (0, crypto_1.createHash)("sha1").update(s).digest("hex");
}
/** 原子写文件：先写临时文件再 rename，避免半截文件。 */
async function atomicWrite(path, data) {
    await ensureDirAsync((0, path_1.dirname)(path));
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await fs_1.promises.writeFile(tmp, data);
    await fs_1.promises.rename(tmp, path);
}
async function readJson(path) {
    try {
        const raw = await fs_1.promises.readFile(path, "utf-8");
        return JSON.parse(raw);
    }
    catch (e) {
        throw new errors_1.FusionError("IO", `read json failed: ${path}`, { cause: e });
    }
}
async function writeJson(path, value) {
    await atomicWrite(path, JSON.stringify(value, null, 2));
}
/** 绝对路径解析，相对路径基于 cwd。 */
function abs(p) {
    return (0, path_1.isAbsolute)(p) ? (0, path_1.resolve)(p) : (0, path_1.resolve)(process.cwd(), p);
}
function joinPath(...parts) {
    return (0, path_1.join)(...parts);
}
/** 简单并发池：限制同时运行的异步任务数。 */
async function mapConcurrent(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const n = Math.max(1, Math.min(limit, items.length));
    const runners = Array.from({ length: n }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            results[i] = await worker(items[i], i);
        }
    });
    await Promise.all(runners);
    return results;
}
/** 指数退避重试。 */
async function withRetry(fn, opts = {}) {
    const retries = opts.retries ?? 3;
    const factor = opts.factor ?? 2;
    let delay = opts.minDelayMs ?? 300;
    const maxDelay = opts.maxDelayMs ?? 8000;
    let lastErr;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
            return await fn(attempt);
        }
        catch (e) {
            lastErr = e;
            const canRetry = attempt <= retries &&
                (opts.shouldRetry ? opts.shouldRetry(e) : true);
            if (!canRetry)
                break;
            opts.onRetry?.(e, attempt);
            await sleep(delay);
            delay = Math.min(maxDelay, Math.round(delay * factor));
        }
    }
    throw lastErr;
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/** 当前操作系统映射到 Mojang 命名（windows/osx/linux）。 */
function mojangOs() {
    const p = process.platform;
    if (p === "win32")
        return "windows";
    if (p === "darwin")
        return "osx";
    return "linux";
}
/** classpath 分隔符。 */
function classpathSep() {
    return process.platform === "win32" ? ";" : ":";
}
/** 人类可读字节数。 */
function humanSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(1)} ${units[i]}`;
}
/** 简易防抖（用于 UI 进度事件合并）。 */
function debounce(fn, wait) {
    let t;
    return (...args) => {
        if (t)
            clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}
//# sourceMappingURL=util.js.map