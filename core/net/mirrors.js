"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MirrorManager = exports.CustomProvider = exports.MCIMProvider = exports.MCBBSProvider = exports.BMCLAPIProvider = exports.OfficialProvider = void 0;
/**
 * 官方 → BMCLAPI 的重写规则。
 * 与 VersePC `ctx.mirrors.BMCLAPI_MIRROR` 的 18 条映射对齐（补齐 launcher/piston-data、
 * meta.fabricmc、maven.neoforged、Modrinth/CurseForge 系列）。
 */
const BMCLAPI_RULES = [
    // 版本清单 / 客户端 / 服务端 元数据
    [/^https?:\/\/(piston-meta|launchermeta|launcher|piston-data)\.mojang\.com\//i, "https://bmclapi2.bangbang93.com/"],
    [/^https?:\/\/(piston-data|piston\.data)\.mojang\.com\//i, "https://bmclapi2.bangbang93.com/"],
    // 依赖库（BMCLAPI 同时提供 /maven/ 与 /libraries/ 两种路径）
    [/^https?:\/\/libraries\.minecraft\.net\//i, "https://bmclapi2.bangbang93.com/maven/"],
    // 资源对象
    [/^https?:\/\/resources\.download\.minecraft\.net\//i, "https://bmclapi2.bangbang93.com/assets/"],
    // Fabric 元数据 API
    [/^https?:\/\/meta\.fabricmc\.net\//i, "https://bmclapi2.bangbang93.com/fabric-meta/"],
    // Forge / NeoForge / Fabric maven
    [/^https?:\/\/files\.minecraftforge\.net\/maven\//i, "https://bmclapi2.bangbang93.com/maven/"],
    [/^https?:\/\/maven\.minecraftforge\.net\//i, "https://bmclapi2.bangbang93.com/maven/"],
    [/^https?:\/\/maven\.neoforged\.net\/releases\//i, "https://bmclapi2.bangbang93.com/maven/"],
    [/^https?:\/\/maven\.neoforged\.net\/maven\//i, "https://bmclapi2.bangbang93.com/maven/"],
    [/^https?:\/\/maven\.fabricmc\.net\//i, "https://bmclapi2.bangbang93.com/maven/"],
    // 其他 maven 仓库
    [/^https?:\/\/(maven\.)?maven\.parchmentmc\.org\//i, "https://bmclapi2.bangbang93.com/maven/"],
    [/^https?:\/\/repo\.maven\.apache\.org\/maven2\//i, "https://bmclapi2.bangbang93.com/maven/"],
];
/**
 * Modrinth / CurseForge 国内镜像（MCIM，mod.mcimirror.top）。
 * VersePC 实测：官方 cdn.modrinth.com 在国内会 307 到 cdn-alt，速度仅 ~22KB/s；
 * 该镜像直出 200，可达 10MB/s+。
 */
const MCIM_RULES = [
    [/^https?:\/\/cdn(-alt)?\.modrinth\.com\//i, "https://mod.mcimirror.top/"],
    [/^https?:\/\/staging-api\.modrinth\.com\//i, "https://mod.mcimirror.top/modrinth/"],
    [/^https?:\/\/api\.modrinth\.com\//i, "https://mod.mcimirror.top/modrinth/"],
    [/^https?:\/\/api\.curseforge\.com\//i, "https://mod.mcimirror.top/curseforge/"],
    [/^https?:\/\/edge\.forgecdn\.net\//i, "https://mod.mcimirror.top/"],
    [/^https?:\/\/mediafilez\.forgecdn\.net\//i, "https://mod.mcimirror.top/"],
    [/^https?:\/\/media\.forgecdn\.net\//i, "https://mod.mcimirror.top/"],
];
const MCBBS_RULES = [
    [/^https?:\/\/libraries\.minecraft\.net\//i, "https://download.mcbbs.net/maven/"],
    [/^https?:\/\/(piston-meta|launchermeta)\.mojang\.com\//i, "https://download.mcbbs.net/"],
    [/^https?:\/\/resources\.download\.minecraft\.net\//i, "https://download.mcbbs.net/assets/"],
];
function applyRules(url, rules) {
    for (const [re, to] of rules) {
        if (re.test(url))
            return url.replace(re, to);
    }
    return null;
}
/** 官方源：不改写，直连 Mojang。 */
class OfficialProvider {
    id = "official";
    name = "Mojang 官方";
    injectUrl() {
        return null; // 用原 URL
    }
    versionManifestUrl() {
        return "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
    }
    mavenBase() {
        return "https://libraries.minecraft.net/";
    }
    assetsBase() {
        return "https://resources.download.minecraft.net/";
    }
}
exports.OfficialProvider = OfficialProvider;
/** BMCLAPI：国内 CDN，bangbang93 维护，对外开放。 */
class BMCLAPIProvider {
    id = "bmclapi";
    name = "BMCLAPI（国内镜像）";
    injectUrl(officialUrl) {
        return applyRules(officialUrl, BMCLAPI_RULES);
    }
    versionManifestUrl() {
        return "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json";
    }
    mavenBase() {
        return "https://bmclapi2.bangbang93.com/maven/";
    }
    assetsBase() {
        return "https://bmclapi2.bangbang93.com/assets/";
    }
}
exports.BMCLAPIProvider = BMCLAPIProvider;
/** MCBBS 镜像（国内社区冗余源）。 */
class MCBBSProvider {
    id = "mcbbs";
    name = "MCBBS 镜像";
    injectUrl(officialUrl) {
        return applyRules(officialUrl, MCBBS_RULES);
    }
    versionManifestUrl() {
        return "https://download.mcbbs.net/mc/game/version_manifest_v2.json";
    }
    mavenBase() {
        return "https://download.mcbbs.net/maven/";
    }
    assetsBase() {
        return "https://download.mcbbs.net/assets/";
    }
}
exports.MCBBSProvider = MCBBSProvider;
/** MCIM 镜像：国内加速 Modrinth / CurseForge（含 cdn 与 api）。 */
class MCIMProvider {
    id = "mcim";
    name = "MCIM（Modrinth/CurseForge 国内镜像）";
    injectUrl(officialUrl) {
        return applyRules(officialUrl, MCIM_RULES);
    }
    versionManifestUrl() {
        // MCIM 不代理版本清单；借用 BMCLAPI 以保证国内可达
        return "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json";
    }
    mavenBase() {
        return "https://bmclapi2.bangbang93.com/maven/";
    }
    assetsBase() {
        return "https://bmclapi2.bangbang93.com/assets/";
    }
}
exports.MCIMProvider = MCIMProvider;
/** 自定义源：企业内网/私服镜像。 */
class CustomProvider {
    mavenUrl;
    resourcesUrl;
    manifestUrl;
    id = "custom";
    name = "自定义镜像";
    constructor(mavenUrl, resourcesUrl, manifestUrl) {
        this.mavenUrl = mavenUrl;
        this.resourcesUrl = resourcesUrl;
        this.manifestUrl = manifestUrl;
    }
    injectUrl(officialUrl) {
        // 仅对 minecraft.net 与 mojang 端点做前缀替换，其余原样
        if (/libraries\.minecraft\.net/i.test(officialUrl))
            return officialUrl.replace(/https?:\/\/libraries\.minecraft\.net\//i, ensureSlash(this.mavenUrl));
        if (/resources\.download\.minecraft\.net/i.test(officialUrl))
            return officialUrl.replace(/https?:\/\/resources\.download\.minecraft\.net\//i, ensureSlash(this.resourcesUrl));
        return null;
    }
    versionManifestUrl() {
        return (this.manifestUrl ??
            "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json");
    }
    mavenBase() {
        return ensureSlash(this.mavenUrl);
    }
    assetsBase() {
        return ensureSlash(this.resourcesUrl);
    }
}
exports.CustomProvider = CustomProvider;
function ensureSlash(s) {
    return s.endsWith("/") ? s : s + "/";
}
/**
 * 镜像管理器 + 智能路由（AutoDownloadProvider 语义）。
 * 一个资源 URL 会产出「候选下载地址」列表：先按当前镜像改写，再追加官方与备选镜像，
 * 下载引擎按顺序尝试，实现故障转移。
 */
class MirrorManager {
    preferred;
    providers;
    constructor(preferred = "auto", custom) {
        this.preferred = preferred;
        const bmcl = new BMCLAPIProvider();
        const mcim = new MCIMProvider();
        const official = new OfficialProvider();
        const mcbbs = new MCBBSProvider();
        this.providers = custom
            ? [
                new CustomProvider(custom.mavenUrl, custom.resourcesUrl, custom.manifestUrl),
                bmcl,
                mcim,
                mcbbs,
                official,
            ]
            : [bmcl, mcim, official, mcbbs];
    }
    /** 当前首选 provider（用于 versionManifest / 未改写的 URL）。 */
    primary() {
        if (this.preferred === "official")
            return new OfficialProvider();
        if (this.preferred === "mcbbs")
            return new MCBBSProvider();
        if (this.preferred === "mcim")
            return new MCIMProvider();
        if (this.preferred === "custom") {
            const c = this.providers.find((p) => p.id === "custom");
            if (c)
                return c;
        }
        // auto 或未匹配：BMCLAPI 优先（国内体验最好），失败由候选列表兜底
        return this.providers.find((p) => p.id === "bmclapi") ?? this.providers[0];
    }
    /**
     * 产出候选下载 URL 列表（去重，保持优先级）。
     * BMCLAPI 的库文件会同时给出 `/maven/` 与 `/libraries/` 两种路径（上游两种写法都支持，
     * 让聚合下载器测速/失败切换时自行择优）。
     */
    candidates(officialUrl) {
        const out = [];
        const push = (u) => {
            if (!u)
                return;
            for (const variant of bmclLibraryVariants(u)) {
                if (!out.includes(variant))
                    out.push(variant);
            }
        };
        // 1) 首选镜像改写
        push(this.primary().injectUrl(officialUrl));
        // 2) 其他镜像改写（含官方原 URL）
        for (const p of this.providers) {
            if (p === this.primary())
                continue;
            push(p.injectUrl(officialUrl));
        }
        // 3) 最后兜底：官方原 URL
        push(officialUrl);
        return out;
    }
    /** 只返回镜像改写结果（不含官方原 URL），供聚合下载器做多源择优。 */
    variants(officialUrl) {
        const out = [];
        for (const p of this.providers) {
            const u = p.injectUrl(officialUrl);
            if (!u)
                continue;
            for (const variant of bmclLibraryVariants(u)) {
                if (!out.includes(variant))
                    out.push(variant);
            }
        }
        return out;
    }
    /** 版本清单 URL 候选（主 + 备）。 */
    manifestCandidates() {
        const out = [];
        for (const p of [this.primary(), ...this.providers]) {
            const u = p.versionManifestUrl();
            if (!out.includes(u))
                out.push(u);
        }
        return out;
    }
    list() {
        return [...this.providers];
    }
}
exports.MirrorManager = MirrorManager;
/** 对 bmclapi 的 maven 路径补齐 `/libraries/` 变体。 */
function bmclLibraryVariants(u) {
    if (!u.includes("bmclapi2.bangbang93.com/maven/"))
        return [u];
    return [u, u.replace("/maven/", "/libraries/")];
}
//# sourceMappingURL=mirrors.js.map