/**
 * HTTP 客户端封装。
 * 基于 Node 全局 fetch（undici），提供超时、重试、Range 支持、JSON 便捷方法。
 * 下载引擎与元数据拉取都走这里，统一 UA 与错误处理。
 */
export declare const USER_AGENT = "FusionMC-Core/0.1 (+https://github.com/fusionmc)";
export interface HttpOptions {
    timeoutMs?: number;
    headers?: Record<string, string>;
    retries?: number;
    /** 仅返回头部（用于探测大小） */
    method?: "GET" | "HEAD";
}
/** 发起请求并返回 Response（未自动消费 body）。 */
export declare function httpRequest(url: string, opts?: HttpOptions & {
    signal?: AbortSignal;
}): Promise<Response>;
/** GET 整个 body 为 Buffer。非 2xx 抛错。 */
export declare function httpGetBuffer(url: string, opts?: HttpOptions & {
    signal?: AbortSignal;
}): Promise<Buffer>;
/** GET 并解析 JSON。 */
export declare function httpGetJson<T>(url: string, opts?: HttpOptions): Promise<T>;
/** 探测资源大小（优先 HEAD，失败回退 Range GET）。 */
export declare function httpContentLength(url: string): Promise<number>;
export declare function isHttpStatus(e: unknown, status: number): boolean;
//# sourceMappingURL=http.d.ts.map