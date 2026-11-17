/**
 * 版本清单（version_manifest_v2）与版本 json 解析。
 * 负责：列版本、按 id 找到 version.json、下载解析、处理 inheritsFrom 合并。
 */
import { Logger } from "../core/logger";
import { MirrorManager } from "../net/mirrors";
import { VersionJson } from "./version";
export interface ManifestVersion {
    id: string;
    type: string;
    url: string;
    time?: string;
    releaseTime?: string;
    sha1?: string;
}
export interface VersionManifest {
    latest: {
        release: string;
        snapshot: string;
    };
    versions: ManifestVersion[];
}
export declare class ManifestService {
    private mirrors;
    private log;
    constructor(mirrors: MirrorManager, log: Logger);
    /** 拉取版本清单（多源故障转移）。 */
    fetchManifest(): Promise<VersionManifest>;
    /** 按 id 查清单条目。 */
    findVersion(id: string): Promise<ManifestVersion>;
    /** 列出版本 id（可按类型过滤）。 */
    listVersions(type?: string): Promise<ManifestVersion[]>;
    /**
     * 下载并解析 version.json，处理 inheritsFrom 合并。
     * 返回完整（已合并）的 VersionJson。
     */
    loadVersionJson(url: string): Promise<VersionJson>;
    /** 通过版本 id 加载完整 version.json。 */
    loadVersionById(id: string): Promise<VersionJson>;
}
//# sourceMappingURL=manifest.d.ts.map