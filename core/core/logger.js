"use strict";
/**
 * 分级结构化 Logger。
 * 支持 debug/info/warn/error，可注入 sink（默认打到 console）。
 * 输出带时间戳与模块标签，便于定位后端各模块问题。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rootLogger = exports.Logger = void 0;
const LEVEL_ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
function defaultSink(rec) {
    const line = `[${rec.time.toISOString()}] [${rec.level.toUpperCase()}] [${rec.tag}] ${rec.msg}`;
    const fn = rec.level === "error"
        ? console.error
        : rec.level === "warn"
            ? console.warn
            : console.log;
    if (rec.data !== undefined)
        fn(line, rec.data);
    else
        fn(line);
}
class Logger {
    level;
    sink;
    tag;
    constructor(level = "info", sink = defaultSink, tag = "fusionmc") {
        this.level = level;
        this.sink = sink;
        this.tag = tag;
    }
    /** 派生一个带子标签的 logger。 */
    child(tag) {
        return new Logger(this.level, this.sink, `${this.tag}:${tag}`);
    }
    setLevel(level) {
        this.level = level;
    }
    emit(level, msg, data) {
        if (this.level === "silent")
            return;
        if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level])
            return;
        this.sink({ level, tag: this.tag, time: new Date(), msg, data });
    }
    debug(msg, data) {
        this.emit("debug", msg, data);
    }
    info(msg, data) {
        this.emit("info", msg, data);
    }
    warn(msg, data) {
        this.emit("warn", msg, data);
    }
    error(msg, data) {
        this.emit("error", msg, data);
    }
}
exports.Logger = Logger;
/** 全局默认 logger。 */
exports.rootLogger = new Logger("info");
//# sourceMappingURL=logger.js.map