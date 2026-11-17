/**
 * JVM / 游戏参数构造（含占位符替换、rules 求值、平台差异）。
 *
 * version.json 的 arguments.jvm / arguments.game 是数组，元素可为字符串或
 * { rules, value } 对象；老版本用 minecraftArguments 单串。
 * 占位符如 ${auth_player_name}、${classpath} 由上下文替换。
 * 加载器接管靠 mainClass 替换（在 command 层处理）。
 */
import { VersionJson } from "../meta/version";
import { RuleContext } from "../meta/rules";
import { LaunchIdentity } from "../auth/account";
export interface LaunchPaths {
    nativesDir: string;
    librariesDir: string;
    assetsDir: string;
    gameDir: string;
    classpath: string;
    classpathSeparator: string;
}
export interface LaunchSettings {
    maxMemoryMB?: number;
    initialMemoryMB?: number;
    extraJvmArgs?: string[];
    extraGameArgs?: string[];
    launcherName?: string;
    launcherVersion?: string;
    clientId?: string;
    xuid?: string;
    width?: number;
    height?: number;
    fullscreen?: boolean;
    demo?: boolean;
}
export interface BuiltArgs {
    jvm: string[];
    game: string[];
}
export declare function buildPlaceholders(identity: LaunchIdentity, paths: LaunchPaths, version: VersionJson, settings: LaunchSettings): Record<string, string>;
/**
 * 构造 JVM 参数。
 * 顺序：version.arguments.jvm（rules 展开 + 占位符）→ 内存/平台补强 → 用户额外参数。
 */
export declare function buildJvmArgs(version: VersionJson, identity: LaunchIdentity, paths: LaunchPaths, settings: LaunchSettings, ctx: RuleContext): string[];
/**
 * 构造游戏参数。
 * 优先 arguments.game（rules 展开），否则拆 minecraftArguments。
 */
export declare function buildGameArgs(version: VersionJson, identity: LaunchIdentity, paths: LaunchPaths, settings: LaunchSettings, ctx: RuleContext): string[];
//# sourceMappingURL=args.d.ts.map