"use strict";
/**
 * version.json 数据模型。
 *
 * Mojang/加载器的 version.json 描述了一个版本的「安装 + 启动」全部信息：
 *  - mainClass：启动入口（加载器会替换它）
 *  - arguments：jvm / game 参数数组（含 rules 条目），1.12.2+ 用；
 *    老版本用 minecraftArguments 单字符串。
 *  - libraries：依赖库，含普通 artifact 与 natives（原生库分类器）
 *  - downloads.client / assetIndex：客户端 jar 与资源索引
 *  - javaVersion：所需 JRE
 *  - inheritsFrom：模组加载器版本「继承」原版，合并后生效
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mavenPath = mavenPath;
exports.libraryArtifact = libraryArtifact;
exports.libraryNative = libraryNative;
exports.expandArguments = expandArguments;
exports.mergeInherited = mergeInherited;
exports.validateVersion = validateVersion;
const rules_1 = require("./rules");
/** 由 name（group:artifact:version[:classifier]）拼 maven 相对路径。 */
function mavenPath(name) {
    const parts = name.split(":");
    const [group, artifact, version, classifier] = parts;
    const groupPath = group.replace(/\./g, "/");
    const file = classifier
        ? `${artifact}-${version}-${classifier}.jar`
        : `${artifact}-${version}.jar`;
    return `${groupPath}/${artifact}/${version}/${file}`;
}
/** 从 Library 解析出「应下载的普通库 artifact」（不含 natives）。 */
function libraryArtifact(lib) {
    if (lib.downloads?.artifact)
        return lib.downloads.artifact;
    // 退化：手拼 maven 路径，URL 由镜像 maven base 提供
    const path = mavenPath(lib.name);
    return { path, url: lib.url ? `${lib.url}${path}` : undefined };
}
/**
 * 解析出当前 OS 下应下载的 native 库 artifact（natives jar）。
 * natives 字典里 classifier 可能含 ${arch} 占位符。
 */
function libraryNative(lib, osName, arch = "64") {
    if (!lib.natives)
        return null;
    const classifierTemplate = lib.natives[osName];
    if (!classifierTemplate)
        return null;
    const classifier = classifierTemplate.replace("${arch}", arch);
    const byClassifier = lib.downloads?.classifiers?.[classifier];
    if (byClassifier)
        return byClassifier;
    // 退化：手拼
    const path = mavenPath(`${lib.name}:${classifier}`);
    return { path, url: lib.url ? `${lib.url}${path}` : undefined };
}
/** 展开 arguments 数组：过滤 rules 命中的项，把对象 value 展平为字符串列表。 */
function expandArguments(list, ctx) {
    if (!list)
        return [];
    const out = [];
    for (const item of list) {
        if (typeof item === "string") {
            out.push(item);
            continue;
        }
        if (!(0, rules_1.evaluateRules)(item.rules, ctx))
            continue;
        const v = Array.isArray(item.value) ? item.value : [item.value];
        out.push(...v);
    }
    return out;
}
/**
 * 合并 inheritsFrom：把父版本与自身合并（自身优先）。
 * 加载器版本（Fabric/Forge 等）用 inheritsFrom 引用原版，合并后得到可启动的完整版本。
 */
function mergeInherited(child, parent) {
    return {
        ...parent,
        ...child,
        id: child.id,
        mainClass: child.mainClass || parent.mainClass,
        inheritsFrom: undefined,
        libraries: [...(child.libraries ?? []), ...(parent.libraries ?? [])],
        arguments: {
            jvm: [...(child.arguments?.jvm ?? []), ...(parent.arguments?.jvm ?? [])],
            game: [...(child.arguments?.game ?? []), ...(parent.arguments?.game ?? [])],
        },
        // 老版本：取 child 的，否则 parent 的
        minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
        assetIndex: child.assetIndex ?? parent.assetIndex,
        downloads: { ...(parent.downloads ?? {}), ...(child.downloads ?? {}) },
        javaVersion: child.javaVersion ?? parent.javaVersion,
    };
}
/** 校验 version.json 关键字段，缺失则抛错。 */
function validateVersion(v) {
    if (!v.id)
        throw new Error("version.json 缺少 id");
    if (!v.mainClass && !v.inheritsFrom)
        throw new Error(`version ${v.id} 缺少 mainClass`);
    if (!v.libraries)
        v.libraries = [];
    if (!v.arguments)
        v.arguments = {};
}
//# sourceMappingURL=version.js.map