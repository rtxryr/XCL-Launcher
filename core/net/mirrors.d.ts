/**
 * 下载源（镜像）体系 —— 取长补短的核心之一。
 *
 * 借鉴 HMCL 的 DownloadProvider 抽象与 BMCL/BakaXL 的 MirrorManager：
 *  - 各镜像实现统一接口，负责把「官方 URL」重写到自己的 CDN；
 *  - AutoDownloadProvider 做智能路由：优先国内镜像，失败回退官方，再回退备用镜像。
 *
 * 覆盖国内 BMCLAPI（含 modern piston-meta/piston-data 端点）与 MCBBS 镜像，
 * 也可自定义任意源（自建私服/内网镜像）。
 */
export type MirrorId = "official" | "bmclapi" | "mcbbs" | "mcim" | "custom";
export interface DownloadProvider {
    readonly id: MirrorId | "auto";
    readonly name: string;
    /** 把官方资源 URL 重写到本镜像；无法处理则返回 null（表示走原 URL）。 */
    injectUrl(officialUrl: string): string | null;
    /** 版本清单 URL（version_manifest_v2.json）。 */
    versionManifestUrl(): string;
    /** maven/库前缀（用于手拼库 URL）。 */
    mavenBase(): string;
    /** 资源对象前缀（assets/objects/<aa>/<hash>）。 */
    assetsBase(): string;
}
/** 官方源：不改写，直连 Mojang。 */
export declare class OfficialProvider implements DownloadProvider {
    readonly id: "official";
    readonly name = "Mojang \u5B98\u65B9";
    injectUrl(): string | null;
    versionManifestUrl(): string;
    mavenBase(): string;
    assetsBase(): string;
}
/** BMCLAPI：国内 CDN，bangbang93 维护，对外开放。 */
export declare class BMCLAPIProvider implements DownloadProvider {
    readonly id: "bmclapi";
    readonly name = "BMCLAPI\uFF08\u56FD\u5185\u955C\u50CF\uFF09";
    injectUrl(officialUrl: string): string | null;
    versionManifestUrl(): string;
    mavenBase(): string;
    assetsBase(): string;
}
/** MCBBS 镜像（国内社区冗余源）。 */
export declare class MCBBSProvider implements DownloadProvider {
    readonly id: "mcbbs";
    readonly name = "MCBBS \u955C\u50CF";
    injectUrl(officialUrl: string): string | null;
    versionManifestUrl(): string;
    mavenBase(): string;
    assetsBase(): string;
}
/** MCIM 镜像：国内加速 Modrinth / CurseForge（含 cdn 与 api）。 */
export declare class MCIMProvider implements DownloadProvider {
    readonly id: "mcim";
    readonly name = "MCIM\uFF08Modrinth/CurseForge \u56FD\u5185\u955C\u50CF\uFF09";
    injectUrl(officialUrl: string): string | null;
    versionManifestUrl(): string;
    mavenBase(): string;
    assetsBase(): string;
}
/** 自定义源：企业内网/私服镜像。 */
export declare class CustomProvider implements DownloadProvider {
    private readonly mavenUrl;
    private readonly resourcesUrl;
    private readonly manifestUrl?;
    readonly id: "custom";
    readonly name = "\u81EA\u5B9A\u4E49\u955C\u50CF";
    constructor(mavenUrl: string, resourcesUrl: string, manifestUrl?: string | undefined);
    injectUrl(officialUrl: string): string | null;
    versionManifestUrl(): string;
    mavenBase(): string;
    assetsBase(): string;
}
/**
 * 镜像管理器 + 智能路由（AutoDownloadProvider 语义）。
 * 一个资源 URL 会产出「候选下载地址」列表：先按当前镜像改写，再追加官方与备选镜像，
 * 下载引擎按顺序尝试，实现故障转移。
 */
export declare class MirrorManager {
    private preferred;
    private providers;
    constructor(preferred?: MirrorId | "auto", custom?: {
        mavenUrl: string;
        resourcesUrl: string;
        manifestUrl?: string;
    });
    /** 当前首选 provider（用于 versionManifest / 未改写的 URL）。 */
    primary(): DownloadProvider;
    /**
     * 产出候选下载 URL 列表（去重，保持优先级）。
     * BMCLAPI 的库文件会同时给出 `/maven/` 与 `/libraries/` 两种路径（上游两种写法都支持，
     * 让聚合下载器测速/失败切换时自行择优）。
     */
    candidates(officialUrl: string): string[];
    /** 只返回镜像改写结果（不含官方原 URL），供聚合下载器做多源择优。 */
    variants(officialUrl: string): string[];
    /** 版本清单 URL 候选（主 + 备）。 */
    manifestCandidates(): string[];
    list(): DownloadProvider[];
}
//# sourceMappingURL=mirrors.d.ts.map