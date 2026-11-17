/**
 * Mojang 规则引擎。
 * version.json 里 libraries / arguments 都可能带 rules：
 *   [{ action: "allow"|"disallow", os?: { name, version, arch }, features?: {...} }]
 * 规则求值语义（与原版一致）：
 *   - 无 rules → 默认允许；
 *   - 有 rules → 初始「不允许」，逐条匹配，最后一条命中的 action 决定结果；
 *   - os.name 取 windows/osx/linux。
 */
export interface RuleOs {
    name?: string;
    version?: string;
    arch?: string;
}
export interface RuleFeatures {
    is_demo_user?: boolean;
    has_custom_resolution?: boolean;
    has_quick_plays_support?: boolean;
    is_quick_play_singleplayer?: boolean;
    is_quick_play_multiplayer?: boolean;
    is_quick_play_realms?: boolean;
}
export interface Rule {
    action: "allow" | "disallow";
    os?: RuleOs;
    features?: RuleFeatures;
}
export interface RuleContext {
    os?: RuleOs;
    features?: RuleFeatures;
}
/**
 * 求值一组规则，返回是否允许。
 * @param rules 规则数组；为空/undefined → true
 */
export declare function evaluateRules(rules: Rule[] | undefined, ctx?: RuleContext): boolean;
/**
 * 构造一个带 os/feature 的默认上下文。
 * @param opts 是否为 demo 用户、是否有自定义分辨率等
 */
export declare function buildContext(opts?: {
    demo?: boolean;
    customResolution?: boolean;
}): RuleContext;
//# sourceMappingURL=rules.d.ts.map