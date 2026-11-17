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
import { Rule, RuleContext } from "./rules";
export interface VersionArtifact {
    path: string;
    sha1?: string;
    size?: number;
    url?: string;
}
export interface LibraryDownloads {
    artifact?: VersionArtifact;
    classifiers?: Record<string, VersionArtifact>;
}
export interface Library {
    name: string;
    downloads?: LibraryDownloads;
    /** natives: { windows: "natives-windows", osx: "natives-osx", linux: "natives-linux" } */
    natives?: Record<string, string>;
    rules?: Rule[];
    extract?: {
        exclude?: string[];
    };
    /** 手拼 URL 的 maven 坐标（当 downloads 缺失时） */
    url?: string;
}
export type ArgumentList = Array<string | {
    rules?: Rule[];
    value: string | string[];
}>;
export interface VersionDownloads {
    client?: VersionArtifact;
    server?: VersionArtifact;
}
export interface JavaVersion {
    component: string;
    majorVersion: number;
}
export interface VersionJson {
    id: string;
    type: string;
    mainClass: string;
    minecraftArguments?: string;
    arguments?: {
        jvm?: ArgumentList;
        game?: ArgumentList;
    };
    libraries: Library[];
    assetIndex: {
        id: string;
        sha1?: string;
        size?: number;
        totalSize?: number;
        url: string;
    };
    assets?: string;
    downloads?: VersionDownloads;
    javaVersion?: JavaVersion;
    complianceLevel?: number;
    inheritsFrom?: string;
    time?: string;
    releaseTime?: string;
}
/** 由 name（group:artifact:version[:classifier]）拼 maven 相对路径。 */
export declare function mavenPath(name: string): string;
/** 从 Library 解析出「应下载的普通库 artifact」（不含 natives）。 */
export declare function libraryArtifact(lib: Library): VersionArtifact | null;
/**
 * 解析出当前 OS 下应下载的 native 库 artifact（natives jar）。
 * natives 字典里 classifier 可能含 ${arch} 占位符。
 */
export declare function libraryNative(lib: Library, osName: string, arch?: string): VersionArtifact | null;
/** 展开 arguments 数组：过滤 rules 命中的项，把对象 value 展平为字符串列表。 */
export declare function expandArguments(list: ArgumentList | undefined, ctx: RuleContext): string[];
/**
 * 合并 inheritsFrom：把父版本与自身合并（自身优先）。
 * 加载器版本（Fabric/Forge 等）用 inheritsFrom 引用原版，合并后得到可启动的完整版本。
 */
export declare function mergeInherited(child: VersionJson, parent: VersionJson): VersionJson;
/** 校验 version.json 关键字段，缺失则抛错。 */
export declare function validateVersion(v: VersionJson): void;
//# sourceMappingURL=version.d.ts.map