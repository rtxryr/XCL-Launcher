/**
 * 下载引擎 —— 取长补短的核心之一。
 *
 * 借鉴 HMCL FileDownloadTask（Range 分块/断点续传/连接池）与 XMCL file-transfer（复用连接、分片并发）：
 *  - 单文件：小文件单流下载；大文件按块并发（Range），每块独立 .part 便于断点续传；
 *  - 完整性：可选 SHA1 校验，失败自动重下；
 *  - 多文件：并发池下载一批（如成千上万的 assets）；
 *  - 故障转移：配合 MirrorManager 的候选 URL 列表，逐个尝试。
 */
import { EventBus, BackendEvents } from "../core/events";
import { USER_AGENT } from "./http";
export interface DownloadProgress {
    url: string;
    dest: string;
    downloaded: number;
    total: number;
}
export interface DownloadFileOptions {
    /** 期望 SHA1（十六进制）；下载后校验 */
    sha1?: string;
    /** 覆盖已存在文件 */
    force?: boolean;
    /** 单连接阈值：小于该值用单流，否则分块并发（字节） */
    chunkThreshold?: number;
    /** 分块并发数（大文件） */
    chunkConcurrency?: number;
    /** 进度回调 */
    onProgress?: (p: DownloadProgress) => void;
    /** 事件总线（发 progress 事件） */
    events?: EventBus<BackendEvents>;
    timeoutMs?: number;
}
/**
 * 下载单个文件。传入候选 URL 列表会做故障转移。
 * 返回最终使用的 URL。
 */
export declare function downloadFile(urls: string | string[], dest: string, opts?: DownloadFileOptions): Promise<{
    url: string;
    bytes: number;
    reused: boolean;
}>;
export interface BatchDownloadItem {
    urls: string | string[];
    dest: string;
    sha1?: string;
    label?: string;
}
export interface BatchResult {
    ok: number;
    failed: Array<{
        dest: string;
        error: string;
    }>;
    bytes: number;
    reused: number;
}
/**
 * 并发下载一批文件（库/资源）。
 * 失败不中断整批，返回失败清单，便于上层重试或提示。
 */
export declare function downloadMany(items: BatchDownloadItem[], opts?: {
    concurrency?: number;
    events?: EventBus<BackendEvents>;
    onProgress?: (done: number, total: number, bytes: number) => void;
}): Promise<BatchResult>;
export { USER_AGENT };
//# sourceMappingURL=downloader.d.ts.map