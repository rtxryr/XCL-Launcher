"use strict";
/**
 * 版本清单（version_manifest_v2）与版本 json 解析。
 * 负责：列版本、按 id 找到 version.json、下载解析、处理 inheritsFrom 合并。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManifestService = void 0;
const errors_1 = require("../core/errors");
const http_1 = require("../net/http");
const version_1 = require("./version");
class ManifestService {
    mirrors;
    log;
    constructor(mirrors, log) {
        this.mirrors = mirrors;
        this.log = log;
    }
    /** 拉取版本清单（多源故障转移）。 */
    async fetchManifest() {
        const candidates = this.mirrors.manifestCandidates();
        let lastErr;
        for (const url of candidates) {
            try {
                const m = await (0, http_1.httpGetJson)(url, { timeoutMs: 25_000 });
                if (m?.versions) {
                    this.log.debug(`版本清单来源: ${url} (${m.versions.length} 版本)`);
                    return m;
                }
            }
            catch (e) {
                lastErr = e;
                this.log.debug(`版本清单失败: ${url}`);
            }
        }
        throw (0, errors_1.wrapError)("MANIFEST", "拉取版本清单失败（所有源）", lastErr, true);
    }
    /** 按 id 查清单条目。 */
    async findVersion(id) {
        const m = await this.fetchManifest();
        const v = m.versions.find((x) => x.id === id);
        if (!v)
            throw new errors_1.FusionError("VERSION", `清单中无版本: ${id}`);
        return v;
    }
    /** 列出版本 id（可按类型过滤）。 */
    async listVersions(type) {
        const m = await this.fetchManifest();
        return type ? m.versions.filter((v) => v.type === type) : m.versions;
    }
    /**
     * 下载并解析 version.json，处理 inheritsFrom 合并。
     * 返回完整（已合并）的 VersionJson。
     */
    async loadVersionJson(url) {
        const raw = await (0, http_1.httpGetJson)(url, { timeoutMs: 25_000 });
        (0, version_1.validateVersion)(raw);
        if (raw.inheritsFrom) {
            // 递归加载父版本
            const parentEntry = await this.findVersion(raw.inheritsFrom).catch(() => {
                // 父版本可能不在清单（如加载器自定义），尝试把 id 当 URL 末段拼
                throw new errors_1.FusionError("VERSION", `找不到父版本: ${raw.inheritsFrom}`);
            });
            const parent = await this.loadVersionJson(parentEntry.url);
            const merged = (0, version_1.mergeInherited)(raw, parent);
            (0, version_1.validateVersion)(merged);
            return merged;
        }
        return raw;
    }
    /** 通过版本 id 加载完整 version.json。 */
    async loadVersionById(id) {
        const entry = await this.findVersion(id);
        return this.loadVersionJson(entry.url);
    }
}
exports.ManifestService = ManifestService;
//# sourceMappingURL=manifest.js.map