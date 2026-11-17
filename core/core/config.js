"use strict";
/**
 * 类型化配置管理。
 * 配置根目录默认 ~/.fusionmc（可覆盖），包含下载源偏好、Java 偏好、
 * 账号/实例/联机设置。读写落盘为 config.json。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const errors_1 = require("./errors");
const logger_1 = require("./logger");
const util_1 = require("./util");
const DEFAULT_RUNTIME = {
    autoDownloadJava: true,
    maxMemoryMB: 4096,
    downloadConcurrency: 16,
    mirror: "auto",
    logLevel: "info",
    multiplayerTransport: "lan",
};
class Config {
    data;
    logger;
    path;
    constructor(data, path, logger) {
        this.data = data;
        this.path = path;
        this.logger = logger;
    }
    static defaultRoot() {
        return (0, path_1.join)((0, os_1.homedir)(), ".fusionmc");
    }
    /** 加载配置；不存在则创建默认。 */
    static load(root, logger = logger_1.rootLogger) {
        const r = (0, util_1.abs)(root ?? Config.defaultRoot());
        (0, util_1.ensureDir)(r);
        const path = (0, path_1.join)(r, "config.json");
        let data;
        if ((0, util_1.pathExists)(path)) {
            try {
                data = mergeDefaults(JSON.parse((0, fs_1.readFileSync)(path, "utf-8")), r);
            }
            catch (e) {
                throw new errors_1.FusionError("CONFIG", `config 解析失败: ${path}`, { cause: e });
            }
        }
        else {
            data = mergeDefaults({}, r);
            // 首次落盘
            try {
                (0, fs_1.writeFileSync)(path, JSON.stringify(data, null, 2));
            }
            catch {
                /* 只读环境忽略 */
            }
        }
        const cfg = new Config(data, path, logger);
        logger.setLevel(data.runtime.logLevel);
        return cfg;
    }
    get value() {
        return this.data;
    }
    get gameDir() {
        return this.data.gameDir;
    }
    get instancesDir() {
        return this.data.instancesDir;
    }
    get runtime() {
        return this.data.runtime;
    }
    updateRuntime(patch) {
        this.data.runtime = { ...this.data.runtime, ...patch };
    }
    async save() {
        await (0, util_1.writeJson)(this.path, this.data);
    }
    /** 派生某个模块的子 logger。 */
    moduleLogger(tag) {
        return this.logger.child(tag);
    }
}
exports.Config = Config;
function mergeDefaults(raw, root) {
    return {
        root,
        gameDir: raw.gameDir ?? (0, path_1.join)(root, "game"),
        instancesDir: raw.instancesDir ?? (0, path_1.join)(root, "instances"),
        runtime: { ...DEFAULT_RUNTIME, ...(raw.runtime ?? {}) },
    };
}
//# sourceMappingURL=config.js.map