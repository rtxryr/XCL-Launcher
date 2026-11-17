"use strict";
/**
 * 游戏安装编排：把「解析 → 下载 → 解压 natives → 下载资源」串成一条流水线。
 * 取长补短：并发下载 + 断点续传 + SHA1 校验 + 镜像故障转移。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameInstaller = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const aggregator_1 = require("./aggregator");
const conc_policy_1 = require("../net/conc-policy");
const util_1 = require("../core/util");
const natives_1 = require("../runtime/natives");
const resolve_1 = require("./resolve");
class GameInstaller {
    mirrors;
    gameDir;
    log;
    resolver;
    constructor(mirrors, gameDir, log) {
        this.mirrors = mirrors;
        this.gameDir = gameDir;
        this.log = log;
        this.resolver = new resolve_1.GameResolver(mirrors, gameDir);
    }
    /** 安装某个已解析版本的全部文件。 */
    async install(version, opts) {
        const summary = {
            client: false,
            libraries: 0,
            natives: 0,
            assets: 0,
            bytes: 0,
            failed: 0,
            reused: 0,
        };
        // 1) 客户端 + 库 + natives jar（走智能聚合：多源测速择优 + 分块并发）
        const libFiles = this.resolver.resolveLibraries(version);
        this.log.info(`下载 ${libFiles.length} 个库/客户端文件…`);
        const libRes = await (0, aggregator_1.aggregatedDownloadMany)(libFiles.map((f) => ({ urls: f.urls, dest: f.dest, sha1: f.sha1, label: f.label })), {
            concurrency: (0, conc_policy_1.resolveConcurrency)(opts.concurrency, { source: opts.source }),
            onProgress: (d, t) => {
                opts.events?.emit("progress", {
                    phase: "libraries",
                    current: d,
                    total: t,
                });
            },
        });
        summary.bytes += libRes.bytes;
        summary.reused += libRes.reused;
        summary.failed += libRes.failed.length;
        summary.libraries = libFiles.filter((f) => f.kind === "library").length;
        summary.natives = libFiles.filter((f) => f.kind === "native").length;
        summary.client = libFiles.some((f) => f.kind === "client");
        // 2) 解压 natives 到 nativesDir
        await (0, natives_1.resetNativesDir)(opts.nativesDir);
        const nativeJars = libFiles.filter((f) => f.kind === "native");
        for (const nj of nativeJars) {
            try {
                // 找到对应 library 的 extract.exclude
                const lib = version.libraries.find((l) => nj.label.startsWith(l.name));
                await (0, natives_1.extractNatives)(nj.dest, opts.nativesDir, {
                    exclude: lib?.extract?.exclude,
                });
            }
            catch (e) {
                this.log.warn(`解压 natives 失败: ${nj.label}`, e);
            }
        }
        // 3) 资源索引 + 资源对象
        if (!opts.skipAssets) {
            const idxFile = this.resolver.resolveAssetIndex(version);
            const idxRes = await (0, aggregator_1.aggregatedDownloadMany)([{ urls: idxFile.urls, dest: idxFile.dest, sha1: idxFile.sha1, label: idxFile.label }], { concurrency: 1 });
            summary.bytes += idxRes.bytes;
            summary.failed += idxRes.failed.length;
            if (idxRes.ok > 0) {
                const index = await (0, util_1.readJson)(idxFile.dest);
                const assetFiles = this.resolver.resolveAssets(index);
                this.log.info(`下载 ${assetFiles.length} 个资源对象…`);
                const aRes = await (0, aggregator_1.aggregatedDownloadMany)(assetFiles.map((f) => ({ urls: f.urls, dest: f.dest, sha1: f.sha1, label: f.label })), {
                    concurrency: (0, conc_policy_1.resolveConcurrency)(opts.concurrency, { source: opts.source }),
                    onProgress: (d, t) => opts.events?.emit("progress", { phase: "assets", current: d, total: t }),
                });
                summary.assets = assetFiles.length;
                summary.bytes += aRes.bytes;
                summary.reused += aRes.reused;
                summary.failed += aRes.failed.length;
            }
        }
        this.log.info(`安装完成: 库 ${summary.libraries} natives ${summary.natives} 资源 ${summary.assets} 失败 ${summary.failed}`);
        return summary;
    }
    /** 校验客户端 jar 是否就位。 */
    async isInstalled(versionId) {
        const jar = (0, path_1.join)(this.gameDir, "versions", versionId, `${versionId}.jar`);
        try {
            await fs_1.promises.access(jar);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.GameInstaller = GameInstaller;
//# sourceMappingURL=install.js.map