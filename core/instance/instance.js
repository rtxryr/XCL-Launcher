"use strict";
/**
 * 多实例管理。
 *
 * 隔离模型（借鉴 MultiMC/Prism）：
 *  - 全局 gameDir 共享 libraries / assets / versions（省磁盘、跨实例复用）；
 *  - 每个实例有独立的 .minecraft 目录（saves / mods / config / logs），
 *    作为启动时的 --gameDir，实现存档与 mod 隔离。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstanceManager = void 0;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const util_1 = require("../core/util");
const errors_1 = require("../core/errors");
class InstanceManager {
    instancesDir;
    log;
    constructor(instancesDir, log) {
        this.instancesDir = instancesDir;
        this.log = log;
        (0, util_1.ensureDir)(instancesDir);
    }
    dirOf(id) {
        return (0, path_1.join)(this.instancesDir, id);
    }
    /** 实例的游戏目录（--gameDir）。 */
    gameDirOf(id) {
        return (0, path_1.join)(this.dirOf(id), ".minecraft");
    }
    jsonPath(id) {
        return (0, path_1.join)(this.dirOf(id), "instance.json");
    }
    async list() {
        if (!(0, fs_1.existsSync)(this.instancesDir))
            return [];
        const entries = await fs_1.promises.readdir(this.instancesDir, { withFileTypes: true });
        const out = [];
        for (const e of entries) {
            if (!e.isDirectory())
                continue;
            const jp = this.jsonPath(e.name);
            if (!(0, util_1.pathExists)(jp))
                continue;
            try {
                out.push(await (0, util_1.readJson)(jp));
            }
            catch {
                /* 忽略损坏实例 */
            }
        }
        out.sort((a, b) => (b.lastPlayed ?? b.created) - (a.lastPlayed ?? a.created));
        return out;
    }
    async get(id) {
        const jp = this.jsonPath(id);
        if (!(0, util_1.pathExists)(jp))
            throw new errors_1.FusionError("INSTANCE", `实例不存在: ${id}`);
        return (0, util_1.readJson)(jp);
    }
    async create(props) {
        const id = (0, crypto_1.randomUUID)().slice(0, 8);
        const inst = {
            id,
            name: props.name,
            gameVersion: props.gameVersion,
            launchVersion: props.gameVersion,
            loader: props.loader ?? { type: "none" },
            settings: props.settings ?? {},
            created: Date.now(),
        };
        (0, util_1.ensureDir)(this.dirOf(id));
        (0, util_1.ensureDir)(this.gameDirOf(id));
        await (0, util_1.writeJson)(this.jsonPath(id), inst);
        this.log.info(`创建实例 ${props.name} (${id}) -> ${props.gameVersion}`);
        return inst;
    }
    async update(id, patch) {
        const inst = await this.get(id);
        Object.assign(inst, patch);
        await (0, util_1.writeJson)(this.jsonPath(id), inst);
        return inst;
    }
    async markPlayed(id) {
        await this.update(id, { lastPlayed: Date.now() });
    }
    async delete(id) {
        await fs_1.promises.rm(this.dirOf(id), { recursive: true, force: true });
        this.log.info(`删除实例 ${id}`);
    }
    /** 复制实例（含存档/mod）。 */
    async duplicate(id, newName) {
        const src = await this.get(id);
        const newId = (0, crypto_1.randomUUID)().slice(0, 8);
        await fs_1.promises.cp(this.dirOf(id), this.dirOf(newId), { recursive: true });
        const inst = {
            ...src,
            id: newId,
            name: newName,
            created: Date.now(),
            lastPlayed: undefined,
        };
        await (0, util_1.writeJson)(this.jsonPath(newId), inst);
        return inst;
    }
    /** 导出为目录（打包可交给分享）。返回实例根目录。 */
    async exportDir(id) {
        return this.dirOf(id);
    }
    /** 从一个目录导入实例。 */
    async importFrom(srcDir) {
        const jp = (0, path_1.join)(srcDir, "instance.json");
        if (!(0, util_1.pathExists)(jp))
            throw new errors_1.FusionError("INSTANCE", "导入目录缺少 instance.json");
        const inst = await (0, util_1.readJson)(jp);
        const newId = (0, crypto_1.randomUUID)().slice(0, 8);
        await fs_1.promises.cp(srcDir, this.dirOf(newId), { recursive: true });
        const imported = { ...inst, id: newId };
        await (0, util_1.writeJson)(this.jsonPath(newId), imported);
        return imported;
    }
}
exports.InstanceManager = InstanceManager;
//# sourceMappingURL=instance.js.map