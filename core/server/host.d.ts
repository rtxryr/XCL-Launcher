/**
 * 一键开服务器（Server Host）—— 参考 VersePC（GPL-3.0）实现思路。
 *
 * 目标：给定一个已安装（或仅有版本号）的版本，一键把「原版 / Forge / NeoForge / Fabric 服务端」
 * 落盘、配好 eula 与 server.properties、同步客户端 mods，并能启动 / 发命令 / 停止 / 删除。
 *
 * 关键设计（与 VersePC 对齐）：
 *  - 目录与索引：rootDir/index.json 记录所有服务器，每个服务器一个子目录；
 *  - 服务端 jar：downloads.server + 多镜像候选（BMCLAPI 兜底 URL），聚合下载带 sha1 校验；
 *  - 模组端：从 version.libraries 判定加载器，下载 installer 后 spawn java 完成安装；
 *  - 启动：端口探测避让、按 launchKind 拼命令、JVM 参数固定为 G1GC 一套、
 *    readline 逐行转发日志并按关键字判定 running / Java 版本过低。
 */
import { Logger } from "../core/logger";
import { ManifestService } from "../meta/manifest";
import { MirrorManager } from "../net/mirrors";
import { JavaService } from "../runtime/java";
/** 单条服务器输出日志的级别（cmd 表示「我们写进 stdin 的命令回显」）。 */
export type ServerLogLevel = "info" | "warn" | "err" | "cmd";
export interface ServerLogEvent {
    id: string;
    line: string;
    level: ServerLogLevel;
}
/** 创建服务器时用户可配置的项（对齐 VersePC ServerSpec）。 */
export interface ServerSpec {
    name: string;
    versionId: string;
    port?: number;
    motd?: string;
    maxMemoryMB?: number;
    onlineMode?: boolean;
    difficulty?: string;
    gamemode?: string;
    maxPlayers?: number;
    levelName?: string;
    viewDistance?: number;
    /** 客户端实例目录，用于同步 mods */
    clientDir?: string;
    /** 默认 true（仅当 clientDir 存在时生效） */
    syncClientMods?: boolean;
    /** 自定义服务器目录 */
    dir?: string;
}
/** index.json 中的服务器条目。 */
export interface ServerEntry {
    id: string;
    name: string;
    versionId: string;
    port: number;
    dir: string;
    createdAt: number;
    updatedAt: number;
    launchKind?: string;
    javaMajor?: number;
}
export type ServerState = "installing" | "ready" | "starting" | "running" | "stopped" | "error";
export interface ServerStatus {
    id: string;
    state: ServerState;
    port: number;
    pid?: number;
    startedAt?: number;
    message?: string;
}
export interface ServerHostOptions {
    mirrors: MirrorManager;
    manifest: ManifestService;
    java: JavaService;
    log: Logger;
    /** 服务器根目录，内部存 index.json 与各服务器子目录 */
    rootDir: string;
    onLog?: (e: ServerLogEvent) => void;
    onStatus?: (s: ServerStatus) => void;
}
/** 默认 server.properties 行（`key=value` 数组，顺序固定）。 */
export declare function serverPropertiesDefaults(): string[];
/** 清洗服务器名作为目录名：替换非法字符、压缩空白、截断 64 字符。 */
export declare function sanitizeServerName(name: string): string;
/** 按文件列表（可含路径）判定启动方式。 */
export declare function detectLaunchKindFromFiles(files: string[]): string;
/** 该 MC 版本建议的 Java 主版本（Verse 同款规则）。 */
export declare function requiredJavaMajor(mcVersion: string): number;
/**
 * 渲染 server.properties。
 * - 不传 existing：输出默认全集 + 用户覆盖项；
 * - 传 existing：只改写关键键（`^key=`），其余行原样保留，缺失的关键键补在末尾。
 */
export declare function renderServerProperties(spec: ServerSpec, existing?: string): string;
export declare class ServerHost {
    private readonly opts;
    private readonly rootDir;
    private readonly indexFile;
    private readonly entries;
    private readonly specs;
    private readonly statuses;
    private readonly runtimes;
    private rootReady?;
    constructor(opts: ServerHostOptions);
    /** 初始化根目录与 index.json。 */
    ensureRoot(): Promise<void>;
    private writeIndex;
    private upsertEntry;
    private setStatus;
    private emit;
    /** 读取版本链（自身 + inheritsFrom 父版本，最多 12 层）。 */
    private loadChain;
    /** 目录选择：自定义目录优先，否则用清洗后的名字（冲突时加 id 后缀）。 */
    private pickDir;
    /** 一键创建（安装）服务器。 */
    create(spec: ServerSpec): Promise<ServerEntry>;
    /** 原版：下载 server.jar。 */
    private installVanilla;
    /** 模组端：下载 installer 并 spawn java 安装。 */
    private installModded;
    /** 多源逐个试下载 installer，成功判据：文件 size > 1024。 */
    private downloadInstaller;
    /** 运行子进程并把输出转发为日志，超时强杀。 */
    private runProcess;
    /** eula.txt（已同意 EULA，否则服务端会直接退出）。 */
    private writeEula;
    /** 写 server.properties（首次全量，之后只改关键项）。 */
    private writeProperties;
    /** 同步客户端 mods 到服务端目录。 */
    private syncMods;
    /** 按目录内容判定 launchKind。 */
    private detectLaunchKind;
    /** 启动服务器。 */
    start(id: string): Promise<ServerStatus>;
    /** 按 launchKind 拼启动命令。 */
    private buildLaunchCommand;
    /** 逐行判定服务器状态 / Java 版本问题。 */
    private inspectLine;
    /** 子进程环境：注入 JAVA_HOME / PATH，移除 JAVA_TOOL_OPTIONS。 */
    private childEnv;
    /** 停止服务器（优雅 stop，15s 未退出则强杀）。 */
    stop(id: string): Promise<{
        forced: boolean;
    }>;
    /** 向服务器 stdin 发送命令（如 say / op / whitelist）。 */
    command(id: string, cmd: string): void;
    /** 删除服务器（运行中先停）。 */
    remove(id: string): Promise<void>;
    /** 服务器列表。 */
    list(): ServerEntry[];
    /** 运行状态（不传 id 返回全部）。 */
    status(id?: string): ServerStatus | ServerStatus[];
    /** 应用退出时停止全部服务器。 */
    stopAll(): Promise<void>;
}
//# sourceMappingURL=host.d.ts.map