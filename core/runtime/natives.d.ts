/**
 * 原生库（natives）解压。
 * natives jar 内含 .dll/.so/.dylib，需解压到 natives 目录，由 -Djava.library.path 指给 JVM。
 * 用 yauzl 流式读取（安全，避免整包解压的符号链接/内存炸弹风险），只落白名单后缀文件。
 */
export interface ExtractOptions {
    /** 排除条目（Mojang extract.exclude 规则） */
    exclude?: string[];
    /** 只保留这些后缀（默认原生库） */
    includeExt?: RegExp;
}
/**
 * 从 natives jar 解压原生库到 destDir。
 * 返回解压出的文件名列表。
 */
export declare function extractNatives(jarPath: string, destDir: string, opts?: ExtractOptions): Promise<string[]>;
/** 清空并重建 natives 目录。 */
export declare function resetNativesDir(dir: string): Promise<void>;
//# sourceMappingURL=natives.d.ts.map