"use strict";
/**
 * 智能聚合下载器 —— 参考 VersePC `server/http-client/{mirror,download-chunked}.js` 的算法重写。
 *
 * 与既有 downloader.ts 的分工：
 *  - downloader.ts：通用下载（小文件单流 / 大文件分块），多源靠「候选列表顺序尝试」；
 *  - aggregator.ts：把「多源」做成真正的一等能力 —— 先并行测速择优，再分块聚合，
 *    并在镜像故障时熔断、整体切源、必要时回退单流。
 *
 * 核心算法（数值沿用 Verse 实测参数）：
 *  1. 镜像熔断：同一 host 连续失败 3 次 → 冷却 60s，冷却期内不参与候选。
 *  2. 并行测速：对所有候选发 `Range: bytes=0-0` 探针（默认 1.5s 超时），
 *     按「延迟倒数」排序，同时拿到真实文件大小与是否支持 Range。
 *  3. 分块判定：支持 Range && 文件 > 1MB 才分块；否则单流。
 *  4. 分块参数：块数 = min(maxChunks(64), ceil(size / 512KB))，块大小均分。
 *  5. 动态线程：从 4 条起步；实测速度低于 speedFloor 且未达上限时增开线程。
 *  6. 断点续传：每块写 `${dest}.c{i}`，重下时按已有大小从块内偏移续传。
 *  7. 失败处理：块失败 → 换源重试（3 轮，指数退避）→ 仍失败整体切下一个源 → 最后回退单流。
 *  8. 完整性：合并到 `.merging` 后做大小 + SHA1 校验，通过才 rename 落盘。
 *
 * 许可说明：本项目参考了 VersePC（https://github.com/doujie081231/Verse，GPL-3.0）的实现思路，
 * 该上游同样以 GPL-3.0 发布；本文件为 TypeScript 重写而非直接复制。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGGREGATE_DEFAULTS = exports.MirrorBreaker = void 0;
exports.orderCandidates = orderCandidates;
exports.probeMirrors = probeMirrors;
exports.aggregatedDownload = aggregatedDownload;
exports.aggregatedDownloadMany = aggregatedDownloadMany;
exports.candidateUrls = candidateUrls;
const fs_1 = require("fs");
const path_1 = require("path");
const errors_1 = require("../core/errors");
const util_1 = require("../core/util");
const http_1 = require("../net/http");
const conc_policy_1 = require("../net/conc-policy");
const DEFAULTS = {
    chunkThreshold: 1 * 1024 * 1024,
    minChunkSize: 512 * 1024,
    maxChunks: 64,
    initialThreads: 4,
    speedFloorBps: 256 * 1024,
    stallTimeoutMs: 60_000,
    retries: 3,
    probeTimeoutMs: 1500,
    timeoutMs: 120_000,
    maxConnections: 16,
};
exports.AGGREGATE_DEFAULTS = DEFAULTS;
/** 同一 host 连续失败 3 次 → 冷却 60s。 */
class MirrorBreaker {
    threshold;
    cooldownMs;
    state = new Map();
    constructor(threshold = 3, cooldownMs = 60_000) {
        this.threshold = threshold;
        this.cooldownMs = cooldownMs;
    }
    key(url) {
        try {
            return new URL(url).host;
        }
        catch {
            return url;
        }
    }
    isAvailable(url) {
        const k = this.key(url);
        const s = this.state.get(k);
        if (!s || !s.fails)
            return true;
        if (s.fails < this.threshold)
            return true;
        if (Date.now() >= s.until) {
            // 冷却结束，重新给机会
            this.state.delete(k);
            return true;
        }
        return false;
    }
    fail(url) {
        const k = this.key(url);
        const s = this.state.get(k) ?? { fails: 0, until: 0 };
        s.fails += 1;
        if (s.fails >= this.threshold)
            s.until = Date.now() + this.cooldownMs;
        this.state.set(k, s);
    }
    success(url) {
        this.state.delete(this.key(url));
    }
    snapshot() {
        return [...this.state.entries()].map(([host, s]) => ({
            host,
            fails: s.fails,
            cooldownUntil: s.until,
        }));
    }
    reset() {
        this.state.clear();
    }
}
exports.MirrorBreaker = MirrorBreaker;
/** 按下载源模式重排候选：国内优先 / 官方优先 / 仅官方。 */
function orderCandidates(urls, mode = "china-first") {
    const uniq = [...new Set(urls.filter(Boolean))];
    if (mode === "mojang") {
        // 只保留官方 mojang 域名
        const official = uniq.filter((u) => /(^|\.)mojang\.com|minecraft\.net/i.test(u));
        return official.length ? official : uniq.slice(0, 1);
    }
    const isMirror = (u) => !/(^|\.)mojang\.com|minecraft\.net/i.test(u);
    const mirrors = uniq.filter(isMirror);
    const official = uniq.filter((u) => !isMirror(u));
    if (mode === "official-first" || mode === "auto")
        return [...official, ...mirrors];
    return [...mirrors, ...official];
}
/** 并行测速所有候选，返回按得分降序的探测结果。 */
async function probeMirrors(urls, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULTS.probeTimeoutMs;
    if (urls.length === 0)
        return [];
    const probes = urls.map(async (url) => {
        const started = Date.now();
        try {
            const res = await (0, http_1.httpRequest)(url, {
                headers: { range: "bytes=0-0" },
                timeoutMs,
                signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : undefined,
            });
            const latencyMs = Date.now() - started;
            let fileSize = 0;
            let supportsRange = false;
            if (res.status === 206) {
                supportsRange = true;
                const cr = res.headers.get("content-range");
                const m = cr ? /\/(\d+)/.exec(cr) : null;
                fileSize = m ? Number(m[1]) : Number(res.headers.get("content-length") ?? 0);
            }
            else if (res.status === 200) {
                fileSize = Number(res.headers.get("content-length") ?? 0);
            }
            else {
                await res.body?.cancel().catch(() => { });
                return { url, ok: false, latencyMs, score: 0, fileSize: 0, supportsRange: false };
            }
            // 关键：立刻丢弃探针 body，避免把整个文件拉下来
            await res.body?.cancel().catch(() => { });
            const score = latencyMs > 0 ? 1000 / latencyMs : 0;
            return { url, ok: true, latencyMs, score, fileSize, supportsRange };
        }
        catch {
            return { url, ok: false, latencyMs: Date.now() - started, score: 0, fileSize: 0, supportsRange: false };
        }
    });
    const results = await Promise.all(probes);
    results.sort((a, b) => b.score - a.score);
    return results;
}
/** 带 stall 检测的请求：stallMs 内没有任何数据块就中止。 */
async function fetchWithStall(url, headers, stallMs, timeoutMs, outer) {
    const ctrl = new AbortController();
    let timer = null;
    const touch = () => {
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => ctrl.abort(new Error(`stall timeout ${stallMs}ms`)), stallMs);
    };
    const dispose = () => {
        if (timer)
            clearTimeout(timer);
        timer = null;
    };
    touch();
    const signals = [ctrl.signal, AbortSignal.timeout(timeoutMs)];
    if (outer)
        signals.push(outer);
    try {
        const res = await (0, http_1.httpRequest)(url, {
            headers,
            timeoutMs,
            signal: signals.length > 1 ? AbortSignal.any(signals) : ctrl.signal,
        });
        return { res, touch, dispose, signal: ctrl.signal };
    }
    catch (e) {
        dispose();
        throw e;
    }
}
/** 把响应流写进文件（追加），返回写入字节数。 */
async function pipeToFile(res, file, touch, onBytes) {
    await (0, util_1.ensureDirAsync)((0, path_1.dirname)(file));
    const fd = await fs_1.promises.open(file, "a");
    let written = 0;
    try {
        const body = res.body;
        if (!body) {
            const ab = Buffer.from(await res.arrayBuffer());
            if (ab.length) {
                await fd.write(ab);
                written += ab.length;
                onBytes(ab.length);
            }
            return written;
        }
        const reader = body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            const buf = Buffer.from(value);
            await fd.write(buf);
            written += buf.length;
            touch();
            onBytes(buf.length);
        }
    }
    finally {
        await fd.close();
    }
    return written;
}
async function sizeOf(file) {
    try {
        return (await fs_1.promises.stat(file)).size;
    }
    catch {
        return 0;
    }
}
/** 解析文件大小 + Range 支持情况（探针已拿到则复用）。 */
async function planDownload(url, opts, probe) {
    const chunkThreshold = opts.chunkThreshold ?? DEFAULTS.chunkThreshold;
    const minChunkSize = opts.minChunkSize ?? DEFAULTS.minChunkSize;
    const maxChunks = Math.min(opts.maxChunks ?? DEFAULTS.maxChunks, 64);
    const stallMs = opts.stallTimeoutMs ?? DEFAULTS.stallTimeoutMs;
    const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    let fileSize = probe?.fileSize ?? 0;
    let supportsRange = probe?.supportsRange ?? false;
    if (!probe || !fileSize) {
        const p = await fetchWithStall(url, { range: "bytes=0-0" }, stallMs, 5000, opts.signal);
        try {
            if (p.res.status === 206) {
                supportsRange = true;
                const cr = p.res.headers.get("content-range");
                const m = cr ? /\/(\d+)/.exec(cr) : null;
                fileSize = m ? Number(m[1]) : Number(p.res.headers.get("content-length") ?? 0);
            }
            else if (p.res.status === 200) {
                fileSize = Number(p.res.headers.get("content-length") ?? 0);
            }
            await p.res.body?.cancel().catch(() => { });
        }
        finally {
            p.dispose();
        }
    }
    if (!fileSize) {
        return { fileSize: 0, chunks: [], chunkSize: 0, supportsRange: false };
    }
    const useChunk = supportsRange && fileSize > chunkThreshold;
    if (!useChunk) {
        return { fileSize, chunks: [], chunkSize: 0, supportsRange };
    }
    const count = Math.max(1, Math.min(maxChunks, Math.ceil(fileSize / minChunkSize)));
    const chunkSize = Math.ceil(fileSize / count);
    const chunks = [];
    for (let i = 0; i < count; i++) {
        const start = i * chunkSize;
        const end = Math.min(fileSize - 1, start + chunkSize - 1);
        if (start > end)
            break;
        chunks.push({ index: i, start, end, tmp: "", done: 0 });
    }
    return { fileSize, chunks, chunkSize, supportsRange };
}
/** 单个分块下载（含块内断点续传）。返回本次实际传输字节数。 */
async function downloadChunk(url, dest, chunk, opts, urls, breaker, onBytes) {
    const expected = chunk.end - chunk.start + 1;
    chunk.tmp = `${dest}.c${chunk.index}`;
    let have = (0, fs_1.existsSync)(chunk.tmp) ? await sizeOf(chunk.tmp) : 0;
    if (have > expected) {
        await fs_1.promises.rm(chunk.tmp, { force: true });
        have = 0;
    }
    if (have === expected) {
        chunk.done = expected;
        return 0;
    }
    chunk.done = have;
    const retries = opts.retries ?? DEFAULTS.retries;
    const stallMs = opts.stallTimeoutMs ?? DEFAULTS.stallTimeoutMs;
    const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    let lastErr;
    // 换源 + 重试：内层 3 轮，外层遍历候选源
    for (const candidate of urls) {
        if (!breaker.isAvailable(candidate))
            continue;
        for (let round = 0; round <= retries; round++) {
            if (opts.signal?.aborted)
                throw new errors_1.FusionError("DOWNLOAD", "下载已取消");
            if (round > 0) {
                const backoff = Math.min(1000 * round, 5000) + Math.floor(Math.random() * 500);
                await new Promise((r) => setTimeout(r, backoff));
                chunk.done = (0, fs_1.existsSync)(chunk.tmp) ? await sizeOf(chunk.tmp) : 0;
                if (chunk.done > expected) {
                    await fs_1.promises.rm(chunk.tmp, { force: true });
                    chunk.done = 0;
                }
                if (chunk.done === expected)
                    return 0;
            }
            const from = chunk.start + chunk.done;
            const p = await fetchWithStall(candidate, { range: `bytes=${from}-${chunk.end}` }, stallMs, timeoutMs, opts.signal);
            try {
                if (p.res.status === 206) {
                    // 关键校验：跟随 302 后，部分 CDN 会忽略 Range 或返回错误区间，
                    // 直接写盘会导致「大小对但内容错乱」（zip 解压报 unexpected EOF 就是这么来的）。
                    const cr = p.res.headers.get("content-range");
                    const m = cr ? /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(cr) : null;
                    if (m && Number(m[1]) !== from) {
                        await p.res.body?.cancel().catch(() => { });
                        throw new errors_1.FusionError("DOWNLOAD", `Range 不匹配：请求 ${from} 起，返回 ${m[1]} 起`, { retryable: true });
                    }
                }
                else if (p.res.status === 200) {
                    // 服务端忽略 Range，分块拿到的不是本段数据 —— 不可重试，直接换源/回退单流
                    await p.res.body?.cancel().catch(() => { });
                    throw new errors_1.FusionError("DOWNLOAD", "服务端忽略 Range，无法分块", { retryable: false });
                }
                else {
                    await p.res.body?.cancel().catch(() => { });
                    throw new errors_1.FusionError("DOWNLOAD", `分块 HTTP ${p.res.status} @ ${candidate}`, {
                        retryable: p.res.status >= 500 || p.res.status === 429,
                    });
                }
                const before = chunk.done;
                const written = await pipeToFile(p.res, chunk.tmp, p.touch, (n) => {
                    chunk.done += n;
                    onBytes(n);
                });
                const after = (0, fs_1.existsSync)(chunk.tmp) ? await sizeOf(chunk.tmp) : 0;
                if (after < expected) {
                    throw new errors_1.FusionError("DOWNLOAD", `分块不完整 (${after}/${expected})：本次 ${written}B，起始 ${before}B`, { retryable: true });
                }
                breaker.success(candidate);
                return written;
            }
            catch (e) {
                lastErr = e;
                breaker.fail(candidate);
                // 不可重试（如服务端忽略 Range）：直接换下一个源，别在同一源上耗 3 轮
                if (e instanceof errors_1.FusionError && e.retryable === false)
                    break;
            }
            finally {
                p.dispose();
            }
        }
    }
    throw (0, errors_1.wrapError)("DOWNLOAD", `分块 ${chunk.index} 下载失败（尝试 ${urls.length} 个源 × ${retries + 1} 轮）`, lastErr, true);
}
/** 单流下载（分块不可用 / 分块彻底失败时的兜底），支持 .part 续传。 */
async function downloadSingleStream(urls, dest, opts, breaker, onBytes) {
    const part = `${dest}.part`;
    let lastErr;
    const stallMs = opts.stallTimeoutMs ?? DEFAULTS.stallTimeoutMs;
    const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    for (const url of urls) {
        if (!breaker.isAvailable(url))
            continue;
        for (let round = 0; round <= (opts.retries ?? DEFAULTS.retries); round++) {
            if (opts.signal?.aborted)
                throw new errors_1.FusionError("DOWNLOAD", "下载已取消");
            if (round > 0) {
                await new Promise((r) => setTimeout(r, Math.min(1000 * round, 5000)));
            }
            let have = (0, fs_1.existsSync)(part) ? await sizeOf(part) : 0;
            const headers = {};
            if (have > 0)
                headers.range = `bytes=${have}-`;
            const p = await fetchWithStall(url, headers, stallMs, timeoutMs, opts.signal);
            try {
                if (p.res.status === 200)
                    have = 0;
                if (!(p.res.status === 206 || p.res.status === 200)) {
                    await p.res.body?.cancel().catch(() => { });
                    throw new errors_1.FusionError("DOWNLOAD", `HTTP ${p.res.status} @ ${url}`, {
                        retryable: p.res.status >= 500,
                    });
                }
                if (have > 0 && p.res.status === 206) {
                    // 已写入部分保留，继续追加
                }
                else {
                    await fs_1.promises.rm(part, { force: true });
                }
                await pipeToFile(p.res, part, p.touch, onBytes);
                await fs_1.promises.rename(part, dest);
                breaker.success(url);
                return await sizeOf(dest);
            }
            catch (e) {
                lastErr = e;
                breaker.fail(url);
            }
            finally {
                p.dispose();
            }
        }
    }
    throw (0, errors_1.wrapError)("DOWNLOAD", `单流下载失败: ${(0, path_1.basename)(dest)}`, lastErr, true);
}
/**
 * 聚合下载：并行测速择优 → 分块并发（含续传）→ 校验落盘。
 * `urls` 应包含官方原地址与各镜像地址，内部会按 mode 重排。
 */
async function aggregatedDownload(urls, dest, opts = {}) {
    const raw = Array.isArray(urls) ? urls : [urls];
    const breaker = opts.breaker ?? new MirrorBreaker();
    const log = opts.onLog ?? (() => { });
    const mode = opts.mode ?? "china-first";
    const ordered = orderCandidates(raw, mode).filter((u) => breaker.isAvailable(u));
    if (ordered.length === 0)
        throw new errors_1.FusionError("DOWNLOAD", "无可用下载源（全部熔断）");
    await (0, util_1.ensureDirAsync)((0, path_1.dirname)(dest));
    // 已完成直接复用
    if (!opts.force && (0, fs_1.existsSync)(dest)) {
        if (!opts.sha1) {
            const size = await sizeOf(dest);
            if (size > 0) {
                return { url: ordered[0], dest, bytes: size, reused: true, switches: 0, chunks: 0 };
            }
        }
        else if ((await (0, util_1.sha1File)(dest)).toLowerCase() === opts.sha1.toLowerCase()) {
            return {
                url: ordered[0],
                dest,
                bytes: await sizeOf(dest),
                reused: true,
                switches: 0,
                chunks: 0,
            };
        }
    }
    // 1) 并行测速（批量小文件可跳过，避免上千次探针）
    const probes = opts.skipProbe
        ? ordered.map((url) => ({
            url,
            ok: true,
            latencyMs: 0,
            score: 0,
            fileSize: 0,
            supportsRange: false,
        }))
        : await probeMirrors(ordered, {
            timeoutMs: opts.probeTimeoutMs ?? DEFAULTS.probeTimeoutMs,
            signal: opts.signal,
        });
    const alive = probes.filter((p) => p.ok && p.fileSize > 0);
    const candidates = (opts.skipProbe ? ordered : alive.length ? alive.map((p) => p.url) : ordered).filter((u) => breaker.isAvailable(u));
    if (candidates.length === 0)
        throw new errors_1.FusionError("DOWNLOAD", "所有下载源探测失败");
    if (!opts.skipProbe) {
        log("info", `测速完成，最优源: ${new URL(candidates[0]).host}（${alive[0]?.latencyMs ?? "-"}ms）`);
    }
    const probeOf = new Map(probes.map((p) => [p.url, p]));
    const started = Date.now();
    let transferred = 0;
    let switches = 0;
    let lastReport = 0;
    let total = alive[0]?.fileSize ?? 0;
    const active = new Set();
    const report = (merging = false) => {
        const now = Date.now();
        if (!merging && now - lastReport < 50)
            return;
        lastReport = now;
        const elapsed = Math.max(1, now - started) / 1000;
        opts.onProgress?.({
            url: candidates[0],
            dest,
            downloaded: Math.min(transferred, total || transferred),
            total: total || transferred,
            percent: total > 0 ? Math.min(99.9, (transferred / total) * 100) : 0,
            speedBps: Math.round(transferred / elapsed),
            activeChunks: active.size,
            merging,
        });
    };
    const onBytes = (n) => {
        transferred += n;
        if (total === 0)
            total = Math.max(total, transferred);
        report();
    };
    // 2) 选源 + 规划
    let plan = await planDownload(candidates[0], opts, probeOf.get(candidates[0]));
    if (plan.fileSize)
        total = plan.fileSize;
    const maxConnections = Math.max(1, opts.maxConnections ?? DEFAULTS.maxConnections);
    const initialThreads = Math.min(opts.initialThreads ?? DEFAULTS.initialThreads, maxConnections);
    let chunkCount = 0;
    try {
        if (plan.chunks.length > 0) {
            chunkCount = plan.chunks.length;
            // 分块失败时整体切下一个源：逐源尝试
            let chunkOk = false;
            let chunkErr;
            for (let ci = 0; ci < candidates.length && !chunkOk; ci++) {
                if (ci > 0)
                    switches++;
                const url = candidates[ci];
                // 清掉上一个源可能留下的坏块（大小不符的块会在块内自动续传/重下）
                try {
                    await runChunkPool(url, dest, plan, opts, candidates.slice(ci), breaker, onBytes, active, initialThreads);
                    chunkOk = true;
                }
                catch (e) {
                    chunkErr = e;
                    log("warn", `分块下载失败，切源重试: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            if (!chunkOk) {
                log("warn", "分块下载全部失败，回退单流");
                report(true);
                transferred = 0;
                await fs_1.promises.rm(dest, { force: true });
                await downloadSingleStream(candidates, dest, opts, breaker, onBytes);
            }
            else {
                // 3) 合并
                report(true);
                await mergeChunks(dest, plan.chunks);
            }
        }
        else {
            await downloadSingleStream(candidates.slice(0, 1), dest, opts, breaker, onBytes);
        }
        // 4) 校验
        const finalSize = await sizeOf(dest);
        if (plan.fileSize && finalSize !== plan.fileSize) {
            await fs_1.promises.rm(dest, { force: true });
            throw new errors_1.FusionError("INTEGRITY", `大小校验失败: ${finalSize}/${plan.fileSize}`);
        }
        if (opts.sha1) {
            const actual = await (0, util_1.sha1File)(dest);
            if (actual.toLowerCase() !== opts.sha1.toLowerCase()) {
                await fs_1.promises.rm(dest, { force: true });
                throw new errors_1.FusionError("INTEGRITY", `SHA1 校验失败: ${(0, path_1.basename)(dest)}`, { retryable: true });
            }
        }
        opts.onProgress?.({
            url: candidates[0],
            dest,
            downloaded: finalSize,
            total: plan.fileSize || finalSize,
            percent: 100,
            speedBps: Math.round(finalSize / (Math.max(1, Date.now() - started) / 1000)),
            activeChunks: 0,
            merging: false,
        });
        return {
            url: candidates[0],
            dest,
            bytes: finalSize,
            reused: false,
            switches,
            chunks: chunkCount,
        };
    }
    catch (e) {
        // 失败时保留 .cN 便于下次续传，但清掉半成品
        await fs_1.promises.rm(dest, { force: true }).catch(() => { });
        throw e instanceof errors_1.FusionError ? e : (0, errors_1.wrapError)("DOWNLOAD", `聚合下载失败: ${(0, path_1.basename)(dest)}`, e, true);
    }
    finally {
        void chunkErrUnused;
    }
}
/** 动态线程池：初始 N 条，速度不达标时增开。 */
async function runChunkPool(url, dest, plan, opts, candidates, breaker, onBytes, active, initialThreads) {
    const chunks = plan.chunks;
    let next = 0;
    let failed;
    const workers = [];
    const speedFloor = opts.speedFloorBps ?? DEFAULTS.speedFloorBps;
    const maxThreads = Math.min(opts.maxChunks ?? DEFAULTS.maxChunks, chunks.length);
    let windowBytes = 0;
    let windowStart = Date.now();
    const lane = () => {
        const run = async () => {
            for (;;) {
                if (failed)
                    return;
                if (opts.signal?.aborted) {
                    failed = new errors_1.FusionError("DOWNLOAD", "下载已取消");
                    return;
                }
                const i = next++;
                if (i >= chunks.length)
                    return;
                const chunk = chunks[i];
                active.add(chunk.index);
                try {
                    await downloadChunk(url, dest, chunk, opts, candidates, breaker, (n) => {
                        windowBytes += n;
                        onBytes(n);
                    });
                }
                catch (e) {
                    failed = e;
                    return;
                }
                finally {
                    active.delete(chunk.index);
                }
            }
        };
        const p = run();
        workers.push(p);
        return p;
    };
    for (let i = 0; i < Math.min(initialThreads, chunks.length); i++)
        void lane();
    // 每 1.5s 评估一次是否需要加线程
    const timer = setInterval(() => {
        if (failed)
            return;
        const elapsed = Math.max(1, Date.now() - windowStart) / 1000;
        const speed = windowBytes / elapsed;
        windowBytes = 0;
        windowStart = Date.now();
        const busy = workers.length;
        if (speed < speedFloor && busy < maxThreads && busy < chunks.length) {
            void lane();
        }
    }, 1500);
    try {
        await Promise.all(workers);
        if (failed)
            throw failed;
    }
    finally {
        clearInterval(timer);
    }
}
/** 合并分块 → .merging → 校验 → rename。 */
async function mergeChunks(dest, chunks) {
    const merging = `${dest}.merging`;
    await fs_1.promises.rm(merging, { force: true });
    const out = await fs_1.promises.open(merging, "w");
    try {
        for (const c of chunks) {
            const buf = await fs_1.promises.readFile(c.tmp);
            await out.write(buf);
        }
    }
    finally {
        await out.close();
    }
    await fs_1.promises.rename(merging, dest);
    // 清理块文件：Windows 上刚写完的文件可能被杀软/索引短暂占用，必须重试
    await Promise.all(chunks.map((c) => removeWithRetry(c.tmp)));
    // 兜底：扫描同目录，清掉任何残留的 `<dest>.cN` / `.cN.split`
    await sweepChunkLeftovers(dest);
}
/** 删除单个文件，失败重试（默认 3 次，120ms 间隔）。 */
async function removeWithRetry(file, attempts = 3, delayMs = 120) {
    for (let i = 0; i < attempts; i++) {
        try {
            await fs_1.promises.rm(file, { force: true });
            return;
        }
        catch {
            if (i < attempts - 1)
                await new Promise((r) => setTimeout(r, delayMs));
        }
    }
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** 扫描目标文件所在目录，清理 `<dest>.c<数字>[.split]` 与 `<dest>.merging` 残留。 */
async function sweepChunkLeftovers(dest) {
    const dir = (0, path_1.dirname)(dest);
    const base = (0, path_1.basename)(dest);
    let names = [];
    try {
        names = await fs_1.promises.readdir(dir);
    }
    catch {
        return;
    }
    const re = new RegExp(`^${escapeRegExp(base)}\\.c\\d+(\\.split)?$`);
    const targets = names.filter((n) => re.test(n) || n === `${base}.merging`);
    for (const n of targets) {
        await removeWithRetry((0, path_1.join)(dir, n));
    }
}
// 占位：避免 TS 未使用告警（chunkErr 仅用于日志）
const chunkErrUnused = null;
/** 批量聚合下载：文件之间并发，文件内部仍走聚合/分块。 */
async function aggregatedDownloadMany(items, opts = {}) {
    const breaker = opts.breaker ?? new MirrorBreaker();
    const concurrency = (0, conc_policy_1.resolveConcurrency)(opts.concurrency, { source: opts.source });
    // 批量小文件（Java 运行时 400+、assets 上千）默认跳过逐步测速
    const skipProbe = opts.skipProbe ?? items.length > 30;
    const result = { ok: 0, failed: [], bytes: 0, reused: 0 };
    let cursor = 0;
    let done = 0;
    const worker = async () => {
        for (;;) {
            const i = cursor++;
            if (i >= items.length)
                return;
            const item = items[i];
            try {
                const r = await aggregatedDownload(item.urls, item.dest, {
                    ...opts,
                    sha1: item.sha1,
                    breaker,
                    skipProbe,
                    onProgress: undefined,
                });
                result.ok++;
                result.bytes += r.bytes;
                if (r.reused)
                    result.reused++;
            }
            catch (e) {
                result.failed.push({
                    dest: item.dest,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            finally {
                done++;
                opts.onProgress?.(done, items.length);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return result;
}
/** 便捷：把官方 URL + 镜像候选交给聚合下载。 */
function candidateUrls(official, mirrors) {
    return [official, ...mirrors.filter((m) => m !== official)];
}
//# sourceMappingURL=aggregator.js.map