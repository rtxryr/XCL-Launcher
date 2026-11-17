"use strict";
/**
 * 账号模型与存储。
 * 支持离线、Microsoft（正版）、Yggdrasil（第三方皮肤站，如 ely.by / littleskin.cn）三类。
 * 启动时只需 username / uuid / accessToken / userType 四要素。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountStore = void 0;
exports.toIdentity = toIdentity;
exports.offlineUuid = offlineUuid;
const crypto_1 = require("crypto");
const path_1 = require("path");
const util_1 = require("../core/util");
function toIdentity(acc) {
    return {
        username: acc.username,
        uuid: acc.uuid.replace(/-/g, ""),
        accessToken: acc.accessToken,
        userType: acc.userType,
    };
}
/** 由玩家名生成离线 UUID（Mojang 离线名 → UUID 的 md8 变体）。 */
function offlineUuid(username) {
    // 离线 UUID：md5("OfflinePlayer:"+name) 按 UUID v3 规则
    const md5 = (0, crypto_1.createHash)("md5").update(`OfflinePlayer:${username}`, "utf8").digest();
    md5[6] = (md5[6] & 0x0f) | 0x30; // version 3
    md5[8] = (md5[8] & 0x3f) | 0x80; // variant
    const hex = md5.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** 账号持久化管理。 */
class AccountStore {
    dataDir;
    log;
    accounts = [];
    path;
    constructor(dataDir, log) {
        this.dataDir = dataDir;
        this.log = log;
        this.path = (0, path_1.join)(dataDir, "accounts.json");
    }
    async load() {
        if ((0, util_1.pathExists)(this.path)) {
            try {
                this.accounts = await (0, util_1.readJson)(this.path);
            }
            catch (e) {
                this.log.warn("账号文件解析失败，忽略", e);
                this.accounts = [];
            }
        }
    }
    async save() {
        await (0, util_1.writeJson)(this.path, this.accounts);
    }
    list() {
        return [...this.accounts];
    }
    get(id) {
        return this.accounts.find((a) => a.id === id);
    }
    add(acc) {
        const full = { ...acc, id: acc.id ?? (0, crypto_1.randomUUID)() };
        // 同 uuid 覆盖
        const idx = this.accounts.findIndex((a) => a.uuid === full.uuid && a.type === full.type);
        if (idx >= 0)
            this.accounts[idx] = full;
        else
            this.accounts.push(full);
        return full;
    }
    remove(id) {
        const before = this.accounts.length;
        this.accounts = this.accounts.filter((a) => a.id !== id);
        return this.accounts.length < before;
    }
    update(id, patch) {
        const acc = this.get(id);
        if (!acc)
            return undefined;
        Object.assign(acc, patch);
        return acc;
    }
}
exports.AccountStore = AccountStore;
//# sourceMappingURL=account.js.map