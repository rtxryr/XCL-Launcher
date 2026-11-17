"use strict";
/**
 * 下载并发策略：把「并发数」从写死的常量改成按设备性能推导。
 *
 * 为什么要有这个模块：
 *  - 以前并发在 main.js 里被 Math.min(8, ...) 硬顶，UI 也只有 2/4/8 三档，
 *    高配机器（16 / 32 线程）明显吃不饱带宽；低配机器上固定 4 又偏重。
 *  - 现在统一走这里：机器越强并发越高，用户也能自己指定 1..N（N = CPU 逻辑线程数）。
 *
 * 两条必须保留的保护：
 *  1) BMCLAPI / MCIM 这类国内镜像对高并发会 429 限流（2026-11-06 实测：8 并发全部 302 正常跳转，
 *     16 并发 15/16 变 429，24 并发 24/24 全 429；更早一次实测 8 并发下 85 个库文件失败 64 个），
 *     所以「自动」模式在 BMCLAPI / auto 源上封顶 8；用户显式自定义的值不受此限制，
 *     由安装器的失败降速重试兜底。
 *  2) 文件级并发 × 单文件分块并发 = 总连接数，需要控制在合理范围（见 chunkConcurrencyFor），
 *     否则 32 文件并发 × 4 分块 = 128 条连接，路由器/镜像都扛不住。
 */
const os = require("os");

/** CPU 逻辑线程数；拿不到时按 4 处理。 */
function cpuThreads() {
    try {
        const n = os.cpus() ? os.cpus().length : 0;
        return n > 0 ? n : 4;
    }
    catch (e) {
        return 4;
    }
}

/** 物理内存（GB，保留 1 位小数）；拿不到时按 8 处理。 */
function memGB() {
    try {
        const bytes = os.totalmem();
        if (!bytes || bytes <= 0)
            return 8;
        return Math.round((bytes / 1073741824) * 10) / 10;
    }
    catch (e) {
        return 8;
    }
}

/** CPU 型号，仅用于设置页展示。 */
function cpuModel() {
    try {
        const list = os.cpus();
        return (list && list[0] && list[0].model) ? String(list[0].model).trim() : "";
    }
    catch (e) {
        return "";
    }
}

/** 自定义并发的上限：等于 CPU 逻辑线程数（至少 1）。 */
function maxConcurrency() {
    return Math.max(1, cpuThreads());
}

/**
 * 按设备性能推导默认并发。
 *  - 起步取半核数（下载是 IO 密集，留一半给游戏/系统）
 *  - 内存够（标称 16G 的机器实际可用约 15.8G，所以阈值取 15.5）且 >= 8 线程时
 *    提到 3/4 核数（高配机器才敢吃满）
 *  - 内存 < 8G 压到 6，避免小内存机器被写盘抖动拖死
 *  - 双核及以下直接按核数，不做放大
 * 结果再夹到 [1, 核数]。
 */
function autoConcurrency() {
    const n = cpuThreads();
    const mem = memGB();
    let c = Math.round(n * 0.5);
    if (mem >= 15.5 && n >= 8)
        c = Math.round(n * 0.75);
    c = Math.max(4, Math.min(c, 32));
    if (mem < 8)
        c = Math.min(c, 6);
    if (n <= 2)
        c = n;
    return Math.max(1, Math.min(c, n));
}

/**
 * 把外部传入的并发配置解析成最终整数。
 * @param {unknown} v 'auto' / 数字 / undefined / null / '' / NaN
 * @param {{ source?: string }} [opts] 下载源：'bmclapi' | 'mojang' | 'mirror'
 * @returns {number} >= 1 的整数
 */
function resolveConcurrency(v, opts) {
    const source = opts && opts.source ? String(opts.source) : "";
    const raw = (v === undefined || v === null) ? "" : String(v).trim();
    const isAuto = raw === "" || raw === "auto" || raw === "undefined";
    const num = isAuto ? NaN : parseInt(raw, 10);

    if (!Number.isFinite(num)) {
        let c = autoConcurrency();
        // 国内镜像限流保护：自动模式在 BMCLAPI（以及默认的 auto 源，它优先走 BMCLAPI）上封顶 8
        if (source === "bmclapi" || source === "auto" || source === "")
            c = Math.min(c, 8);
        return Math.max(1, Math.min(c, maxConcurrency()));
    }
    // 用户显式指定：只按核数上限夹，不做镜像压制
    return Math.max(1, Math.min(Math.round(num), maxConcurrency()));
}

/**
 * 单文件分块并发：让「文件并发 × 分块并发」的总连接数大致不超过 32。
 * conc 4→4、8→4、12→2、16→2、24→1、32→1
 */
function chunkConcurrencyFor(fileConc) {
    const c = Math.max(1, Math.round(Number(fileConc) || 1));
    return Math.max(1, Math.min(4, Math.floor(32 / c)));
}

/** 给界面用的设备画像。 */
function deviceProfile() {
    return {
        cpuThreads: cpuThreads(),
        cpuModel: cpuModel(),
        memGB: memGB(),
        autoConc: autoConcurrency(),
        maxConc: maxConcurrency(),
    };
}

module.exports = {
    cpuThreads,
    memGB,
    cpuModel,
    maxConcurrency,
    autoConcurrency,
    resolveConcurrency,
    chunkConcurrencyFor,
    deviceProfile,
};
