/**
 * 启动命令组装 + 游戏进程拉起与监控。
 *
 * 最终命令：java <jvmArgs...> <mainClass> <gameArgs...>
 * mainClass 允许被加载器替换（Forge/Fabric 接管入口）。
 * 进程 stdout/stderr 逐行透传到事件总线，退出码回传。
 */
import { EventBus, BackendEvents } from "../core/events";
import { Logger } from "../core/logger";
import { FusionError } from "../core/errors";
import { LaunchPaths, LaunchSettings } from "./args";
import { LaunchIdentity } from "../auth/account";
import { VersionJson } from "../meta/version";
import { RuleContext } from "../meta/rules";
export interface LaunchCommandOptions {
    javaPath: string;
    version: VersionJson;
    identity: LaunchIdentity;
    paths: LaunchPaths;
    settings: LaunchSettings;
    ctx: RuleContext;
    /** 覆盖 mainClass（加载器接管） */
    mainClassOverride?: string;
    /** 工作目录 */
    cwd?: string;
}
/** 组装完整命令行（不执行）。 */
export declare function buildCommand(opts: LaunchCommandOptions): string[];
export interface LaunchResult {
    pid: number | undefined;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    command: string[];
}
export declare class GameProcess {
    private log;
    private child;
    private constructor();
    static create(log: Logger): GameProcess;
    /** 拉起游戏进程，返回可等待的句柄。 */
    run(command: string[], opts?: {
        cwd?: string;
        events?: EventBus<BackendEvents>;
        onOutput?: (stream: "stdout" | "stderr", line: string) => void;
    }): {
        pid: number | undefined;
        wait: () => Promise<LaunchResult>;
        kill: (signal?: NodeJS.Signals) => void;
    };
    get running(): boolean;
}
/** 便捷：一次性组装命令并拉起。 */
export declare function launchGame(opts: LaunchCommandOptions & {
    events?: EventBus<BackendEvents>;
    log: Logger;
    onOutput?: (stream: "stdout" | "stderr", line: string) => void;
}): ReturnType<GameProcess["run"]>;
export { FusionError };
//# sourceMappingURL=launcher.d.ts.map