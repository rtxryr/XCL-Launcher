/**
 * 通用工具：路径、哈希、并发控制、重试、文件原子写。
 * 各模块共享，尽量少依赖第三方。
 */
export declare function ensureDir(dir: string): string;
export declare function ensureDirAsync(dir: string): Promise<string>;
export declare function pathExists(p: string): boolean;
export declare function fileSize(p: string): Promise<number>;
/** 计算文件 SHA1（Minecraft 用 sha1 校验资源/库）。 */
export declare function sha1File(path: string): Promise<string>;
export declare function sha1String(s: string): string;
/** 原子写文件：先写临时文件再 rename，避免半截文件。 */
export declare function atomicWrite(path: string, data: string | Buffer): Promise<void>;
export declare function readJson<T>(path: string): Promise<T>;
export declare function writeJson(path: string, value: unknown): Promise<void>;
/** 绝对路径解析，相对路径基于 cwd。 */
export declare function abs(p: string): string;
export declare function joinPath(...parts: string[]): string;
/** 简单并发池：限制同时运行的异步任务数。 */
export declare function mapConcurrent<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>;
export interface RetryOpts {
    retries?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    onRetry?: (err: unknown, attempt: number) => void;
    shouldRetry?: (err: unknown) => boolean;
}
/** 指数退避重试。 */
export declare function withRetry<T>(fn: (attempt: number) => Promise<T>, opts?: RetryOpts): Promise<T>;
export declare function sleep(ms: number): Promise<void>;
/** 当前操作系统映射到 Mojang 命名（windows/osx/linux）。 */
export declare function mojangOs(): "windows" | "osx" | "linux";
/** classpath 分隔符。 */
export declare function classpathSep(): string;
/** 人类可读字节数。 */
export declare function humanSize(bytes: number): string;
/** 简易防抖（用于 UI 进度事件合并）。 */
export declare function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number): (...args: A) => void;
//# sourceMappingURL=util.d.ts.map