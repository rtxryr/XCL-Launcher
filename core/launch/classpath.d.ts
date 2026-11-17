/**
 * classpath 构造。
 * 规则：所有「普通库 artifact」（rules 通过）+ client.jar，client.jar 永远放最后。
 * natives jar 不进 classpath（只解压）。分隔符 Windows 用 ';'，其它 ':'。
 */
import { VersionJson } from "../meta/version";
import { RuleContext } from "../meta/rules";
export interface ClasspathOptions {
    /** 全局 libraries 目录 */
    librariesDir: string;
    /** client.jar 绝对路径 */
    clientJar: string;
    ctx: RuleContext;
    /** 额外追加的 jar（如加载器注入的） */
    extraJars?: string[];
}
export declare function buildClasspath(version: VersionJson, opts: ClasspathOptions): string;
/** 供占位符 ${classpath} / ${classpath_separator} 使用。 */
export declare function classpathSeparator(): string;
//# sourceMappingURL=classpath.d.ts.map