/**
 * 游戏安装编排：把「解析 → 下载 → 解压 natives → 下载资源」串成一条流水线。
 * 取长补短：并发下载 + 断点续传 + SHA1 校验 + 镜像故障转移。
 */
import { EventBus, BackendEvents } from "../core/events";
import { Logger } from "../core/logger";
import { VersionJson } from "../meta/version";
export interface InstallOptions {
    concurrency?: number;
    events?: EventBus<BackendEvents>;
    nativesDir: string;
    /** 跳过资源（仅装库+客户端，用于快速测试） */
    skipAssets?: boolean;
}
export interface InstallSummary {
    client: boolean;
    libraries: number;
    natives: number;
    assets: number;
    bytes: number;
    failed: number;
    reused: number;
}
export declare class GameInstaller {
    private mirrors;
    private gameDir;
    private log;
    private resolver;
    constructor(mirrors: import("../net/mirrors").MirrorManager, gameDir: string, log: Logger);
    /** 安装某个已解析版本的全部文件。 */
    install(version: VersionJson, opts: InstallOptions): Promise<InstallSummary>;
    /** 校验客户端 jar 是否就位。 */
    isInstalled(versionId: string): Promise<boolean>;
}
//# sourceMappingURL=install.d.ts.map