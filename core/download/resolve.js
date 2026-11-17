"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.mavenPath = exports.GameResolver = void 0;
const path_1 = require("path");
const version_1 = require("../meta/version");
Object.defineProperty(exports, "mavenPath", { enumerable: true, get: function () { return version_1.mavenPath; } });
const rules_1 = require("../meta/rules");
const util_1 = require("../core/util");
/** 当前架构对应的 natives name 后缀：x64 无后缀，32 位 x86，arm64。 */
function nativeArchSuffix() {
    if (process.arch === "arm64")
        return "arm64";
    if (process.arch === "ia32")
        return "x86";
    return "";
}
class GameResolver {
    mirrors;
    gameDir;
    constructor(mirrors, gameDir) {
        this.mirrors = mirrors;
        this.gameDir = gameDir;
    }
    candidatesFor(officialUrl) {
        return this.mirrors.candidates(officialUrl);
    }
    /** 解析客户端 jar + 全部库（含 native jar）。 */
    resolveLibraries(version, opts = {}) {
        const ctx = opts.ctx ?? (0, rules_1.buildContext)();
        const osName = (0, util_1.mojangOs)();
        const arch = process.arch === "x64" ? "64" : "32";
        const out = [];
        // 客户端 jar
        const clientUrl = version.downloads?.client?.url;
        if (clientUrl) {
            const dest = (0, path_1.join)(this.gameDir, "versions", version.id, `${version.id}.jar`);
            out.push({
                kind: "client",
                officialUrl: clientUrl,
                urls: this.candidatesFor(clientUrl),
                dest,
                sha1: version.downloads?.client?.sha1,
                size: version.downloads?.client?.size,
                label: `client ${version.id}.jar`,
            });
        }
        for (const lib of version.libraries) {
            // 库级 rules（如仅 Windows）
            if (!(0, rules_1.evaluateRules)(lib.rules, ctx))
                continue;
            // 1.19+：natives 的 windows / windows-x86 / windows-arm64 三个变体 rules 完全一样，
            // 只靠 name 后缀区分架构。若不过滤，32 位 dll 会覆盖 64 位，启动时报
            // "Failed to locate library: lwjgl.dll"（本质是位数不匹配）。
            const nativeName = /:natives-(?:windows|macos|linux)(?:-([a-z0-9]+))?$/i.exec(lib.name);
            if (nativeName) {
                const suffix = (nativeName[1] || "").toLowerCase();
                if (suffix !== nativeArchSuffix())
                    continue;
            }
            // 普通 artifact
            const art = (0, version_1.libraryArtifact)(lib);
            if (art) {
                // 1.19 起 Mojang 不再用 natives/classifiers 字段，而是把原生库作为普通 artifact，
                // 靠 name 里的 ":natives-windows / :natives-linux / :natives-macos" 区分（rules 已按 OS 过滤）。
                // 这类 jar 不能进 classpath，必须解压到 natives 目录，否则 LWJGL 找不到 .dll 直接崩。
                // HMCL（Library.natives 判定）与 PCL2 都按名字识别，这里保持一致。
                const isNative = /:natives-/i.test(lib.name);
                const official = art.url ?? `https://libraries.minecraft.net/${art.path}`;
                const dest = (0, path_1.join)(this.gameDir, "libraries", art.path);
                out.push({
                    kind: isNative ? "native" : "library",
                    officialUrl: official,
                    urls: this.candidatesFor(official),
                    dest,
                    sha1: art.sha1,
                    size: art.size,
                    label: isNative ? `${lib.name} [natives]` : lib.name,
                });
            }
            // native jar（当前 OS）
            const nat = (0, version_1.libraryNative)(lib, osName, arch);
            if (nat) {
                const official = nat.url ?? `https://libraries.minecraft.net/${nat.path}`;
                const dest = (0, path_1.join)(this.gameDir, "libraries", nat.path);
                out.push({
                    kind: "native",
                    officialUrl: official,
                    urls: this.candidatesFor(official),
                    dest,
                    sha1: nat.sha1,
                    size: nat.size,
                    label: `${lib.name} [natives]`,
                });
            }
        }
        return out;
    }
    /** 解析资源索引文件本身。 */
    resolveAssetIndex(version) {
        const ai = version.assetIndex;
        const dest = (0, path_1.join)(this.gameDir, "assets", "indexes", `${ai.id}.json`);
        return {
            kind: "assetIndex",
            officialUrl: ai.url,
            urls: this.candidatesFor(ai.url),
            dest,
            sha1: ai.sha1,
            size: ai.size,
            label: `asset-index ${ai.id}`,
        };
    }
    /** 由 asset index 内容解析全部资源对象。 */
    resolveAssets(index) {
        const out = [];
        for (const [name, obj] of Object.entries(index.objects ?? {})) {
            const hash = obj.hash;
            const aa = hash.slice(0, 2);
            const official = `https://resources.download.minecraft.net/${aa}/${hash}`;
            const dest = (0, path_1.join)(this.gameDir, "assets", "objects", aa, hash);
            out.push({
                kind: "asset",
                officialUrl: official,
                urls: this.candidatesFor(official),
                dest,
                sha1: hash,
                size: obj.size,
                label: name,
            });
        }
        return out;
    }
}
exports.GameResolver = GameResolver;
//# sourceMappingURL=resolve.js.map