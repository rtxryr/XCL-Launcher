/**
 * 模组加载器安装。
 *
 * 统一思路：加载器都以「继承原版」的 version.json 形式接入（inheritsFrom=base），
 * 自带 mainClass 接管启动入口 + 若干库。安装即「取加载器 version.json → 与原版合并
 * → 保存为新版本 id → 下载增量库」。
 *
 * Fabric / Quilt：官方 meta API 直接给 profile json，最干净。
 * Forge / NeoForge：从官方 maven/版本 json 取 patch，合并。
 */
import { Logger } from "../core/logger";
import { MirrorManager } from "../net/mirrors";
import { VersionJson, libraryArtifact } from "../meta/version";
export type LoaderType = "fabric" | "quilt" | "forge" | "neoforge";
export interface InstallLoaderResult {
    /** 新版本 id（含加载器） */
    versionId: string;
    /** 完整合并后的 version.json */
    version: VersionJson;
    /** 需额外下载的库文件数 */
    downloaded: number;
}
export declare class LoaderInstaller {
    private mirrors;
    private gameDir;
    private log;
    private versionsDir;
    private librariesDir;
    constructor(mirrors: MirrorManager, gameDir: string, log: Logger, versionsDir?: string, librariesDir?: string);
    /**
     * 安装加载器到某个 base 版本之上，产出新的版本 id。
     * @param base 已解析的原版 version.json
     */
    install(loader: LoaderType, base: VersionJson, loaderVersion: string): Promise<InstallLoaderResult>;
    /** 查询某加载器在指定游戏版本下可用的 loader 版本列表。 */
    listLoaderVersions(loader: LoaderType, gameVersion: string): Promise<string[]>;
}
export { libraryArtifact };
//# sourceMappingURL=index.d.ts.map