/**
 * 系统剩余资源评估：供前端定时探测 + 轻量模式 / 严重不足弹窗判定。
 *
 * `assessResources` 是纯函数，把「物理内存 + 提交（交换）内存」的一次采样判定为
 * ok / low / critical 三级；`probeSystemResource` 提供 Node 下的默认采样，
 * Electron 主进程可用 `DesktopBridge.setResourceProbe` 注入更精确的实现
 * （例如 `process.getSystemMemoryInfo`）。本模块无副作用、不发起网络请求、不监听端口。
 */
/** 一次系统资源采样（内存，单位字节）。 */
export interface SystemResourceSample {
    /** 总物理内存（字节） */
    total: number;
    /** 可用物理内存（字节） */
    free: number;
    /** 交换/提交上限（字节）；Node os 拿不到就 0 */
    swapTotal: number;
    /** 交换/提交剩余（字节） */
    swapFree: number;
}
/** 资源紧张程度。 */
export type ResourceLevel = "ok" | "low" | "critical";
/** 判定阈值。 */
export interface ResourceThresholds {
    /** 可用物理占比低于此 → low */
    lowFreeRatio: number;
    /** 可用物理占比低于此 → critical */
    criticalFreeRatio: number;
    /** 可用物理绝对量低于此 → critical */
    criticalFreeBytes: number;
    /** 提交占比高于此 → low（仅 swapTotal>0 时参与） */
    lowCommitRatio: number;
    /** 提交占比高于此 → critical */
    criticalCommitRatio: number;
}
/** 默认阈值。 */
export declare const DEFAULT_THRESHOLDS: ResourceThresholds;
/** 资源评估结果。 */
export interface ResourceAssessment {
    level: ResourceLevel;
    sample: SystemResourceSample;
    /** free/total，total 为 0 时返回 1 */
    freeRatio: number;
    /** (swapTotal-swapFree)/swapTotal 夹在 0~1；swapTotal 为 0 时 null */
    commitRatio: number | null;
    /** free/1024/1024，向下取整 */
    freeMB: number;
    thresholds: ResourceThresholds;
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
export declare function assessResources(sample: SystemResourceSample, thresholds?: ResourceThresholds): ResourceAssessment;
/**
 * 默认采样（Node 兼容）：使用 os.totalmem / os.freemem。
 * 交换/提交信息 Node 拿不到，故置 0（assessResources 会跳过提交判定）。
 */
export declare function probeSystemResource(): SystemResourceSample;
//# sourceMappingURL=resource-monitor.d.ts.map