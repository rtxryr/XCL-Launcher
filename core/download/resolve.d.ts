/**
 * 游戏文件解析：把 version.json 展开成「待下载文件清单」。
 * 每个文件带候选下载地址（镜像故障转移）与本地目标路径。
 *
 * 目录布局（标准 .minecraft）：
 *   libraries/<mavenPath>          依赖库（含 natives jar）
 *   versions/<id>/<id>.jar         客户端
 *   assets/indexes/<assetId>.json  资源索引
 *   assets/objects/<aa>/<hash>     资源对象
 */
import { VersionJson, mavenPath } from "../meta/version";
import { RuleContext } from "../meta/rules";
import { MirrorManager } from "../net/mirrors";
export type FileKind = "client" | "library" | "native" | "assetIndex" | "asset";
export interface ResolvedFile {
    kind: FileKind;
    /** 官方 URL（用于镜像改写与候选生成） */
    officialUrl: string;
    /** 候选下载地址（镜像优先） */
    urls: string[];
    /** 本地绝对路径 */
    dest: string;
    sha1?: string;
    size?: number;
    /** 人类可读标签 */
    label: string;
}
export interface AssetIndexObject {
    hash: string;
    size: number;
}
export interface AssetIndex {
    objects: Record<string, AssetIndexObject>;
    map_to_resources?: boolean;
    virtual?: boolean;
}
export interface ResolveOptions {
    ctx?: RuleContext;
    /** natives 解压目标目录（仅 native 类用） */
    nativesDir?: string;
}
export declare class GameResolver {
    private mirrors;
    private gameDir;
    constructor(mirrors: MirrorManager, gameDir: string);
    private candidatesFor;
    /** 解析客户端 jar + 全部库（含 native jar）。 */
    resolveLibraries(version: VersionJson, opts?: ResolveOptions): ResolvedFile[];
    /** 解析资源索引文件本身。 */
    resolveAssetIndex(version: VersionJson): ResolvedFile;
    /** 由 asset index 内容解析全部资源对象。 */
    resolveAssets(index: AssetIndex): ResolvedFile[];
}
export { mavenPath };
//# sourceMappingURL=resolve.d.ts.map