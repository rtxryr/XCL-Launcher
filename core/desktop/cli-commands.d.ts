/**
 * 后端命令行：与前端内置终端共享同一套命令语义。
 *
 * 前端终端（渲染进程）把整行命令原样经 `cli:exec` 通道发到这里解析执行，
 * 后端只返回「可直接打印的行」（`CliLine[]`），不关心颜色/字体；
 * 由前端按 `level` 决定前景色。这样：
 *   - 命令语义只有一份（本文件），前端不做二次解析，避免行为漂移；
 *   - 交互式确认（如删除）由前端负责，后端只认 `--yes`；
 *   - `exec()` 永不抛异常，任何失败都转成 `err` 行，终端不会白屏。
 */
import type { FusionBackend } from "../backend";
import type { Logger } from "../core/logger";
/** 终端一行文本（level 决定前端着色）。 */
export interface CliLine {
    text: string;
    level: "info" | "warn" | "err" | "ok" | "cmd" | "dim";
}
/** 一行命令的解析结果。 */
export interface ParsedCommand {
    name: string;
    args: string[];
    flags: Record<string, string | boolean>;
}
/** 一次命令执行结果。 */
export interface CliResult {
    lines: CliLine[];
    /** 命令是否修改了服务端状态（前端可据此刷新列表） */
    mutated?: boolean;
}
export interface CliContext {
    backend: FusionBackend;
    log?: Logger;
}
/** 解析一行命令：支持 --key value / --flag / 引号包裹参数。空行返回 name:"" */
export declare function parseCommandLine(line_: string): ParsedCommand;
/** 把表格对齐成等宽文本（列宽按内容最大宽度，2 空格分隔），返回字符串数组 */
export declare function formatTable(rows: string[][], headers?: string[]): string[];
/** 按 id → 名称精确 → 名称前缀唯一 匹配服务器，返回 { hit } 或 { candidates } */
export declare function resolveServer<T extends {
    id: string;
    name: string;
}>(list: T[], token: string): {
    hit: T;
} | {
    candidates: T[];
} | null;
/** 相对时间：ms → "1m20s" / "2h3m" / "12s" */
export declare function humanDuration(ms: number): string;
export declare class CliCommands {
    private readonly backend;
    private readonly log;
    constructor(ctx: CliContext);
    /** 执行一行命令，永不抛异常，错误转成 err 行 */
    exec(commandLine: string): Promise<CliResult>;
    private help;
    private list;
    private status;
    private versions;
    private create;
    private start;
    private stop;
    private restart;
    private remove;
    private say;
    private consoleCommand;
    private entries;
    private statuses;
    private statusOf;
    private uptimeOf;
    private requireArg;
    /** id / 名称精确 / 名称前缀唯一 → 条目；否则抛错（由 exec 转成 err 行）。 */
    private requireServer;
    private strFlag;
    private intFlag;
    /** 校验并组装 ServerSpec。 */
    private buildSpec;
}
//# sourceMappingURL=cli-commands.d.ts.map