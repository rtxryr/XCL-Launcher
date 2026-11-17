"use strict";
/**
 * HTTP 客户端封装。
 * 基于 Node 全局 fetch（undici），提供超时、重试、Range 支持、JSON 便捷方法。
 * 下载引擎与元数据拉取都走这里，统一 UA 与错误处理。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.USER_AGENT = void 0;
exports.httpRequest = httpRequest;
exports.httpGetBuffer = httpGetBuffer;
exports.httpGetJson = httpGetJson;
exports.httpContentLength = httpContentLength;
exports.isHttpStatus = isHttpStatus;
const errors_1 = require("../core/errors");
const util_1 = require("../core/util");
exports.USER_AGENT = "FusionMC-Core/0.1 (+https://github.com/fusionmc)";
function makeSignal(timeoutMs) {
    return AbortSignal.timeout(timeoutMs);
}
/** 发起请求并返回 Response（未自动消费 body）。 */
async function httpRequest(url, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    try {
        const res = await fetch(url, {
            method: opts.method ?? "GET",
            headers: { "user-agent": exports.USER_AGENT, ...(opts.headers ?? {}) },
            signal: opts.signal ?? makeSignal(timeoutMs),
        });
        return res;
    }
    catch (e) {
        throw (0, errors_1.wrapError)("NETWORK", `请求失败: ${url}`, e, true);
    }
}
/** GET 整个 body 为 Buffer。非 2xx 抛错。 */
async function httpGetBuffer(url, opts = {}) {
    const res = await (0, util_1.withRetry)(async () => {
        const r = await httpRequest(url, opts);
        if (!r.ok && r.status !== 206) {
            throw new errors_1.FusionError("NETWORK", `HTTP ${r.status} for ${url}`, {
                retryable: r.status >= 500 || r.status === 429,
            });
        }
        return r;
    }, {
        retries: opts.retries ?? 2,
        shouldRetry: (e) => e instanceof errors_1.FusionError && e.retryable,
    });
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
}
/** GET 并解析 JSON。 */
async function httpGetJson(url, opts = {}) {
    const buf = await httpGetBuffer(url, {
        ...opts,
        headers: { accept: "application/json", ...(opts.headers ?? {}) },
    });
    try {
        return JSON.parse(buf.toString("utf-8"));
    }
    catch (e) {
        throw (0, errors_1.wrapError)("NETWORK", `JSON 解析失败: ${url}`, e);
    }
}
/** 探测资源大小（优先 HEAD，失败回退 Range GET）。 */
async function httpContentLength(url) {
    try {
        const head = await httpRequest(url, { method: "HEAD", timeoutMs: 15_000 });
        const len = head.headers.get("content-length");
        head.body?.cancel().catch(() => { });
        if (len && Number(len) > 0)
            return Number(len);
    }
    catch {
        /* fallthrough */
    }
    // 回退：请求前 1 字节，读 Content-Range 的总长度
    const res = await httpRequest(url, {
        headers: { range: "bytes=0-0" },
        timeoutMs: 15_000,
    });
    const cr = res.headers.get("content-range"); // bytes 0-0/12345
    res.body?.cancel().catch(() => { });
    if (cr) {
        const total = cr.split("/")[1];
        if (total && total !== "*")
            return Number(total);
    }
    const len = res.headers.get("content-length");
    return len ? Number(len) : 0;
}
function isHttpStatus(e, status) {
    return e instanceof errors_1.FusionError && e.message.includes(`HTTP ${status}`);
}
//# sourceMappingURL=http.js.map