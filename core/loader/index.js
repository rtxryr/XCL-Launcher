"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.libraryArtifact = exports.LoaderInstaller = void 0;
const path_1 = require("path");
const errors_1 = require("../core/errors");
const http_1 = require("../net/http");
const downloader_1 = require("../net/downloader");
const version_1 = require("../meta/version");
Object.defineProperty(exports, "libraryArtifact", { enumerable: true, get: function () { return version_1.libraryArtifact; } });
const resolve_1 = require("../download/resolve");
const FABRIC_META = "https://meta.fabricmc.net/v2";
const QUILT_META = "https://meta.quiltmc.org/v3";
const FORGE_META = "https://files.minecraftforge.net/net/minecraftforge/forge";
const NEOFORGE_MAVEN = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
/** 取加载器的「profile/version json」（含 inheritsFrom）。 */
async function fetchLoaderVersionJson(loader, gameVersion, loaderVersion, mirrors) {
    switch (loader) {
        case "fabric": {
            const url = `${FABRIC_META}/versions/loader/${gameVersion}/${loaderVersion}/profile/json`;
            return (0, http_1.httpGetJson)(url);
        }
        case "quilt": {
            const url = `${QUILT_META}/versions/loader/${gameVersion}/${loaderVersion}/profile/json`;
            return (0, http_1.httpGetJson)(url);
        }
        case "forge": {
            // Forge 给的是一个 installer profile；这里直接取其 version json（patches）
            const url = `${FORGE_META}/${gameVersion}-${loaderVersion}/forge-${gameVersion}-${loaderVersion}-installer.jar`;
            throw new errors_1.FusionError("LOADER", `Forge 需运行官方 installer jar 换取 patch（建议在 GUI 流程处理）: ${url}`);
        }
        case "neoforge": {
            const url = `${NEOFORGE_MAVEN}/${loaderVersion}/neoforge-${loaderVersion}-universal.jar`;
            throw new errors_1.FusionError("LOADER", `NeoForge 需运行官方 installer 换取 patch（建议在 GUI 流程处理）: ${url}`);
        }
        default:
            throw new errors_1.FusionError("LOADER", `未知加载器: ${loader}`);
    }
}
class LoaderInstaller {
    mirrors;
    gameDir;
    log;
    versionsDir;
    librariesDir;
    constructor(mirrors, gameDir, log, versionsDir = (0, path_1.join)(gameDir, "versions"), librariesDir = (0, path_1.join)(gameDir, "libraries")) {
        this.mirrors = mirrors;
        this.gameDir = gameDir;
        this.log = log;
        this.versionsDir = versionsDir;
        this.librariesDir = librariesDir;
    }
    /**
     * 安装加载器到某个 base 版本之上，产出新的版本 id。
     * @param base 已解析的原版 version.json
     */
    async install(loader, base, loaderVersion) {
        let loaderJson;
        try {
            loaderJson = await fetchLoaderVersionJson(loader, base.id, loaderVersion, this.mirrors);
        }
        catch (e) {
            throw (0, errors_1.wrapError)("LOADER", `拉取 ${loader} 版本信息失败`, e, true);
        }
        // 强制继承 base
        loaderJson.inheritsFrom = base.id;
        const merged = (0, version_1.mergeInherited)(loaderJson, base);
        const versionId = loaderJson.id || `${base.id}-${loader}-${loaderVersion}`;
        merged.id = versionId;
        (0, version_1.validateVersion)(merged);
        // 保存版本 json
        const vdir = (0, path_1.join)(this.versionsDir, versionId);
        const jsonPath = (0, path_1.join)(vdir, `${versionId}.json`);
        const { ensureDirAsync, writeJson } = await Promise.resolve().then(() => __importStar(require("../core/util")));
        await ensureDirAsync(vdir);
        await writeJson(jsonPath, merged);
        // 客户端 jar 软链/引用 base（保留 base 的 client jar 即可，加载器不改 jar）
        this.log.info(`已保存加载器版本: ${versionId}`);
        // 下载增量库（加载器新引入的，可能 base 没有）
        const resolver = new resolve_1.GameResolver(this.mirrors, this.gameDir);
        const files = resolver.resolveLibraries(merged);
        // 只下还没在本地的
        const need = files.filter((f) => f.kind === "library" || f.kind === "native");
        const res = await (0, downloader_1.downloadMany)(need.map((f) => ({ urls: f.urls, dest: f.dest, sha1: f.sha1, label: f.label })), { });
        if (res.failed.length) {
            this.log.warn(`${loader} 有 ${res.failed.length} 个库下载失败`);
        }
        return { versionId, version: merged, downloaded: res.ok };
    }
    /** 查询某加载器在指定游戏版本下可用的 loader 版本列表。 */
    async listLoaderVersions(loader, gameVersion) {
        switch (loader) {
            case "fabric": {
                const list = await (0, http_1.httpGetJson)(`${FABRIC_META}/versions/loader/${gameVersion}`);
                return list.map((x) => x.version);
            }
            case "quilt": {
                const list = await (0, http_1.httpGetJson)(`${QUILT_META}/versions/loader/${gameVersion}`);
                return list.map((x) => x.version);
            }
            default:
                return [];
        }
    }
}
exports.LoaderInstaller = LoaderInstaller;
//# sourceMappingURL=index.js.map