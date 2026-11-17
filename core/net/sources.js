"use strict";
/**
 * 全量下载源目录 —— 对齐 VersePC `server/context.js` 的 `ctx.mirrors` / `ctx.urls`。
 *
 * 设计目的：把「某个资源该有哪些源」集中成一张表，下载器不必到处写死 URL。
 * 每个 EndpointSet 都包含「官方地址 + 镜像列表」，聚合下载器会并行测速择优。
 *
 * 许可说明：源清单参考 VersePC（GPL-3.0）的公开配置，URL 为各服务方的公开端点。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_SOURCE_SETS = exports.AVATAR_SERVICES = exports.SKIN_SERVICES = exports.CURSEFORGE_CDN = exports.CURSEFORGE_API = exports.MODRINTH_CDN = exports.MODRINTH_API = exports.LIBERICA_BASE = exports.TEMURIN_API = exports.JAVA_RUNTIME_MANIFEST = exports.NEOFORGE_API = exports.NEOFORGE_MAVEN = exports.FORGE_MAVEN = exports.FABRIC_MAVEN = exports.FABRIC_META = exports.ASSETS_CDN = exports.LIBRARIES_MAVEN = exports.VERSION_MANIFEST = exports.MCIM = exports.BMCLAPI = void 0;
exports.remapBySet = remapBySet;
exports.versionManifestCandidates = versionManifestCandidates;
exports.javaRuntimeManifestCandidates = javaRuntimeManifestCandidates;
exports.temurinUrl = temurinUrl;
exports.skinUrls = skinUrls;
exports.avatarUrls = avatarUrls;
exports.sourceCatalog = sourceCatalog;
exports.BMCLAPI = "https://bmclapi2.bangbang93.com";
exports.MCIM = "https://mod.mcimirror.top";
/** 版本清单（version_manifest_v2.json）。 */
exports.VERSION_MANIFEST = {
    id: "version-manifest",
    name: "版本清单",
    category: "metadata",
    official: "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    mirrors: [
        `${exports.BMCLAPI}/mc/game/version_manifest_v2.json`,
        "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    ],
};
/** 依赖库 maven（BMCLAPI 同时支持 /maven/ 与 /libraries/）。 */
exports.LIBRARIES_MAVEN = {
    id: "libraries",
    name: "依赖库 Maven",
    category: "library",
    official: "https://libraries.minecraft.net/",
    mirrors: [`${exports.BMCLAPI}/maven/`, `${exports.BMCLAPI}/libraries/`],
    note: "BMCLAPI 的 /libraries/ 为 VersePC 采用的路径，/maven/ 为 HMCL 采用的路径，两者均可用",
};
/** 资源对象 CDN（assets/objects）。 */
exports.ASSETS_CDN = {
    id: "assets",
    name: "游戏资源对象",
    category: "asset",
    official: "https://resources.download.minecraft.net/",
    mirrors: [`${exports.BMCLAPI}/assets/`],
};
/** Fabric 元数据 API（loader 版本列表）。 */
exports.FABRIC_META = {
    id: "fabric-meta",
    name: "Fabric 元数据",
    category: "loader",
    official: "https://meta.fabricmc.net/",
    mirrors: [`${exports.BMCLAPI}/fabric-meta/`],
};
/** Fabric maven（installer / loader jar）。 */
exports.FABRIC_MAVEN = {
    id: "fabric-maven",
    name: "Fabric Maven",
    category: "loader",
    official: "https://maven.fabricmc.net/",
    mirrors: [`${exports.BMCLAPI}/maven/`],
};
/** Forge maven。 */
exports.FORGE_MAVEN = {
    id: "forge-maven",
    name: "Forge Maven",
    category: "loader",
    official: "https://maven.minecraftforge.net/",
    mirrors: [`${exports.BMCLAPI}/maven/`, "https://files.minecraftforge.net/maven/"],
};
/** NeoForge maven。 */
exports.NEOFORGE_MAVEN = {
    id: "neoforge-maven",
    name: "NeoForge Maven",
    category: "loader",
    official: "https://maven.neoforged.net/releases/",
    mirrors: [`${exports.BMCLAPI}/maven/`],
};
/** NeoForge 版本 API。 */
exports.NEOFORGE_API = {
    id: "neoforge-api",
    name: "NeoForge 版本 API",
    category: "loader",
    official: "https://maven.neoforged.net/api/maven/",
    mirrors: [],
};
/**
 * Java 运行时清单（Mojang java-runtime all.json）。
 * 注意：Verse 的真实常量是 .../java-runtime/<hash>/all.json，hash 会随清单更新，
 * 这里保留官方与 BMCLAPI 两条，聚合下载器会择优。
 */
exports.JAVA_RUNTIME_MANIFEST = {
    id: "java-runtime-manifest",
    name: "Java 运行时清单",
    category: "java",
    official: "https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json",
    mirrors: [
        `${exports.BMCLAPI}/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json`,
    ],
};
/** Adoptium / Temurin 下载 API（Verse 的第三种 Java 源）。 */
exports.TEMURIN_API = "https://api.adoptium.net/v3";
/** BellSoft Liberica（Verse 记录的兜底 JDK 源）。 */
exports.LIBERICA_BASE = "https://download.bell-sw.com/java/";
/** Modrinth 官方 API / 镜像。 */
exports.MODRINTH_API = {
    id: "modrinth-api",
    name: "Modrinth API",
    category: "mod-platform",
    official: "https://api.modrinth.com/v2",
    mirrors: [`${exports.MCIM}/modrinth/v2`],
};
/** Modrinth 文件 CDN / 镜像。 */
exports.MODRINTH_CDN = {
    id: "modrinth-cdn",
    name: "Modrinth 文件 CDN",
    category: "mod-platform",
    official: "https://cdn.modrinth.com/",
    mirrors: [`${exports.MCIM}/`, "https://cdn-alt.modrinth.com/"],
    note: "官方 cdn 在国内常 307 到 cdn-alt，MCIM 直出 200",
};
/** CurseForge 官方 API / 镜像。 */
exports.CURSEFORGE_API = {
    id: "curseforge-api",
    name: "CurseForge API",
    category: "mod-platform",
    official: "https://api.curseforge.com/v1",
    mirrors: [`${exports.MCIM}/curseforge/v1`],
};
/** CurseForge 文件 CDN / 镜像。 */
exports.CURSEFORGE_CDN = {
    id: "curseforge-cdn",
    name: "CurseForge 文件 CDN",
    category: "mod-platform",
    official: "https://edge.forgecdn.net/",
    mirrors: [`${exports.MCIM}/`, "https://mediafilez.forgecdn.net/", "https://media.forgecdn.net/"],
};
/** 皮肤纹理源（多源冗余，Verse 同款）。 */
exports.SKIN_SERVICES = [
    "https://mc-heads.net/skin/{uuid}",
    "https://crafatar.com/skins/{uuid}",
    "https://minotar.net/skin/{uuid}",
    "https://visage.surgeplay.com/skin/{uuid}",
];
/** 头像源（多源冗余）。 */
exports.AVATAR_SERVICES = [
    "https://minotar.net/helm/{uuid}.png",
    "https://mc-heads.net/avatar/{uuid}/64",
    "https://crafatar.com/avatars/{uuid}?size=64&overlay",
    "https://visage.surgeplay.com/face/64/{uuid}",
];
/** 全部端点集合（用于文档/诊断/CLI 展示）。 */
exports.ALL_SOURCE_SETS = [
    exports.VERSION_MANIFEST,
    exports.LIBRARIES_MAVEN,
    exports.ASSETS_CDN,
    exports.FABRIC_META,
    exports.FABRIC_MAVEN,
    exports.FORGE_MAVEN,
    exports.NEOFORGE_MAVEN,
    exports.NEOFORGE_API,
    exports.JAVA_RUNTIME_MANIFEST,
    exports.MODRINTH_API,
    exports.MODRINTH_CDN,
    exports.CURSEFORGE_API,
    exports.CURSEFORGE_CDN,
];
/** 把某个官方 URL 按端点集替换前缀，得到镜像候选。 */
function remapBySet(set, url) {
    const out = [];
    if (url.startsWith(set.official)) {
        const tail = url.slice(set.official.length);
        for (const m of set.mirrors)
            out.push(m + tail);
    }
    out.push(url);
    return [...new Set(out)];
}
/** 版本清单候选（官方优先，BMCLAPI 兜底由聚合器测速决定）。 */
function versionManifestCandidates() {
    return [exports.VERSION_MANIFEST.official, ...exports.VERSION_MANIFEST.mirrors];
}
/** Java 运行时清单候选。 */
function javaRuntimeManifestCandidates() {
    return [exports.JAVA_RUNTIME_MANIFEST.official, ...exports.JAVA_RUNTIME_MANIFEST.mirrors];
}
/**
 * Adoptium Temurin 直链模板。
 * 例：https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse
 */
function temurinUrl(major, os, arch) {
    const o = os === "windows" ? "windows" : os === "mac" || os === "osx" ? "mac" : os === "linux" ? "linux" : os;
    const a = arch === "arm64" || arch === "aarch64" ? "aarch64" : "x64";
    return `${exports.TEMURIN_API}/binary/latest/${major}/ga/${o}/${a}/jre/hotspot/normal/eclipse`;
}
/** 皮肤/头像 URL 展开。 */
function skinUrls(uuid) {
    return exports.SKIN_SERVICES.map((t) => t.replace("{uuid}", uuid));
}
function avatarUrls(uuid) {
    return exports.AVATAR_SERVICES.map((t) => t.replace("{uuid}", uuid));
}
/** 供 CLI/诊断输出的一张表。 */
function sourceCatalog() {
    return exports.ALL_SOURCE_SETS.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        official: s.official,
        mirrors: s.mirrors,
        note: s.note,
    }));
}
//# sourceMappingURL=sources.js.map