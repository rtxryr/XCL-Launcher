"use strict";
/**
 * JVM / 游戏参数构造（含占位符替换、rules 求值、平台差异）。
 *
 * version.json 的 arguments.jvm / arguments.game 是数组，元素可为字符串或
 * { rules, value } 对象；老版本用 minecraftArguments 单串。
 * 占位符如 ${auth_player_name}、${classpath} 由上下文替换。
 * 加载器接管靠 mainClass 替换（在 command 层处理）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlaceholders = buildPlaceholders;
exports.buildJvmArgs = buildJvmArgs;
exports.buildGameArgs = buildGameArgs;
const util_1 = require("../core/util");
const version_1 = require("../meta/version");
function buildPlaceholders(identity, paths, version, settings) {
    return {
        "${natives_directory}": paths.nativesDir,
        "${launcher_name}": settings.launcherName ?? "X Craft Launcher",
        "${launcher_version}": settings.launcherVersion ?? "0.1.0",
        "${classpath}": paths.classpath,
        "${classpath_separator}": paths.classpathSeparator,
        "${library_directory}": paths.librariesDir,
        "${auth_player_name}": identity.username,
        "${auth_uuid}": identity.uuid,
        "${auth_access_token}": identity.accessToken,
        "${auth_session}": identity.accessToken,
        "${user_type}": identity.userType,
        "${version_type}": version.type ?? "release",
        "${version_name}": version.id,
        "${game_directory}": paths.gameDir,
        "${assets_root}": paths.assetsDir,
        "${assets_index_name}": version.assetIndex?.id ?? version.assets ?? "legacy",
        "${game_assets}": `${paths.assetsDir}/virtual/legacy`,
        "${user_properties}": "{}",
        "${clientid}": settings.clientId ?? "",
        "${auth_xuid}": settings.xuid ?? "",
        "${resolution_width}": String(settings.width ?? 854),
        "${resolution_height}": String(settings.height ?? 480),
    };
}
function substitute(arg, vars) {
    return arg.replace(/\$\{[^}]+\}/g, (m) => vars[m] ?? m);
}
function substituteList(list, vars) {
    return list.map((s) => substitute(s, vars));
}
/**
 * 构造 JVM 参数。
 * 顺序：version.arguments.jvm（rules 展开 + 占位符）→ 内存/平台补强 → 用户额外参数。
 */
function buildJvmArgs(version, identity, paths, settings, ctx) {
    const vars = buildPlaceholders(identity, paths, version, settings);
    const out = [];
    // 版本自带 jvm 参数（含 -Djava.library.path、-cp 等）
    const rawJvm = (0, version_1.expandArguments)(version.arguments?.jvm, ctx);
    out.push(...substituteList(rawJvm, vars));
    // 老版本无 arguments.jvm：补 -Djava.library.path 与 -cp
    if (!version.arguments?.jvm) {
        out.push(`-Djava.library.path=${paths.nativesDir}`);
        out.push(`-cp`, paths.classpath);
    }
    // 内存
    const maxMem = settings.maxMemoryMB ?? 4096;
    const initMem = settings.initialMemoryMB ?? Math.floor(maxMem / 4);
    // 避免与版本参数重复设置 -Xmx
    if (!out.some((a) => a.startsWith("-Xmx")))
        out.push(`-Xmx${maxMem}M`);
    if (!out.some((a) => a.startsWith("-Xms")))
        out.push(`-Xms${initMem}M`);
    // 启动器品牌（崩溃报告/遥测用）
    if (!out.some((a) => a.startsWith("-Dminecraft.launcher.brand"))) {
        out.push(`-Dminecraft.launcher.brand=${settings.launcherName ?? "X Craft Launcher"}`);
        out.push(`-Dminecraft.launcher.version=${settings.launcherVersion ?? "0.1.0"}`);
    }
    // macOS：必须在主线程起 JVM
    if ((0, util_1.mojangOs)() === "osx" && !out.includes("-XstartOnFirstThread")) {
        out.push("-XstartOnFirstThread");
    }
    // 用户额外 jvm 参数
    if (settings.extraJvmArgs?.length)
        out.push(...settings.extraJvmArgs);
    return out;
}
/**
 * 构造游戏参数。
 * 优先 arguments.game（rules 展开），否则拆 minecraftArguments。
 */
function buildGameArgs(version, identity, paths, settings, ctx) {
    const vars = buildPlaceholders(identity, paths, version, settings);
    let out;
    if (version.arguments?.game) {
        out = (0, version_1.expandArguments)(version.arguments.game, ctx);
        out = substituteList(out, vars);
    }
    else if (version.minecraftArguments) {
        out = substituteList(version.minecraftArguments.split(/\s+/).filter(Boolean), vars);
    }
    else {
        out = [];
    }
    // 分辨率（若未通过参数给出）
    if (settings.width && !out.includes("--width")) {
        out.push("--width", String(settings.width), "--height", String(settings.height ?? 480));
    }
    if (settings.fullscreen && !out.includes("--fullscreen"))
        out.push("--fullscreen");
    if (settings.demo && !out.includes("--demo"))
        out.push("--demo");
    if (settings.extraGameArgs?.length)
        out.push(...settings.extraGameArgs);
    return out;
}
//# sourceMappingURL=args.js.map