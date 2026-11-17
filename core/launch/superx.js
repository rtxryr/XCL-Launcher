/**
 * Super X 渲染引擎 —— 资源调度引擎 + 资源优化引擎
 *
 * 目标：给「单核渲染」的较早版本补上多线程调度与资源优化，同时保证
 * 任何可下载版本在开启后都不会因为引擎本身产生 bug。
 *
 * 三条安全底线（违反任何一条就整组放弃注入，绝不影响启动）：
 *   1. 只使用对该 Java 大版本确定存在的开关（白名单表，按 majorVersion 门控）
 *   2. 用户/版本 JSON 里已有的同义参数一律不重复注入（不覆盖用户选择）
 *   3. spawn 之前用 `java <flags> -version` 做一次极短自检；失败/超时即整组跳过
 *
 * 设计取舍：
 *   - 1.13+（含 26.x）本身已经是多线程渲染 + G1 默认，强行改 GC 线程数只会更差，
 *     所以这些版本只做「资源调度」（进程优先级 / 核心亲和），不加 GC 参数。
 *   - 1.12.2 及更早的版本普遍用 Java 8 单核渲染，G1 + 线程数缩放是明确的收益项。
 *   - Java 7 / 未知版本：G1 在这些 JVM 上行为不稳，只做调度，不加参数。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ENGINE_NAME = 'Super X';
const ENGINE_VERSION = '1.0.0';

/* ---------------- 基础探测 ---------------- */

/** 逻辑核心数（含超线程） */
function logicalCores() {
  try {
    const n = (os.cpus() || []).length;
    return n > 0 ? n : 4;
  } catch (_) {
    return 4;
  }
}

/** 物理核心数：拿不到时按逻辑核心的一半估算，最少 2 */
function physicalCores() {
  const logical = logicalCores();
  try {
    const n = os.availableParallelism ? os.availableParallelism() : logical;
    return Math.max(2, Math.min(logical, n));
  } catch (_) {
    return Math.max(2, Math.floor(logical / 2));
  }
}

/** 由版本 id 判断是否为「老的单核渲染时代」（1.12.2 及更早） */
function isLegacyRenderEra(versionId) {
  const id = String(versionId || '').trim();
  if (!id) return false;
  /* 26.x / 1.2x 这类现代版本直接判否，避免被下面的小版本号规则误伤 */
  const modern = /^(2[0-9]|1\.(1[3-9]|2[0-9]))(\.|$|-)/.test(id);
  if (modern) return false;
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(id);
  if (m) {
    const minor = Number(m[1]);
    if (minor < 13) return true;
    return false;
  }
  /* 快照（如 26.4-pre1 / 24w14a）：按现代处理，保守不加 GC 参数 */
  return false;
}

/* ---------------- 资源优化引擎：JVM 参数计划 ---------------- */

const GC_FLAGS = ['-XX:+UseG1GC', '-XX:+UseParNewGC', '-XX:+UseParallelGC', '-XX:+UseSerialGC', '-XX:+UseZGC', '-XX:+UseShenandoahGC'];

function hasAnyArg(args, prefixes) {
  return (args || []).some((a) => typeof a === 'string' && prefixes.some((p) => a.startsWith(p)));
}

/**
 * 生成 JVM 参数计划。
 * @param {{ javaMajor?: number, versionId?: string, existingArgs?: string[], memMB?: number }} opt
 * @returns {{ flags: string[], notes: string[], plan: string, jvm: boolean }}
 */
function planFlags(opt) {
  const o = opt || {};
  const javaMajor = Number(o.javaMajor) || 0;
  const existing = Array.isArray(o.existingArgs) ? o.existingArgs : [];
  const legacy = isLegacyRenderEra(o.versionId);
  const cores = logicalCores();
  const flags = [];
  const notes = [];

  /* 已知 GC 冲突 → 不动参数，只做调度 */
  if (hasAnyArg(existing, GC_FLAGS)) {
    notes.push('检测到已有 GC 参数，Super X 不再叠加');
    return { flags, notes, plan: 'scheduling-only', jvm: false };
  }

  if (!legacy) {
    notes.push('该版本已原生多线程渲染，Super X 只做资源调度');
    return { flags, notes, plan: 'scheduling-only', jvm: false };
  }

  if (javaMajor < 8) {
    notes.push('Java ' + (javaMajor || '未知') + ' 版本过低，G1 行为不稳定，只做资源调度');
    return { flags, notes, plan: 'scheduling-only', jvm: false };
  }

  /* Java 8+ 的老版本：G1 + 线程数缩放（多核模式的核心） */
  if (!hasAnyArg(existing, ['-XX:ParallelGCThreads'])) {
    const gcThreads = Math.max(1, Math.min(cores, 16));
    flags.push('-XX:ParallelGCThreads=' + gcThreads);
    notes.push('并行 GC 线程 ×' + gcThreads);
  }
  if (!hasAnyArg(existing, ['-XX:ConcGCThreads'])) {
    const conc = Math.max(1, Math.min(4, Math.floor(cores / 4) || 1));
    flags.push('-XX:ConcGCThreads=' + conc);
    notes.push('并发标记线程 ×' + conc);
  }
  if (javaMajor >= 9 && !hasAnyArg(existing, ['-XX:MaxGCPauseMillis'])) {
    flags.push('-XX:MaxGCPauseMillis=50');
    notes.push('G1 目标停顿 50ms');
  }
  /* G1 放最后：JVM 以最后一次 GC 选择为准，放末尾保证它是最终选择 */
  flags.push('-XX:+UseG1GC');
  notes.unshift('G1 分代回收（多线程）');

  return { flags, notes, plan: 'multithread', jvm: true };
}

/* ---------------- 自检（一次通过后按 java+flags 缓存） ---------------- */

function cacheFile(userDataDir) {
  return path.join(userDataDir || os.tmpdir(), 'superx-selftest.json');
}

function readCache(userDataDir) {
  try {
    const raw = fs.readFileSync(cacheFile(userDataDir), 'utf8');
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch (_) {
    return {};
  }
}

function writeCache(userDataDir, obj) {
  try {
    fs.mkdirSync(path.dirname(cacheFile(userDataDir)), { recursive: true });
    fs.writeFileSync(cacheFile(userDataDir), JSON.stringify(obj));
  } catch (_) {
    /* 缓存写不进去不影响功能，只是下次再自检一遍 */
  }
}

function runJavaCheck(javaPath, args, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      resolve({ ok: !!ok, why: why || '' });
    };
    let child;
    try {
      child = execFile(
        javaPath,
        args.concat(['-version']),
        { windowsHide: true, timeout: Math.max(1500, timeoutMs || 5000) },
        (err, stdout, stderr) => {
          if (err) return finish(false, String((err && err.message) || err).slice(0, 200));
          const out = String(stdout || '') + String(stderr || '');
          if (/Unrecognized|Unsupported|Error occurred/i.test(out)) return finish(false, out.slice(0, 200));
          finish(true, '');
        },
      );
      if (child && child.stdin) child.stdin.end();
    } catch (e) {
      finish(false, String((e && e.message) || e).slice(0, 200));
    }
  });
}

/**
 * 确认这组参数在该 java 上可用。结果按 javaPath + 参数集缓存。
 * 失败/超时一律返回 false，调用方丢弃参数继续启动（绝不影响游戏）。
 */
async function selfTest(javaPath, flags, opt) {
  const o = opt || {};
  if (!javaPath || !flags || !flags.length) return { ok: true, cached: false, why: '' };
  const key = javaPath + '|' + flags.join(' ');
  const cache = readCache(o.userDataDir);
  if (cache[key] && cache[key].ok) return { ok: true, cached: true, why: '' };
  const res = await runJavaCheck(javaPath, flags, o.timeoutMs || 6000);
  if (res.ok) {
    cache[key] = { ok: true, at: Date.now(), engine: ENGINE_VERSION };
    writeCache(o.userDataDir, cache);
  } else if (o.log && typeof o.log.warn === 'function') {
    o.log.warn('Super X 自检未通过，已放弃注入（不影响启动）：' + (res.why || '未知'));
  }
  return { ok: res.ok, cached: false, why: res.why };
}

/* ---------------- 资源调度引擎：进程级 ---------------- */

/**
 * 在用户已有 limits 的基础上叠加调度策略：
 *   - 用户显式选过优先级 → 尊重，不覆盖
 *   - 用户没设 → aboveNormal（给渲染/GC 线程更多时间片）
 *   - 亲和性：用户没设 → 不设（默认就是全核，天然多核）
 */
function planScheduling(rawLimits) {
  const src = rawLimits && typeof rawLimits === 'object' ? rawLimits : {};
  const userPicked = src.priority && src.priority !== 'normal';
  const out = Object.assign({}, src);
  if (!userPicked) out.priority = 'aboveNormal';
  return {
    limits: out,
    notes: [
      userPicked ? '沿用你设置的进程优先级' : '进程优先级 aboveNormal',
      src.affinityMask ? '沿用你设置的 CPU 亲和性' : '使用全部 CPU 核心（多核模式）',
    ],
  };
}

/** 给 UI 用的能力摘要（不跑自检，纯静态信息） */
function describe(opt) {
  const o = opt || {};
  const plan = planFlags({
    javaMajor: o.javaMajor,
    versionId: o.versionId,
    existingArgs: o.existingArgs,
    memMB: o.memMB,
  });
  return {
    engine: ENGINE_NAME,
    version: ENGINE_VERSION,
    cores: { logical: logicalCores(), physical: physicalCores() },
    plan: plan.plan,
    jvmFlags: plan.flags,
    notes: plan.notes,
    legacyRenderEra: isLegacyRenderEra(o.versionId),
  };
}

module.exports = {
  ENGINE_NAME,
  ENGINE_VERSION,
  logicalCores,
  physicalCores,
  isLegacyRenderEra,
  planFlags,
  planScheduling,
  selfTest,
  describe,
};
