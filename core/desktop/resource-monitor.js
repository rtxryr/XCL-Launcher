"use strict";
/**
 * 系统剩余资源评估：供前端定时探测 + 轻量模式 / 严重不足弹窗判定。
 *
 * `assessResources` 是纯函数，把「物理内存 + 提交（交换）内存」的一次采样判定为
 * ok / low / critical 三级；`probeSystemResource` 提供 Node 下的默认采样，
 * Electron 主进程可用 `DesktopBridge.setResourceProbe` 注入更精确的实现
 * （例如 `process.getSystemMemoryInfo`）。本模块无副作用、不发起网络请求、不监听端口。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_THRESHOLDS = void 0;
exports.assessResources = assessResources;
exports.probeSystemResource = probeSystemResource;
const os_1 = require("os");
/** 默认阈值。 */
exports.DEFAULT_THRESHOLDS = {
    lowFreeRatio: 0.15,
    criticalFreeRatio: 0.07,
    criticalFreeBytes: 700 * 1024 * 1024, // 700MB
    lowCommitRatio: 0.85,
    criticalCommitRatio: 0.94,
};
/** 把数值夹在 [min, max] 区间。 */
function clamp(value, min, max) {
    if (value < min)
        return min;
    if (value > max)
        return max;
    return value;
}
/**
 * 判定一次采样：先 critical 后 low，否则 ok。
 *
 * - freeRatio：total>0 时为 free/total（夹在 0~1），total<=0 时返回 1（视为未知，不告警）；
 * - commitRatio：swapTotal>0 时为 (swapTotal-swapFree)/swapTotal（夹在 0~1），否则 null；
 * - 负数 free 一律按 0 处理（freeRatio 下限 0、freeMB 为 0）；
 * - 绝对可用量判定（criticalFreeBytes）仅在物理内存已知（total>0）时生效，
 *   避免 total=0 的未知采样被误判为「严重不足」。
 */
function assessResources(sample, thresholds = exports.DEFAULT_THRESHOLDS) {
    // 负数 free 按 0 处理
    const free = Math.max(0, sample.free);
    const freeRatio = sample.total > 0 ? clamp(free / sample.total, 0, 1) : 1;
    const commitRatio = sample.swapTotal > 0
        ? clamp((sample.swapTotal - sample.swapFree) / sample.swapTotal, 0, 1)
        : null;
    const freeMB = Math.floor(free / (1024 * 1024));
    const criticalByRatio = freeRatio < thresholds.criticalFreeRatio;
    const criticalByBytes = sample.total > 0 && free < thresholds.criticalFreeBytes;
    const criticalByCommit = commitRatio !== null && commitRatio > thresholds.criticalCommitRatio;
    let level = "ok";
    if (criticalByRatio || criticalByBytes || criticalByCommit) {
        level = "critical";
    }
    else if (freeRatio < thresholds.lowFreeRatio ||
        (commitRatio !== null && commitRatio > thresholds.lowCommitRatio)) {
        level = "low";
    }
    return { level, sample, freeRatio, commitRatio, freeMB, thresholds };
}
/**
 * 默认采样（Node 兼容）：使用 os.totalmem / os.freemem。
 * 交换/提交信息 Node 拿不到，故置 0（assessResources 会跳过提交判定）。
 */
function probeSystemResource() {
    return { total: (0, os_1.totalmem)(), free: (0, os_1.freemem)(), swapTotal: 0, swapFree: 0 };
}
//# sourceMappingURL=resource-monitor.js.map