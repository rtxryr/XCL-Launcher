"use strict";
/**
 * 原生库（natives）解压。
 * natives jar 内含 .dll/.so/.dylib，需解压到 natives 目录，由 -Djava.library.path 指给 JVM。
 * 用 yauzl 流式读取（安全，避免整包解压的符号链接/内存炸弹风险），只落白名单后缀文件。
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
exports.extractNatives = extractNatives;
exports.resetNativesDir = resetNativesDir;
const fs_1 = require("fs");
const path_1 = require("path");
const yauzl = __importStar(require("yauzl"));
const errors_1 = require("../core/errors");
const util_1 = require("../core/util");
const NATIVE_EXT = /\.(dll|so|dylib|jnilib)$/i;
/**
 * 从 natives jar 解压原生库到 destDir。
 * 返回解压出的文件名列表。
 */
async function extractNatives(jarPath, destDir, opts = {}) {
    await (0, util_1.ensureDirAsync)(destDir);
    const includeExt = opts.includeExt ?? NATIVE_EXT;
    const exclude = opts.exclude ?? [];
    return new Promise((resolve, reject) => {
        yauzl.open(jarPath, { lazyEntries: true }, (err, zipfile) => {
            if (err || !zipfile)
                return reject((0, errors_1.wrapError)("NATIVES", `打开 natives jar 失败: ${(0, path_1.basename)(jarPath)}`, err));
            const written = [];
            zipfile.readEntry();
            zipfile.on("entry", (entry) => {
                const name = entry.fileName;
                // 目录项
                if (name.endsWith("/")) {
                    zipfile.readEntry();
                    return;
                }
                const base = (0, path_1.basename)(name);
                // 排除规则
                if (exclude.some((p) => name.includes(p) || base === p)) {
                    zipfile.readEntry();
                    return;
                }
                if (!includeExt.test(base)) {
                    zipfile.readEntry();
                    return;
                }
                zipfile.openReadStream(entry, (e2, rs) => {
                    if (e2 || !rs) {
                        zipfile.readEntry();
                        return;
                    }
                    const outPath = (0, path_1.join)(destDir, base); // 只用 basename，扁平化，防 zip slip
                    const ws = (0, fs_1.createWriteStream)(outPath);
                    rs.pipe(ws);
                    ws.on("close", () => {
                        written.push(base);
                        zipfile.readEntry();
                    });
                    ws.on("error", (e3) => {
                        reject((0, errors_1.wrapError)("NATIVES", `写原生库失败: ${base}`, e3));
                    });
                });
            });
            zipfile.on("end", () => resolve(written));
            zipfile.on("error", (e) => reject((0, errors_1.wrapError)("NATIVES", "读取 natives jar 出错", e)));
        });
    });
}
/** 清空并重建 natives 目录。 */
async function resetNativesDir(dir) {
    await fs_1.promises.rm(dir, { recursive: true, force: true });
    await (0, util_1.ensureDirAsync)(dir);
}
//# sourceMappingURL=natives.js.map