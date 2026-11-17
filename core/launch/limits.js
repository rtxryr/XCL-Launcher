"use strict";
/**
 * 自适应运行限制（1.0.10）。
 *
 * 职责边界（刻意划清，避免和 core/system/perf.js 打架）：
 *   - 本文件只做「把一份限制描述翻译成 JVM 参数 + Windows 进程附着动作」。
 *     不探测硬件、不读历史统计、不决定「该给多少」—— 那是 perf.js 的事。
 *   - 纯函数部分（normalizeLimits / buildJvmArgsFromLimits / describe）不碰 IO，可直接单测。
 *   - 附着部分（applyProcessTuning）只改进程属性，任何失败都「返回结果、不抛异常」：
 *     限制没设上，最坏情况是游戏跑得慢一点；抛出来则会让整个启动流程中断，代价大得多。
 */
const { execFile } = require("child_process");

// 内存边界：512MB 是「带得动原版」的下限，32768MB 是 32 位掩码/JVM 实践里的常见上限。
// 256 对齐：-Xmx1500M 与 -Xmx1536M 的实际驻留几乎一样，但会让同一档硬件算出不同参数，
// 历史数据就没法横向比较了，所以统一吸到 256 的整数倍。
const MEM_MIN = 512;
const MEM_MAX = 32768;
const MEM_ALIGN = 256;

// JVM 参数条数上限：防御性设计。参数列表过长（以及明显拼错的垃圾串）对启动毫无帮助。
const ARGS_MAX = 20;
const ARG_MAX_LEN = 512;

// 内部优先级名 → PowerShell PriorityClass 合法值（大小写敏感，且只认这四个：
// Normal / BelowNormal / AboveNormal / High；'Below'、'Idle' 这类写法会直接报错）
const PRIORITY_MAP = { normal: "Normal", below: "BelowNormal", above: "AboveNormal" };
const PRIORITY_TEXT = { normal: "普通", below: "低于普通", above: "高于普通" };

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/**
 * 内存：512..32768，且 256 对齐。
 * 返回 null 表示「调用方没指定」—— 刻意不用 2048 兜底：
 * main.js 的 maxMemoryMB 有一条更完整的回退链（limits → payload → config → 2048），
 * 这里若擅自填 2048，就会把 payload/config 里的用户设置吞掉。
 */
function normalizeMemoryMB(v) {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  const clamped = Math.min(MEM_MAX, Math.max(MEM_MIN, Math.round(n)));
  const aligned = Math.round(clamped / MEM_ALIGN) * MEM_ALIGN;
  return Math.min(MEM_MAX, Math.max(MEM_MIN, aligned));
}

/** 优先级：只允许 normal / below / above，其余一律回落 normal（不改动系统默认值）。 */
function normalizePriority(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "below" || s === "belownormal" || s === "below_normal") return "below";
  if (s === "above" || s === "abovenormal" || s === "above_normal") return "above";
  return "normal";
}

/**
 * 亲和性掩码：只认十进制正整数串（PowerShell 的 ProcessorAffinity 就吃十进制）。
 * '0x3'、'3,4'、'3 4'、'abc' 全部丢弃成 null —— 宁可「不绑核心」，
 * 也不要把一个解析一半的掩码交给系统，那会把进程绑到不存在的核心上。
 */
function normalizeAffinity(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  // 保留字符串而非 Number：128 核机器的掩码会超过 2^53，字符串能原样传给 PowerShell
  if (s.length > 20) return null;
  const trimmed = s.replace(/^0+(?=\d)/, "");
  if (trimmed === "0") return null;
  return trimmed;
}

/**
 * 附加 JVM 参数：过滤 + 去重 + 限条数。
 * 虽然 spawn/execFile 用数组传参本身没有 shell 解析，但历史上确实出现过「前端拼字符串」，
 * 所以这里仍按最严格的口径挡掉空白与 shell 元字符 —— 参数里本来也不该出现它们。
 */
exports.buildJvmArgsFromLimits = function (limits) {
  const src = limits && typeof limits === "object" ? limits : {};
  const raw = Array.isArray(src.jvmArgs) ? src.jvmArgs : [];
  const out = [];
  for (const item of raw) {
    if (out.length >= ARGS_MAX) break;
    if (typeof item !== "string") continue;
    const a = item.trim();
    if (!a) continue;
    if (a.charAt(0) !== "-") continue; // 只收 JVM 开关，裸值一定是前端拼错了
    if (a.length > ARG_MAX_LEN) continue;
    // 空白 / 引号 / 反引号 / 分号 / 管道 / 与或重定向 / 变量符 / 控制字符
    if (/[\s"'`;|&<>$]/.test(a)) continue;
    if (/[\u0000-\u001f\u007f]/.test(a)) continue;
    // 堆大小统一由 args.js 按 memoryMB 生成；这里再放一条 -Xmx 会让两处设置打架，
    // 而且 args.js 见到已有 -Xmx 就不再补自己的，等于用户/自动值被悄悄覆盖。
    if (/^-Xm[sx]/.test(a)) continue;
    if (out.indexOf(a) !== -1) continue;
    out.push(a);
  }
  return out;
};

/** 归一化整份限制描述（UI payload / perf.resolveLimits 的输出都可直接喂进来）。 */
exports.normalizeLimits = function (raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    memoryMB: normalizeMemoryMB(src.memoryMB),
    priority: normalizePriority(src.priority),
    affinityMask: normalizeAffinity(src.affinityMask),
    jvmArgs: exports.buildJvmArgsFromLimits(src),
  };
};

/** 掩码 → 核心序号列表（用于摘要文案，别让用户看一串十进制）。 */
function maskToCores(mask) {
  const out = [];
  try {
    let m = BigInt(mask);
    for (let i = 0; i < 64 && m > BigInt(0); i++) {
      if (m & BigInt(1)) out.push(i);
      m >>= BigInt(1);
    }
  } catch {
    /* 掩码异常只影响文案，不影响功能 */
  }
  return out;
}

/** 中文一行摘要：设置页「当前生效限制」那一行直接显示它。 */
exports.describe = function (limits) {
  const l = exports.normalizeLimits(limits);
  const parts = [];
  parts.push(l.memoryMB ? `内存上限 ${l.memoryMB}MB` : "内存跟随全局设置");
  parts.push(`优先级${PRIORITY_TEXT[l.priority] || PRIORITY_TEXT.normal}`);
  if (l.affinityMask) {
    const cores = maskToCores(l.affinityMask);
    parts.push(cores.length ? `绑定 ${cores.length} 个核心（#${cores.join("、#")}）` : `亲和性掩码 ${l.affinityMask}`);
  } else {
    parts.push("核心不限");
  }
  parts.push(l.jvmArgs.length ? `附加 JVM 参数 ${l.jvmArgs.length} 项` : "无附加 JVM 参数");
  return parts.join("，");
};

// ---------------------------------------------------------------------------
// Windows 进程附着
// ---------------------------------------------------------------------------

/** 跑一段 PowerShell，始终 resolve（不 reject），5 秒超时兜底。 */
function runPowerShell(script) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ ok: false, error: "仅 Windows 支持进程附着" });
      return;
    }
    // 中文 Windows 的 PowerShell 默认按 GBK 输出，Node 按 UTF-8 解码 → 报错全是乱码，
    // 排障时根本看不出「找不到进程」还是「拒绝访问」。先把控制台输出编码改成 UTF-8。
    const wrapped = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " + script;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapped],
      { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // 优先回 stderr：PowerShell 的报错文案（如「找不到进程」）比 err.message 有用得多。
          // 压成一行再截断：这段文字最终会进 launch 日志，多行堆栈会把日志搅乱。
          const raw = String((stderr && stderr.trim()) || (err && err.message) || err);
          resolve({ ok: false, error: raw.replace(/\s+/g, " ").trim().slice(0, 300) });
          return;
        }
        resolve({ ok: true, out: String(stdout || "").trim() });
      },
    );
  });
}

/**
 * 给已启动的进程设置优先级 / 亲和性。
 *
 * 返回 { ok, applied, failed, detail }：
 *   - applied 列出「设成功」的动作（'priority' / 'affinity'）
 *   - failed 逐条给出「哪个动作 + 为什么失败」，调用方据此决定要不要重试
 * pid 非法、平台不对、进程已退出……全部走 failed，不抛。
 */
exports.applyProcessTuning = function (pid, limits) {
  const id = Number(pid);
  const l = exports.normalizeLimits(limits);
  const applied = [];
  const failed = [];

  if (!Number.isInteger(id) || id <= 0) {
    return Promise.resolve({
      ok: false,
      applied: applied,
      failed: [{ action: "pid", error: "无效的进程号：" + String(pid) }],
      detail: "无效的进程号",
    });
  }

  const jobs = [];

  // priority=normal 是系统默认值，去设一遍只会白等一次 PowerShell 冷启动（约 200~400ms），
  // 所以直接跳过，并按「已经处于目标状态」记一个 applied，调用方不用区分「没设」和「设成默认」。
  if (l.priority === "normal") {
    applied.push("priority");
  } else {
    const cls = PRIORITY_MAP[l.priority];
    jobs.push(
      runPowerShell(
        `$p = Get-Process -Id ${id} -ErrorAction Stop; $p.PriorityClass = '${cls}'; $p.PriorityClass`,
      ).then((r) => {
        if (r.ok) applied.push("priority");
        else failed.push({ action: "priority", error: r.error });
      }),
    );
  }

  if (l.affinityMask) {
    // ProcessorAffinity 要 IntPtr，PowerShell 会自动把十进制串转过去；回读一次确认真的生效了
    jobs.push(
      runPowerShell(
        `$p = Get-Process -Id ${id} -ErrorAction Stop; $p.ProcessorAffinity = ${l.affinityMask}; $p.ProcessorAffinity`,
      ).then((r) => {
        if (r.ok) applied.push("affinity");
        else failed.push({ action: "affinity", error: r.error });
      }),
    );
  }

  return Promise.all(jobs).then(() => ({
    ok: failed.length === 0,
    applied: applied,
    failed: failed,
    detail: exports.describe(l),
  }));
};
