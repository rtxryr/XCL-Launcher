/**
 * 全量下载源目录 —— 对齐 VersePC `server/context.js` 的 `ctx.mirrors` / `ctx.urls`。
 *
 * 设计目的：把「某个资源该有哪些源」集中成一张表，下载器不必到处写死 URL。
 * 每个 EndpointSet 都包含「官方地址 + 镜像列表」，聚合下载器会并行测速择优。
 *
 * 许可说明：源清单参考 VersePC（GPL-3.0）的公开配置，URL 为各服务方的公开端点。
 */
export type SourceCategory = "metadata" | "library" | "asset" | "loader" | "java" | "mod-platform" | "skin";
export interface EndpointSet {
    id: string;
    name: string;
    category: SourceCategory;
    /** 官方/原始地址（不带结尾斜杠，除非是目录前缀） */
    official: string;
    /** 镜像前缀，按优先级排列 */
    mirrors: string[];
    note?: string;
}
export declare const BMCLAPI = "https://bmclapi2.bangbang93.com";
export declare const MCIM = "https://mod.mcimirror.top";
/** 版本清单（version_manifest_v2.json）。 */
export declare const VERSION_MANIFEST: EndpointSet;
/** 依赖库 maven（BMCLAPI 同时支持 /maven/ 与 /libraries/）。 */
export declare const LIBRARIES_MAVEN: EndpointSet;
/** 资源对象 CDN（assets/objects）。 */
export declare const ASSETS_CDN: EndpointSet;
/** Fabric 元数据 API（loader 版本列表）。 */
export declare const FABRIC_META: EndpointSet;
/** Fabric maven（installer / loader jar）。 */
export declare const FABRIC_MAVEN: EndpointSet;
/** Forge maven。 */
export declare const FORGE_MAVEN: EndpointSet;
/** NeoForge maven。 */
export declare const NEOFORGE_MAVEN: EndpointSet;
/** NeoForge 版本 API。 */
export declare const NEOFORGE_API: EndpointSet;
/**
 * Java 运行时清单（Mojang java-runtime all.json）。
 * 注意：Verse 的真实常量是 .../java-runtime/<hash>/all.json，hash 会随清单更新，
 * 这里保留官方与 BMCLAPI 两条，聚合下载器会择优。
 */
export declare const JAVA_RUNTIME_MANIFEST: EndpointSet;
/** Adoptium / Temurin 下载 API（Verse 的第三种 Java 源）。 */
export declare const TEMURIN_API = "https://api.adoptium.net/v3";
/** BellSoft Liberica（Verse 记录的兜底 JDK 源）。 */
export declare const LIBERICA_BASE = "https://download.bell-sw.com/java/";
/** Modrinth 官方 API / 镜像。 */
export declare const MODRINTH_API: EndpointSet;
/** Modrinth 文件 CDN / 镜像。 */
export declare const MODRINTH_CDN: EndpointSet;
/** CurseForge 官方 API / 镜像。 */
export declare const CURSEFORGE_API: EndpointSet;
/** CurseForge 文件 CDN / 镜像。 */
export declare const CURSEFORGE_CDN: EndpointSet;
/** 皮肤纹理源（多源冗余，Verse 同款）。 */
export declare const SKIN_SERVICES: string[];
/** 头像源（多源冗余）。 */
export declare const AVATAR_SERVICES: string[];
/** 全部端点集合（用于文档/诊断/CLI 展示）。 */
export declare const ALL_SOURCE_SETS: EndpointSet[];
/** 把某个官方 URL 按端点集替换前缀，得到镜像候选。 */
export declare function remapBySet(set: EndpointSet, url: string): string[];
/** 版本清单候选（官方优先，BMCLAPI 兜底由聚合器测速决定）。 */
export declare function versionManifestCandidates(): string[];
/** Java 运行时清单候选。 */
export declare function javaRuntimeManifestCandidates(): string[];
/**
 * Adoptium Temurin 直链模板。
 * 例：https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse
 */
export declare function temurinUrl(major: number, os: string, arch: string): string;
/** 皮肤/头像 URL 展开。 */
export declare function skinUrls(uuid: string): string[];
export declare function avatarUrls(uuid: string): string[];
/** 供 CLI/诊断输出的一张表。 */
export declare function sourceCatalog(): Array<{
    id: string;
    name: string;
    category: SourceCategory;
    official: string;
    mirrors: string[];
    note?: string;
}>;
//# sourceMappingURL=sources.d.ts.map