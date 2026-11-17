/**
 * 多实例管理。
 *
 * 隔离模型（借鉴 MultiMC/Prism）：
 *  - 全局 gameDir 共享 libraries / assets / versions（省磁盘、跨实例复用）；
 *  - 每个实例有独立的 .minecraft 目录（saves / mods / config / logs），
 *    作为启动时的 --gameDir，实现存档与 mod 隔离。
 */
import { Logger } from "../core/logger";
export interface InstanceLoader {
    type: "none" | "forge" | "fabric" | "quilt" | "neoforge" | "liteloader" | "optifine";
    version?: string;
}
export interface InstanceSettings {
    maxMemoryMB?: number;
    javaPath?: string;
    extraJvmArgs?: string[];
    extraGameArgs?: string[];
    /** 窗口分辨率 */
    width?: number;
    height?: number;
    fullscreen?: boolean;
}
export interface Instance {
    id: string;
    name: string;
    /** 基础 Minecraft 版本 id */
    gameVersion: string;
    /** 实际启动的版本 id（含加载器后缀），默认等于 gameVersion */
    launchVersion?: string;
    loader: InstanceLoader;
    settings: InstanceSettings;
    created: number;
    lastPlayed?: number;
    notes?: string;
}
export declare class InstanceManager {
    private instancesDir;
    private log;
    constructor(instancesDir: string, log: Logger);
    private dirOf;
    /** 实例的游戏目录（--gameDir）。 */
    gameDirOf(id: string): string;
    private jsonPath;
    list(): Promise<Instance[]>;
    get(id: string): Promise<Instance>;
    create(props: {
        name: string;
        gameVersion: string;
        loader?: InstanceLoader;
        settings?: InstanceSettings;
    }): Promise<Instance>;
    update(id: string, patch: Partial<Instance>): Promise<Instance>;
    markPlayed(id: string): Promise<void>;
    delete(id: string): Promise<void>;
    /** 复制实例（含存档/mod）。 */
    duplicate(id: string, newName: string): Promise<Instance>;
    /** 导出为目录（打包可交给分享）。返回实例根目录。 */
    exportDir(id: string): Promise<string>;
    /** 从一个目录导入实例。 */
    importFrom(srcDir: string): Promise<Instance>;
}
//# sourceMappingURL=instance.d.ts.map