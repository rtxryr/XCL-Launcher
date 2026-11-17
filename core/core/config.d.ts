/**
 * 类型化配置管理。
 * 配置根目录默认 ~/.fusionmc（可覆盖），包含下载源偏好、Java 偏好、
 * 账号/实例/联机设置。读写落盘为 config.json。
 */
import { Logger } from "./logger";
/** 下载源偏好。 */
export type MirrorId = "auto" | "official" | "bmclapi" | "mcbbs" | "custom";
export interface MirrorCustomConfig {
    /** 版本清单地址（可选） */
    versionManifestUrl?: string;
    /** maven/库地址前缀 */
    mavenUrl?: string;
    /** 资源地址前缀 */
    resourcesUrl?: string;
}
export interface RuntimeConfig {
    /** Java 可执行文件路径（留空则自动探测/下载） */
    javaPath?: string;
    /** 是否允许自动下载匹配 javaVersion 的 JRE */
    autoDownloadJava: boolean;
    /** 分配给游戏的最大堆内存（MB） */
    maxMemoryMB: number;
    /** 并发下载线程数 */
    downloadConcurrency: number;
    /** 首选下载源 */
    mirror: MirrorId;
    /** 自定义下载源（mirror=custom 时生效） */
    customMirror?: MirrorCustomConfig;
    /** 日志级别 */
    logLevel: "debug" | "info" | "warn" | "error" | "silent";
    /** Microsoft OAuth 应用客户端 ID（可配置，勿硬编码敏感值） */
    msClientId?: string;
    /** 联机：默认使用的传输方式 */
    multiplayerTransport: string;
}
export interface ConfigShape {
    /** 配置根目录 */
    root: string;
    /** 全局 .minecraft 目录（库/资源缓存） */
    gameDir: string;
    /** 实例根目录 */
    instancesDir: string;
    runtime: RuntimeConfig;
}
export declare class Config {
    private data;
    readonly logger: Logger;
    readonly path: string;
    private constructor();
    static defaultRoot(): string;
    /** 加载配置；不存在则创建默认。 */
    static load(root?: string, logger?: Logger): Config;
    get value(): ConfigShape;
    get gameDir(): string;
    get instancesDir(): string;
    get runtime(): RuntimeConfig;
    updateRuntime(patch: Partial<RuntimeConfig>): void;
    save(): Promise<void>;
    /** 派生某个模块的子 logger。 */
    moduleLogger(tag: string): Logger;
}
//# sourceMappingURL=config.d.ts.map