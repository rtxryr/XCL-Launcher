"use strict";
/**
 * 启动命令组装 + 游戏进程拉起与监控。
 *
 * 最终命令：java <jvmArgs...> <mainClass> <gameArgs...>
 * mainClass 允许被加载器替换（Forge/Fabric 接管入口）。
 * 进程 stdout/stderr 逐行透传到事件总线，退出码回传。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FusionError = exports.GameProcess = void 0;
exports.buildCommand = buildCommand;
exports.launchGame = launchGame;
const child_process_1 = require("child_process");
const errors_1 = require("../core/errors");
Object.defineProperty(exports, "FusionError", { enumerable: true, get: function () { return errors_1.FusionError; } });
const args_1 = require("./args");
/** 组装完整命令行（不执行）。 */
function buildCommand(opts) {
    const jvm = (0, args_1.buildJvmArgs)(opts.version, opts.identity, opts.paths, opts.settings, opts.ctx);
    const game = (0, args_1.buildGameArgs)(opts.version, opts.identity, opts.paths, opts.settings, opts.ctx);
    const mainClass = opts.mainClassOverride ?? opts.version.mainClass;
    return [opts.javaPath, ...jvm, mainClass, ...game];
}
class GameProcess {
    log;
    child = null;
    constructor(log) {
        this.log = log;
    }
    static create(log) {
        return new GameProcess(log);
    }
    /** 拉起游戏进程，返回可等待的句柄。 */
    run(command, opts = {}) {
        const [java, ...rest] = command;
        this.log.info(`启动: ${java} ${rest.slice(0, 8).join(" ")} …`);
        const child = (0, child_process_1.spawn)(java, rest, {
            cwd: opts.cwd,
            windowsHide: false,
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.child = child;
        const handleLine = (stream) => (chunk) => {
            const text = chunk.toString("utf-8");
            for (const line of text.split(/\r?\n/)) {
                if (line.trim()) {
                    opts.onOutput?.(stream, line);
                    opts.events?.emit("gameOutput", { stream, line });
                }
            }
        };
        child.stdout?.on("data", handleLine("stdout"));
        child.stderr?.on("data", handleLine("stderr"));
        const wait = () => new Promise((resolve) => {
            child.on("error", (e) => {
                this.log.error("进程启动失败", e);
                resolve({
                    pid: child.pid,
                    exitCode: -1,
                    signal: null,
                    command,
                });
            });
            child.on("close", (code, signal) => {
                opts.events?.emit("gameExit", { code, signal });
                resolve({ pid: child.pid, exitCode: code, signal, command });
            });
        });
        return {
            pid: child.pid,
            wait,
            // 暴露 child：启动器关窗口时若选择「游戏继续运行」，需要把 stdout/stderr
            // 的读端断开并 unref，否则 Electron 退出后管道无人读取，java 写满 64KB
            // 缓冲区就会阻塞在 write 上，游戏表现为卡死。
            child,
            detach: () => {
                try {
                    child.stdout?.destroy();
                } catch { /* 忽略 */ }
                try {
                    child.stderr?.destroy();
                } catch { /* 忽略 */ }
                try {
                    child.unref();
                } catch { /* 忽略 */ }
            },
            kill: (sig = "SIGTERM") => {
                if (this.child && !this.child.killed)
                    this.child.kill(sig);
            },
        };
    }
    get running() {
        return !!this.child && !this.child.killed && this.child.exitCode === null;
    }
}
exports.GameProcess = GameProcess;
/** 便捷：一次性组装命令并拉起。 */
function launchGame(opts) {
    const command = buildCommand(opts);
    const proc = GameProcess.create(opts.log);
    return proc.run(command, {
        cwd: opts.cwd ?? opts.paths.gameDir,
        events: opts.events,
        onOutput: opts.onOutput,
    });
}
//# sourceMappingURL=launcher.js.map