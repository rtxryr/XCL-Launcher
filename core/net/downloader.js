"use strict";
/**
 * 下载引擎 —— 取长补短的核心之一。
 *
 * 借鉴 HMCL FileDownloadTask（Range 分块/断点续传/连接池）与 XMCL file-transfer（复用连接、分片并发）：
 *  - 单文件：小文件单流下载；大文件按块并发（Range），每块独立 .part 便于断点续传；
 *  - 完整性：可选 SHA1 校验，失败自动重下；
 *  - 多文件：并发池下载一批（如成千上万的 assets）；
 *  - 故障转移：配合 MirrorManager 的候选 URL 列表，逐个尝试。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.USER_AGENT = void 0;
exports.downloadFile = downloadFile;
exports.downloadMany = downloadMany;
const fs_1 = require("fs");
const path_1 = require("path");
const errors_1 = require("../core/errors");
const util_1 = require("../core/util");
const http_1 = require("./http");
const conc_policy_1 = require("./conc-policy");
Object.defineProperty(exports, "USER_AGENT", { enumerable: true, get: function () { return http_1.USER_AGENT; } });
const DEFAULT_CHUNK_THRESHOLD = 2 * 1024 * 1024; // 2MB
const DEFAULT_CHUNK_CONCURRENCY = 4;
/**
 * 下载单个文件。传入候选 URL 列表会做故障转移。
 * 返回最终使用的 URL。
 */
async function downloadFile(urls, dest, opts = {}) {
    const candidates = Array.isArray(urls) ? urls : [urls];
    if (candidates.length === 0)
        throw new errors_1.FusionError("DOWNLOAD", "无候选下载地址");
    await (0, util_1.ensureDirAsync)((0, path_1.dirname)(dest));
    // 已存在且校验通过 → 复用
    if (!opts.force && (0, util_1.pathExists)(dest)) {
        if (!opts.sha1 || (await matchesSha1(dest, opts.sha1))) {
            return { url: candidates[0], bytes: await (0, util_1.fileSize)(dest), reused: true };
        }
    }
    let lastErr;
    for (const url of candidates) {
        try {
            const bytes = await downloadFromOne(url, dest, opts);
            if (opts.sha1 && !(await matchesSha1(dest, opts.sha1))) {
                await fs_1.promises.rm(dest, { force: true });
                throw new errors_1.FusionError("INTEGRITY", `SHA1 校验失败: ${(0, path_1.basename)(dest)}`, {
                    retryable: true,
                });
            }
            return { url, bytes, reused: false };
        }
        catch (e) {
            lastErr = e;
            // 尝试下一个候选
            continue;
        }
    }
    throw (0, errors_1.wrapError)("DOWNLOAD", `下载失败（已尝试 ${candidates.length} 个源）: ${(0, path_1.basename)(dest)}`, lastErr, true);
}
async function downloadFromOne(url, dest, opts) {
    const total = await (0, http_1.httpContentLength)(url).catch(() => 0);
    const chunkThreshold = opts.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD;
    // 分块并发由策略层决定：单文件独占时给 4，批量下载里让位给「文件并发 × 分块 ≈ 32」
    const chunkConc = opts.chunkConcurrency ?? (0, conc_policy_1.chunkConcurrencyFor)(opts.concurrency ?? 1);
    const useChunks = total > chunkThreshold && chunkConc > 1;
    if (useChunks) {
        return await downloadChunked(url, dest, total, { ...opts, chunkConcurrency: chunkConc });
    }
    return await downloadSingle(url, dest, total, opts);
}
/** 单流下载，支持断点续传（.part + Range）。 */
async function downloadSingle(url, dest, total, opts) {
    const part = `${dest}.part`;
    let have = 0;
    if ((0, util_1.pathExists)(part))
        have = await (0, util_1.fileSize)(part);
    const headers = {};
    if (have > 0 && (total === 0 || have < total))
        headers.range = `bytes=${have}-`;
    const res = await (0, http_1.httpRequest)(url, {
        headers,
        timeoutMs: opts.timeoutMs ?? 60_000,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
    // 200 = 全量（忽略断点），206 = 续传
    if (res.status === 200)
        have = 0;
    else if (res.status !== 206) {
        res.body?.cancel().catch(() => { });
        throw new errors_1.FusionError("DOWNLOAD", `HTTP ${res.status} for ${url}`, {
            retryable: res.status >= 500,
        });
    }
    const targetTotal = total || Number(res.headers.get("content-length") ?? 0) + have;
    await (0, util_1.ensureDirAsync)((0, path_1.dirname)(part));
    const fd = await fs_1.promises.open(part, have > 0 && res.status === 206 ? "a" : "w");
    let downloaded = have;
    try {
        const reader = res.body?.getReader?.();
        if (!reader) {
            // Node fetch body 不可读时退回 arrayBuffer（小文件安全）
            const ab = await res.arrayBuffer();
            await fd.write(Buffer.from(ab));
            downloaded += ab.byteLength;
            opts.onProgress?.({ url, dest, downloaded, total: targetTotal });
        }
        else {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const buf = Buffer.from(value);
                await fd.write(buf);
                downloaded += buf.length;
                opts.onProgress?.({ url, dest, downloaded, total: targetTotal });
            }
        }
    }
    finally {
        await fd.close();
    }
    await fs_1.promises.rename(part, dest);
    return downloaded;
}
/** 分块并发下载：每块写到独立 .part.<i>，完成后合并，天然支持块级断点续传。 */
async function downloadChunked(url, dest, total, opts) {
    const concurrency = opts.chunkConcurrency ?? (0, conc_policy_1.chunkConcurrencyFor)(opts.concurrency ?? 1);
    const numChunks = Math.min(concurrency, Math.max(1, Math.ceil(total / (512 * 1024))));
    const chunkSize = Math.ceil(total / numChunks);
    const partFiles = [];
    const ranges = [];
    for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(total - 1, start + chunkSize - 1);
        if (start > end)
            break;
        ranges.push([start, end]);
        partFiles.push(`${dest}.part.${i}`);
    }
    let downloaded = 0;
    const progressLock = { downloaded };
    await (0, util_1.mapConcurrent)(ranges, numChunks, async ([start, end], i) => {
        const pf = partFiles[i];
        const chunkLen = end - start + 1;
        // 块已完成则跳过（断点续传）
        if ((0, util_1.pathExists)(pf) && (await (0, util_1.fileSize)(pf)) === chunkLen) {
            progressLock.downloaded += chunkLen;
            opts.onProgress?.({
                url,
                dest,
                downloaded: progressLock.downloaded,
                total,
            });
            return;
        }
        await (0, util_1.withRetry)(async () => {
            const res = await (0, http_1.httpRequest)(url, {
                headers: { range: `bytes=${start}-${end}` },
                timeoutMs: opts.timeoutMs ?? 60_000,
                signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
            });
            if (!(res.status === 206 || res.status === 200)) {
                res.body?.cancel().catch(() => { });
                throw new errors_1.FusionError("DOWNLOAD", `分块 HTTP ${res.status}`, {
                    retryable: res.status >= 500,
                });
            }
            const ab = await res.arrayBuffer();
            await fs_1.promises.writeFile(pf, Buffer.from(ab));
        }, { retries: 2 });
        progressLock.downloaded += chunkLen;
        opts.onProgress?.({ url, dest, downloaded: progressLock.downloaded, total });
    });
    // 合并块 → 目标文件
    const ws = (0, fs_1.createWriteStream)(dest);
    try {
        for (const pf of partFiles) {
            const buf = await fs_1.promises.readFile(pf);
            await new Promise((resolveP, reject) => ws.write(buf, (err) => (err ? reject(err) : resolveP())));
        }
        await new Promise((resolveP, reject) => ws.end((err) => (err ? reject(err) : resolveP())));
    }
    catch (e) {
        ws.destroy();
        throw (0, errors_1.wrapError)("IO", "合并分块失败", e);
    }
    finally {
        // 清理块文件
        await Promise.all(partFiles.map((pf) => fs_1.promises.rm(pf, { force: true })));
        await fs_1.promises.rm(`${dest}.part`, { force: true }).catch(() => { });
    }
    downloaded = progressLock.downloaded;
    return downloaded;
}
/**
 * 并发下载一批文件（库/资源）。
 * 失败不中断整批，返回失败清单，便于上层重试或提示。
 */
async function downloadMany(items, opts = {}) {
    const concurrency = (0, conc_policy_1.resolveConcurrency)(opts.concurrency);
    const result = { ok: 0, failed: [], bytes: 0, reused: 0 };
    let done = 0;
    await (0, util_1.mapConcurrent)(items, concurrency, async (item) => {
        try {
            const r = await downloadFile(item.urls, item.dest, {
                sha1: item.sha1,
                events: opts.events,
                chunkConcurrency: (0, conc_policy_1.chunkConcurrencyFor)(concurrency),
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
            opts.onProgress?.(done, items.length, result.bytes);
            opts.events?.emit("progress", {
                phase: "download",
                current: done,
                total: items.length,
                label: item.label ?? (0, path_1.basename)(item.dest),
            });
        }
    });
    return result;
}
async function matchesSha1(file, expected) {
    const actual = await (0, util_1.sha1File)(file);
    return actual.toLowerCase() === expected.toLowerCase();
}
//# sourceMappingURL=downloader.js.map