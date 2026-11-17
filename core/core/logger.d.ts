/**
 * 分级结构化 Logger。
 * 支持 debug/info/warn/error，可注入 sink（默认打到 console）。
 * 输出带时间戳与模块标签，便于定位后端各模块问题。
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
export interface LogRecord {
    level: Exclude<LogLevel, "silent">;
    tag: string;
    time: Date;
    msg: string;
    data?: unknown;
}
export type LogSink = (rec: LogRecord) => void;
export declare class Logger {
    private level;
    private sink;
    private tag;
    constructor(level?: LogLevel, sink?: LogSink, tag?: string);
    /** 派生一个带子标签的 logger。 */
    child(tag: string): Logger;
    setLevel(level: LogLevel): void;
    private emit;
    debug(msg: string, data?: unknown): void;
    info(msg: string, data?: unknown): void;
    warn(msg: string, data?: unknown): void;
    error(msg: string, data?: unknown): void;
}
/** 全局默认 logger。 */
export declare const rootLogger: Logger;
//# sourceMappingURL=logger.d.ts.map