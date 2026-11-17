"use strict";
/**
 * classpath 构造。
 * 规则：所有「普通库 artifact」（rules 通过）+ client.jar，client.jar 永远放最后。
 * natives jar 不进 classpath（只解压）。分隔符 Windows 用 ';'，其它 ':'。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClasspath = buildClasspath;
exports.classpathSeparator = classpathSeparator;
const path_1 = require("path");
const util_1 = require("../core/util");
const version_1 = require("../meta/version");
const rules_1 = require("../meta/rules");
function buildClasspath(version, opts) {
    const jars = [];
    for (const lib of version.libraries) {
        if (!(0, rules_1.evaluateRules)(lib.rules, opts.ctx))
            continue;
        const art = (0, version_1.libraryArtifact)(lib);
        if (!art)
            continue;
        jars.push((0, path_1.join)(opts.librariesDir, art.path));
    }
    if (opts.extraJars)
        jars.push(...opts.extraJars);
    // client.jar 最后
    jars.push(opts.clientJar);
    // 去重
    const seen = new Set();
    const unique = jars.filter((j) => (seen.has(j) ? false : (seen.add(j), true)));
    return unique.join((0, util_1.classpathSep)());
}
/** 供占位符 ${classpath} / ${classpath_separator} 使用。 */
function classpathSeparator() {
    return (0, util_1.classpathSep)();
}
//# sourceMappingURL=classpath.js.map