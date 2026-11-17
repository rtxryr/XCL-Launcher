"use strict";
/**
 * Mojang 规则引擎。
 * version.json 里 libraries / arguments 都可能带 rules：
 *   [{ action: "allow"|"disallow", os?: { name, version, arch }, features?: {...} }]
 * 规则求值语义（与原版一致）：
 *   - 无 rules → 默认允许；
 *   - 有 rules → 初始「不允许」，逐条匹配，最后一条命中的 action 决定结果；
 *   - os.name 取 windows/osx/linux。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateRules = evaluateRules;
exports.buildContext = buildContext;
const util_1 = require("../core/util");
/** 判断单条 rule 是否匹配当前上下文。 */
function ruleMatches(rule, ctx) {
    // os 约束
    if (rule.os) {
        const want = rule.os.name;
        const current = ctx.os?.name ?? (0, util_1.mojangOs)();
        if (want && want !== current)
            return false;
        if (rule.os.arch && rule.os.arch !== (ctx.os?.arch ?? process.arch))
            return false;
        if (rule.os.version) {
            const v = ctx.os?.version ?? "";
            if (!safeRegexTest(rule.os.version, v))
                return false;
        }
    }
    // features 约束：要求的每个 feature 必须与上下文一致
    if (rule.features) {
        for (const [key, want] of Object.entries(rule.features)) {
            const have = ctx.features?.[key];
            if (Boolean(have) !== Boolean(want))
                return false;
        }
    }
    return true;
}
function safeRegexTest(pattern, value) {
    try {
        return new RegExp(pattern).test(value);
    }
    catch {
        return pattern === value;
    }
}
/**
 * 求值一组规则，返回是否允许。
 * @param rules 规则数组；为空/undefined → true
 */
function evaluateRules(rules, ctx = {}) {
    if (!rules || rules.length === 0)
        return true;
    const context = {
        os: { name: (0, util_1.mojangOs)(), arch: process.arch, ...(ctx.os ?? {}) },
        features: ctx.features ?? {},
    };
    let allowed = false;
    for (const rule of rules) {
        if (ruleMatches(rule, context)) {
            allowed = rule.action === "allow";
        }
    }
    return allowed;
}
/**
 * 构造一个带 os/feature 的默认上下文。
 * @param opts 是否为 demo 用户、是否有自定义分辨率等
 */
function buildContext(opts = {}) {
    return {
        os: { name: (0, util_1.mojangOs)(), arch: process.arch },
        features: {
            is_demo_user: opts.demo ?? false,
            has_custom_resolution: opts.customResolution ?? false,
        },
    };
}
//# sourceMappingURL=rules.js.map