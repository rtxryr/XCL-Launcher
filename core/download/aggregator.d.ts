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
export type DownloadSourceMode = "china-first" | "auto" | "official-first" | "mojang";
export interface MirrorProbe {
    url: string;
    ok: boolean;
    /** 首字节延迟（ms） */
    latencyMs: number;
    /** 排序用得分：越大越快 */
    score: number;
    fileSize: number;
    supportsRange: boolean;
}
export interface AggregateProgress {
    url: string;
    dest: string;
    downloaded: number;
    total: number;
    /** 0~100 */
    percent: number;
    /** 实时速度 B/s */
    speedBps: number;
    /** 当前活跃分块数 */
    activeChunks: number;
    /** 是否处于合并阶段 */
    merging: boolean;
}
export interface AggregateDownloadOptions {
    /** 期望 SHA1（十六进制） */
    sha1?: string;
    /** 覆盖已存在文件 */
    force?: boolean;
    /** 下载源模式；mojang = 只用官方，不做镜像改写排序 */
    mode?: DownloadSourceMode;
    /** 分块阈值（字节），默认 1MB */
    chunkThreshold?: number;
    /** 最小块大小，默认 512KB */
    minChunkSize?: number;
    /** 最多分块数，默认 64 */
    maxChunks?: number;
    /** 初始并发线程，默认 4 */
    initialThreads?: number;
    /** 速度下限（B/s），低于则加线程，默认 256KB/s */
    speedFloorBps?: number;
    /** 分块 stall 超时，默认 60s */
    stallTimeoutMs?: number;
    /** 换源重试轮次，默认 3 */
    retries?: number;
    /** 镜像探针超时，默认 1500ms */
    probeTimeoutMs?: number;
    /** 单请求超时，默认 120s */
    timeoutMs?: number;
    /** 全局连接池上限，默认 16 */
    maxConnections?: number;
    onProgress?: (p: AggregateProgress) => void;
    onLog?: (level: "info" | "warn", message: string) => void;
    /** 外部取消 */
    signal?: AbortSignal;
    /** 共享熔断器（同一批次可复用，避免重复踩坏源） */
    breaker?: MirrorBreaker;
    /**
     * 跳过「镜像测速择优」。
     * 适合成百上千个小文件（如 Java 运行时 400+ 文件、assets）：
     * 每个文件都探 3 个源会放大成上千次请求，收益远小于开销。
     * 跳过时按 orderCandidates 的顺序直接下，失败仍会自动切源。
     */
    skipProbe?: boolean;
}
export interface AggregateResult {
    url: string;
    dest: string;
    bytes: number;
    reused: boolean;
    /** 实际使用的镜像数（分块切源次数） */
    switches: number;
    chunks: number;
}
declare const DEFAULTS: {
    chunkThreshold: number;
    minChunkSize: number;
    maxChunks: number;
    initialThreads: number;
    speedFloorBps: number;
    stallTimeoutMs: number;
    retries: number;
    probeTimeoutMs: number;
    timeoutMs: number;
    maxConnections: number;
};
/** 同一 host 连续失败 3 次 → 冷却 60s。 */
export declare class MirrorBreaker {
    private readonly threshold;
    private readonly cooldownMs;
    private state;
    constructor(threshold?: number, cooldownMs?: number);
    private key;
    isAvailable(url: string): boolean;
    fail(url: string): void;
    success(url: string): void;
    snapshot(): Array<{
        host: string;
        fails: number;
        cooldownUntil: number;
    }>;
    reset(): void;
}
/** 按下载源模式重排候选：国内优先 / 官方优先 / 仅官方。 */
export declare function orderCandidates(urls: string[], mode?: DownloadSourceMode): string[];
/** 并行测速所有候选，返回按得分降序的探测结果。 */
export declare function probeMirrors(urls: string[], opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<MirrorProbe[]>;
/**
 * 聚合下载：并行测速择优 → 分块并发（含续传）→ 校验落盘。
 * `urls` 应包含官方原地址与各镜像地址，内部会按 mode 重排。
 */
export declare function aggregatedDownload(urls: string | string[], dest: string, opts?: AggregateDownloadOptions): Promise<AggregateResult>;
export interface AggregateBatchItem {
    urls: string | string[];
    dest: string;
    sha1?: string;
    label?: string;
}
export interface AggregateBatchResult {
    ok: number;
    failed: Array<{
        dest: string;
        error: string;
    }>;
    bytes: number;
    reused: number;
}
/** 批量聚合下载：文件之间并发，文件内部仍走聚合/分块。 */
export declare function aggregatedDownloadMany(items: AggregateBatchItem[], opts?: Omit<AggregateDownloadOptions, "onProgress"> & {
    concurrency?: number;
    /** 整体进度：已完成文件数 / 总数 */
    onProgress?: (done: number, total: number) => void;
}): Promise<AggregateBatchResult>;
/** 便捷：把官方 URL + 镜像候选交给聚合下载。 */
export declare function candidateUrls(official: string, mirrors: string[]): string[];
export { DEFAULTS as AGGREGATE_DEFAULTS };
//# sourceMappingURL=aggregator.d.ts.map