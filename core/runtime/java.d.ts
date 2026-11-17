/**
 * Java 运行时：检测已安装 JRE + 按 javaVersion 自动下载（多源）。
 *
 * 检测策略（跨平台）：
 *  - JAVA_HOME / PATH 上的 java；
 *  - 各平台常见安装目录扫描（含 HMCL/Prism/Modrinth 等启动器自带 JRE 目录）；
 *  - 解析 `java -version` 得到 major 版本，按版本匹配最佳 JRE。
 *
 * 自动下载（对齐 VersePC 的三源策略）：
 *  1) Mojang 官方 java-runtime 清单（piston-meta）；
 *  2) BMCLAPI 镜像清单；
 *  3) Adoptium Temurin 直链兜底（api.adoptium.net）。
 * 单个文件的下载本身也走「多镜像候选 + 聚合择优」。
 */
import { Logger } from "../core/logger";
import { MirrorManager } from "../net/mirrors";
export interface JavaRuntime {
    /** java 可执行文件绝对路径 */
    javaPath: string;
    /** 主版本号，如 8/17/21 */
    major: number;
    /** 完整版本串，如 17.0.9 */
    full?: string;
    /** 来源：env/path/scan/download/temurin/configured */
    source: string;
}
export declare class JavaService {
    private mirrors;
    private log;
    private runtimeRoot;
    constructor(mirrors: MirrorManager, log: Logger, runtimeRoot: string);
    /** 枚举本机所有可用 JRE。 */
    detectAll(): Promise<JavaRuntime[]>;
    /**
     * 找到满足 requiredMajor（可选）的最佳 JRE。
     * 优先精确 major 匹配；无则取最高 major。
     */
    findBest(requiredMajor?: number): Promise<JavaRuntime | null>;
    /**
     * 解析出用于启动的 Java：配置指定 > 本机检测 > 自动下载。
     */
    resolve(requiredMajor?: number, configuredPath?: string): Promise<JavaRuntime>;
    /**
     * 自动下载匹配 major 的 JRE（按 Mojang java-runtime 清单，多源）。
     * 结构：清单 → 当前 OS/架构的 component 条目 → 文件清单 → 并发下载。
     * 清单或文件全部失败时回退 Adoptium Temurin。
     */
    downloadRuntime(major: number, component?: string): Promise<JavaRuntime>;
    /**
     * Adoptium Temurin 直链兜底（Verse 的第三源）。
     * Windows 为 zip，macOS/Linux 为 tar.gz。
     */
    private downloadTemurin;
}
//# sourceMappingURL=java.d.ts.map