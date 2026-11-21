/**
 * X Craft Launcher 桌面版主进程（CommonJS）。
 *
 * 结构：
 *   - 渲染进程：ui/index.html（单文件前端，只用 window.FMBridge 取数据）
 *   - 主进程：本文件。持有 FusionBackend（进程内后端门面）+ DesktopBridge（IPC 分发）
 *   - 桥接：preload.js 暴露 window.FMBridge.invoke / window.FMBridge.on
 *
 * 安全基线：contextIsolation 开、nodeIntegration 关、不加载任何远程页面。
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const updateService = require('./update-service');
const { resolveConcurrency, deviceProfile } = require('./core/net/conc-policy.js');
const { applyGameLanguage } = require('./core/launch/lang.js');
// 诊断包：纯 Node 实现（不依赖 electron），崩溃时把日志打成一个 zip 交给用户发客服
const { createDiag } = require('./core/system/diag');
// 自适应运行限制：纯函数 + Windows 进程附着，无副作用，直接顶层 require
// （只有 core/system/perf.js 是别人正在新建的，那个必须惰性加载，见 loadPerf）
const launchLimits = require('./core/launch/limits.js');
const superx = require('./core/launch/superx.js');
// 内测功能入口：用户手动开启后采集设备画像 + 脱敏日志，上传到官网新接口
const betaReport = require('./core/system/beta.js');
// 内存优化：常驻轻量监控 + 空闲后台进程清理（只列候选，清理由用户确认）
const memopt = require('./core/system/memopt.js');

// 应用名统一成 X Craft Launcher：
//   影响任务栏名、app.getPath('userData')、错误日志目录（<AppData>\X Craft Launcher）。
// 必须在任何 app.getPath 之前设置。账号 / 服务器数据在后端的 ~/.fusionmc，不受影响。
app.setName('X Craft Launcher');

// ---------------------------------------------------------------------------
// 日志：全局异常兜底写文件，避免打包后无控制台时"闪退无痕"
// ---------------------------------------------------------------------------
function errorLogFile() {
  try {
    return path.join(app.getPath('userData'), 'main-error.log');
  } catch {
    return path.join(process.cwd(), 'main-error.log');
  }
}

// ---------------------------------------------------------------------------
// 内测功能入口（可选参加）
//   默认关闭。用户打开后：采集设备画像 + 脱敏日志 → 上传官网 /api/v1/beta/report
//   同时把最近一次结果写进 userData/beta.json，界面可回读状态。
// ---------------------------------------------------------------------------
function betaStateFile() {
  try {
    return path.join(app.getPath('userData'), 'beta.json');
  } catch {
    return path.join(process.cwd(), 'beta.json');
  }
}

function betaState() {
  const empty = { enabled: false, anon: '', lastAt: '', lastOk: false, lastError: '', lastId: '', lastBytes: 0 };
  try {
    const raw = fs.readFileSync(betaStateFile(), 'utf8');
    const j = JSON.parse(raw);
    return Object.assign(empty, j || {});
  } catch {
    return empty;
  }
}

function saveBetaState(next) {
  try {
    const f = betaStateFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    logError('beta.saveState', e);
  }
  return next;
}

/** 候选日志：主进程错误日志 + userData 下的其它 *.log（各取尾部） */
function betaLogFiles() {
  const out = [];
  try { out.push(errorLogFile()); } catch {}
  try {
    const dir = app.getPath('userData');
    for (const name of fs.readdirSync(dir)) {
      if (!/\.log$/i.test(name)) continue;
      const f = path.join(dir, name);
      if (!out.includes(f)) out.push(f);
    }
  } catch {}
  return out;
}

const betaRuntime = { busy: false };

async function betaUpload(reason) {
  if (betaRuntime.busy) return { ok: false, error: '上一次上报还没结束' };
  betaRuntime.busy = true;
  const st = betaState();
  try {
    const payload = await betaReport.collect({
      appVersion: app.getVersion(),
      logFiles: betaLogFiles(),
      extra: {
        reason: String(reason || 'manual'),
        superX: (() => { try { return !!superxStatusCache; } catch { return null; } })(),
      },
    });
    const res = await betaReport.upload(payload, {
      anon: st.anon,
      saveFile: path.join(app.getPath('userData'), 'beta-last-report.json'),
    });
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    const next = Object.assign({}, st, {
      lastAt: new Date().toISOString(),
      lastOk: !!res.ok,
      lastError: res.ok ? '' : String(res.error || ''),
      lastId: res.ok ? String(res.id || '') : '',
      lastBytes: bytes,
    });
    saveBetaState(next);
    return Object.assign({ ok: !!res.ok, data: { state: next, bytes } }, res.ok ? {} : { error: res.error });
  } catch (e) {
    const next = Object.assign({}, st, {
      lastAt: new Date().toISOString(),
      lastOk: false,
      lastError: String((e && e.message) || e),
    });
    saveBetaState(next);
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    betaRuntime.busy = false;
  }
}

// ---------------------------------------------------------------------------
// 内存优化：监控器 + 告警推送
// ---------------------------------------------------------------------------
let superxStatusCache = null;   /* 仅供内测上报附带一个开关快照，可为 null */

const memWatcher = memopt.createWatcher({
  log: (m) => logError('memopt', m),
  onAlarm: (info) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fmbridge:event:mem:alarm', info);
      }
    } catch (e) {
      logError('memopt.emitAlarm', e);
    }
  },
});

// ---------------------------------------------------------------------------
// 实时性能：整机 CPU / 内存瞬时值（只给「性能设置 → 实时预览」用）
//
// 口径说明（界面上的小字与这里一致）：
//   - CPU 用 os.cpus() 的 idle/total 两次采样差值算，第一次调用没有上一次基线，
//     返回 null，由前端沿用上一帧，不会出现 0% 的假读数。
//   - 内存直接用 process.getSystemMemoryInfo()（KB），不拉起 PowerShell，
//     面板每秒一次也不会带来可见开销。
// ---------------------------------------------------------------------------
let perfCpuBase = null;

function perfCpuPercent() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus() || []) {
    const t = (c && c.times) || {};
    idle += Number(t.idle) || 0;
    total += (Number(t.user) || 0) + (Number(t.nice) || 0) + (Number(t.sys) || 0) +
      (Number(t.irq) || 0) + (Number(t.idle) || 0);
  }
  const base = perfCpuBase;
  perfCpuBase = { idle, total };
  if (!base || total <= base.total) return null;
  const dTotal = total - base.total;
  const dIdle = idle - base.idle;
  if (dTotal <= 0) return null;
  const pct = (1 - dIdle / dTotal) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

function perfSnapshot() {
  let totalMB = 0;
  let freeMB = 0;
  try {
    const mi = typeof process.getSystemMemoryInfo === 'function' ? process.getSystemMemoryInfo() : null;
    if (mi) {
      totalMB = Math.round((mi.total || 0) / 1024);
      freeMB = Math.round((mi.free || 0) / 1024);
    }
  } catch {
    /* 拿不到就走下面的兜底 */
  }
  if (!totalMB) {
    const last = memWatcher && typeof memWatcher.status === 'function' ? memWatcher.status() : null;
    if (last && last.totalMB) {
      totalMB = last.totalMB;
      freeMB = last.freeMB;
    }
  }
  return {
    at: Date.now(),
    cpu: perfCpuPercent(),
    memFreeMB: freeMB,
    memTotalMB: totalMB,
  };
}

function logError(scope, err) {
  const line = `[${new Date().toISOString()}] ${scope}: ${
    err && err.stack ? err.stack : String(err)
  }\n`;
  try {
    fs.appendFileSync(errorLogFile(), line, 'utf8');
  } catch {
    /* 日志写不进去也不能再抛 */
  }
  // 开发态还能看到 stderr
  console.error(line.trim());
}

process.on('uncaughtException', (err) => {
  logError('uncaughtException', err);
  // 不直接退出：后端多数是异步任务，单次异常不该带走整个窗口
  // 诊断包：主进程异常是最难让用户复述的一类，自动打包（10 分钟节流，见 autoPack）
  autoPack('main-exception');
});
process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason);
});

// ---------------------------------------------------------------------------
// 运行态对象
// ---------------------------------------------------------------------------
/** @type {BrowserWindow | null} */
let mainWindow = null;
let backend = null;
let bridge = null;
/** attachEmitter 返回的取消函数 */
let detachEmitter = null;
/** 是否已完成清理（防止重复执行） */
let cleanedUp = false;
/** 是否允许真正退出（清理完成后置 true） */
let allowQuit = false;

// ---------------------------------------------------------------------------
// 游戏安装 / 启动（真实下载与启动，直接调 core；不走 bridge 白名单）
//
// 之前的界面只有前端假进度，这里把 core 的 GameInstaller / launchGame 接上：
//   game:installed    扫描安装目录，列出已装版本
//   game:install      后台任务，进度经 backend.events("progress") 转发
//   game:launch       组装命令行并 spawn，输出/退出经 gameOutput / gameExit 转发
//   game:stop         结束游戏进程
//   game:status       当前运行/下载状态
// ---------------------------------------------------------------------------
const GAME = {
  /** 当前生效的安装目录（= 设置里的安装路径，默认 <exe目录>\Game） */
  dir: null,
  installing: false,
  installVersionId: null,
  proc: null,
  running: false,
  versionId: null,
  startedAt: 0,
  /** 本次启动的 java 路径（诊断包要用） */
  javaPath: null,
  /** 用户主动点了「结束游戏」：退出码非 0 也不算崩溃，不自动打包 */
  stoppedByUser: false,
  /** 本次启动已经自动打过包（一次启动最多一个 game-crash 包） */
  crashPacked: false,
  /** 上一次退出的现场，供「手动打包」时把 exitCode / lastError 写进 summary */
  lastExit: null,
};

// 关闭确认已通过，避免 close 事件二次弹框
let closingConfirmed = false;

/** 默认安装目录：软件（exe）所在目录下的 Game 文件夹。 */
function defaultGameDir() {
  try {
    return path.join(path.dirname(app.getPath('exe')), 'Game');
  } catch {
    return path.join(process.cwd(), 'Game');
  }
}

function resolveGameDir(p) {
  const v = typeof p === 'string' ? p.trim() : '';
  return path.resolve(v || defaultGameDir());
}

/**
 * 把后端切到指定安装目录。
 * core 的 GameInstaller 在构造时绑定 gameDir，因此换目录必须重建它，
 * 同时同步 config.gameDir（nativesDir / libraries / assets 都从它派生）。
 */
function applyGameDir(dir) {
  const abs = path.resolve(dir);
  GAME.dir = abs;
  if (backend && backend.config && backend.config.value) backend.config.value.gameDir = abs;
  if (backend) {
    const { GameInstaller } = require('./core/download/install.js');
    backend.installer = new GameInstaller(backend.mirrors, abs, backend.log.child('install'));
  }
  return abs;
}

/** 往渲染进程推一条自定义游戏事件（与 backend 事件同一前缀）。 */
function emitGame(name, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('fmbridge:event:' + name, data);
  }
}

// ---------------------------------------------------------------------------
// 自适应运行限制 / 性能采样（1.0.10）
//
// 依赖约定：core/system/perf.js 由同版本的另一位同事新建，本文件落地时它可能还不存在。
// 因此这里「惰性 require + 失败即置空 + 下次再试」，绝不在顶层 require：
// 顶层 require 一个不存在的文件会直接抛 MODULE_NOT_FOUND，整个启动器都起不来。
// 所有能力缺失时退化成「没有自适应限制」，游戏照常启动。
// ---------------------------------------------------------------------------
/** @type {any} 已加载的 perf 模块（null = 当前不可用） */
let perfModule = null;

/** 取性能模块；不存在 / 只实现了一半 / require 抛错，统一返回 null。 */
function loadPerf() {
  if (perfModule) return perfModule;
  try {
    const mod = require('./core/system/perf.js');
    // 只校验「本文件真的会调」的函数，避免队友分阶段提交时整块被判定为不可用
    if (mod && typeof mod === 'object') perfModule = mod;
  } catch {
    // 不存在就是还没落地：保持 null，下一次调用会重新尝试（开发态热替换也能接上）
    perfModule = null;
  }
  return perfModule;
}

/** 当前这次启动的采样器（同一时刻只允许一个游戏在跑，GAME.running 已互斥）。 */
let perfSampler = null;

/**
 * 启动采样。
 * 采样失败不影响游戏：CPU/内存统计只是「下次该给多少」的依据，缺一次数据没人在意。
 */
function startPerfSampling(pid) {
  const perf = loadPerf();
  if (!perf || typeof perf.startSampling !== 'function' || !pid) return;
  try {
    perfSampler = perf.startSampling(pid) || null;
  } catch (err) {
    perfSampler = null;
    logError('perf.startSampling', err);
  }
}

/** 落一条启动记录；任何异常只记日志（统计写不进去不能影响退出流程）。 */
function recordPerfStats(stats, uptimeMs) {
  if (!stats) return;
  const perf = loadPerf();
  if (!perf || typeof perf.recordLaunch !== 'function') return;
  try {
    // userData 取不到（app 还没 ready 就退出）时直接跳过，不让统计把退出流程带崩
    const dir = app.getPath('userData');
    perf.recordLaunch(dir, {
      cpuAvg: stats.cpuAvg,
      ramAvgMB: stats.ramAvgMB,
      ramPeakMB: stats.ramPeakMB,
      uptimeMs: uptimeMs,
    });
  } catch (err) {
    logError('perf.recordLaunch', err);
  }
}

/**
 * 退出时收尾：停采样 → 落盘一条启动记录。
 *
 * 兼容两种契约写法（采样句柄带 stop，或模块上挂 stopSampling）：
 * 队友实现细节未定，这里不去赌，谁的形状对就用谁，都对不上就只跳过记录。
 * 注意 perf.stop() 返回的是 Promise（内部要等最后一次性采样结算），
 * 所以这里统一用 Promise.resolve 接住：同步对象与 Promise 都能走通。
 */
function finishPerfSampling(uptimeMs) {
  const perf = loadPerf();
  const sampler = perfSampler;
  perfSampler = null;
  if (!perf) return;

  let out = null;
  try {
    if (sampler && typeof sampler.stop === 'function') out = sampler.stop();
    else if (typeof perf.stopSampling === 'function') out = perf.stopSampling();
  } catch (err) {
    logError('perf.stop', err);
    return;
  }
  if (!out) return;
  Promise.resolve(out)
    .then((stats) => recordPerfStats(stats, uptimeMs))
    .catch((err) => logError('perf.recordLaunch', err));
}

/**
 * 按程序图形首选项（Windows 的 GpuPreference）——「独显情况下最大显卡」开关的实现。
 *
 * 只写 HKCU 下的 per-app 首选项，不动机器全局的显卡策略：
 *   GpuPreference=2 → 高性能（独显）
 *   GpuPreference=0 → 让 Windows 自己决定
 * reg.exe 是系统自带的，失败也只是「没设上」，不影响启动，所以这里只记日志。
 */
function applyGpuPreference(javaPath, mode) {
  if (!javaPath || !mode) return;
  const value = mode === 'discrete' ? 'GpuPreference=2;' : 'GpuPreference=0;';
  try {
    const { execFile } = require('child_process');
    const child = execFile(
      'reg',
      ['add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v', javaPath, '/t', 'REG_SZ', '/d', value, '/f'],
      { windowsHide: true },
      (err) => {
        if (err) backend.log.child('launch').warn('图形首选项写入失败（不影响启动）：' + ((err && err.message) || err));
        else backend.log.child('launch').info('图形首选项已写入：' + javaPath + ' → ' + value);
      },
    );
    if (child && child.stdin) child.stdin.end();
  } catch (e) {
    backend.log.child('launch').warn('图形首选项写入异常（不影响启动）：' + ((e && e.message) || e));
  }
}

/**
 * 启动后给进程挂上限制（优先级 / 亲和性）。
 *
 * 为什么要延迟 1.5 秒：javaw 刚 spawn 出来时还在初始化，Windows 对
 * SetPriorityClass 会返回「拒绝访问」—— 实测同一进程 200ms 时设不上、1.5s 后稳定成功。
 * 所以第一次失败就再补一次；两次都失败只记日志：限制是「锦上添花」，不能反过来打断启动。
 * 定时器 unref，避免它把 Electron 的退出流程拖住。
 */
function attachProcessLimits(pid, rawLimits) {
  if (!pid) return;
  const lim = launchLimits.normalizeLimits(rawLimits);
  // 什么都不用设（旧前端不带 limits，或本来就要「普通优先级 + 不绑核心」）：
  // 直接返回，一次 PowerShell 都不启动 —— 它的冷启动要几百毫秒，没理由白花。
  if (lim.priority === 'normal' && !lim.affinityMask) return;
  const attempt = (retryLeft) => {
    launchLimits
      .applyProcessTuning(pid, rawLimits)
      .then((res) => {
        if (res && res.ok) {
          if (res.applied && res.applied.length) {
            backend.log.child('launch').info('进程限制已生效：' + res.applied.join(' + ') + '（' + res.detail + '）');
          }
          return;
        }
        if (retryLeft > 0) {
          const t = setTimeout(() => attempt(retryLeft - 1), 1000);
          if (t.unref) t.unref();
          return;
        }
        const why = (res && res.failed ? res.failed : [])
          .map((f) => f.action + '：' + f.error)
          .join('；');
        backend.log.child('launch').warn('进程限制未能全部生效（不影响启动）：' + (why || '未知原因'));
      })
      .catch(() => {
        /* 已在 applyProcessTuning 内吞掉，这里只是兜底不产生未处理拒绝 */
      });
  };
  const t = setTimeout(() => attempt(1), 1500);
  if (t.unref) t.unref();
}

/**
 * 扫描 <gameDir>/versions 列出已装版本。
 *
 * 不再只看客户端 jar：客户端 jar + natives/<id> 非空 + libraries 存在，三条都过才算装好。
 * 列表页要快，这里只做 existsSync/readdirSync，不读 version json；
 * 精确的「classpath 每个 jar 是否都在」放到启动前体检（那时已经有 version 对象）。
 *
 * 返回项里的 needsRepair / missingCount 供前端标「需修复」。
 */
function listInstalled(gameDir) {
  const out = [];
  let librariesEmpty = true;
  try {
    librariesEmpty = fs.readdirSync(path.join(gameDir, 'libraries')).length === 0;
  } catch {
    librariesEmpty = true;
  }
  try {
    const vdir = path.join(gameDir, 'versions');
    for (const name of fs.readdirSync(vdir)) {
      try {
        const jar = path.join(vdir, name, name + '.jar');
        if (!fs.existsSync(jar)) continue;
        let missingCount = 0;
        if (librariesEmpty) missingCount++;
        try {
          const natives = fs
            .readdirSync(path.join(gameDir, 'natives', name))
            .filter((n) => !n.startsWith('.'));
          if (natives.length === 0) missingCount++;
        } catch {
          missingCount++;
        }
        out.push({
          id: name,
          size: fs.statSync(jar).size,
          needsRepair: missingCount > 0,
          missingCount: missingCount,
        });
      } catch {
        /* 单个版本目录异常不影响整体 */
      }
    }
  } catch {
    /* versions 目录还不存在 */
  }
  return out;
}

/** 游戏相关通道统一入口（返回 { ok, data?, error? }，不抛异常）。 */
async function handleGameChannel(channel, payload) {
  const p = payload || {};
  try {
    if (channel === 'game:paths') {
      return { ok: true, data: { exeDir: path.dirname(app.getPath('exe')), defaultGameDir: defaultGameDir() } };
    }

    if (channel === 'game:installed') {
      const dir = resolveGameDir(p.gameDir);
      return { ok: true, data: { dir, versions: listInstalled(dir) } };
    }

    if (channel === 'game:install') {
      if (GAME.installing) {
        return { ok: false, error: '已有下载任务在进行中（' + (GAME.installVersionId || '') + '）' };
      }
      const versionId = String(p.versionId || '');
      if (!versionId) return { ok: false, error: '缺少版本号' };
      const dir = applyGameDir(resolveGameDir(p.gameDir));

      GAME.installing = true;
      GAME.installVersionId = versionId;
      emitGame('game:installState', { state: 'start', versionId: versionId, dir: dir });

      // 后台跑：invoke 立即返回，进度与结果都走事件，切页面/关弹窗都不会中断
      (async () => {
        try {
          // 并发不再写死 4/8：按设备（CPU 线程数 + 内存）推导，用户也可自定义 1..N（N = 线程数）。
          // 国内镜像（BMCLAPI/MCIM）对高并发会 429 限流：2026-11-06 实测 8 并发全部 302 正常跳转、
          // 16 并发 15/16 变 429、24 并发 24/24 全 429。所以「自动」模式在 BMCLAPI/auto 源上由
          // 策略层封顶 8，显式自定义值不受压制，改由下面的「失败降速重试」兜底。
          const source = String(p.source || (backend.config && backend.config.runtime && backend.config.runtime.mirror) || 'auto');
          const conc = resolveConcurrency(p.concurrency, { source });
          backend.config.updateRuntime({ downloadConcurrency: conc });

          let summary = await backend.installVersion(versionId, { skipAssets: !!p.skipAssets });
          for (let attempt = 1; attempt <= 2 && summary && summary.failed > 0; attempt++) {
            emitGame('game:installState', {
              state: 'retry',
              versionId: versionId,
              attempt: attempt,
              failed: summary.failed,
            });
            // 已落盘的文件会被复用，这一轮只补失败项；并发先降到 4，还失败才串行
            const retryConc = attempt === 1 ? Math.max(1, Math.min(conc, 4)) : 1;
            backend.config.updateRuntime({ downloadConcurrency: retryConc });
            const retry = await backend.installVersion(versionId, { skipAssets: !!p.skipAssets });
            summary = {
              ...retry,
              bytes: (summary.bytes || 0) + (retry.bytes || 0),
              reused: (retry.reused || 0) + (summary.reused || 0),
            };
          }
          emitGame('game:installState', { state: 'done', versionId: versionId, dir: dir, summary: summary });
        } catch (e) {
          emitGame('game:installState', {
            state: 'error',
            versionId: versionId,
            dir: dir,
            error: String((e && e.message) || e),
          });
        } finally {
          GAME.installing = false;
          GAME.installVersionId = null;
        }
      })();

      return { ok: true, data: { started: true, versionId: versionId, dir: dir } };
    }

    if (channel === 'game:launch') {
      if (GAME.running) return { ok: false, error: '游戏已经在运行中' };
      const versionId = String(p.versionId || '');
      if (!versionId) return { ok: false, error: '缺少版本号' };
      const dir = applyGameDir(resolveGameDir(p.gameDir));

      // 每次启动都重置崩溃判定：用户主动停止标记、本次已打包标记
      GAME.stoppedByUser = false;
      GAME.crashPacked = false;

      const acc = await bridge.handle('account:active', {});
      const identity = acc && acc.ok && acc.data ? acc.data.identity : null;
      if (!identity) return { ok: false, error: '还没有账号：先在首页添加离线账号或登录正版' };

      const { GameResolver } = require('./core/download/resolve.js');
      const { launchGame } = require('./core/launch/launcher.js');
      const { buildContext } = require('./core/meta/rules.js');
      const { classpathSep } = require('./core/core/util.js');

      emitGame('game:launchState', { state: 'prepare', versionId: versionId });

      const version = await backend.loadVersion(versionId);
      const java = await backend.java.resolve(
        version.javaVersion && version.javaVersion.majorVersion,
        backend.config.runtime.javaPath,
      );

      emitGame('game:launchState', { state: 'starting', versionId: versionId, java: java.javaPath });

      const resolver = new GameResolver(backend.mirrors, dir);
      const files = resolver.resolveLibraries(version);
      const classpath = files
        .filter((f) => f.kind === 'library' || f.kind === 'client')
        .map((f) => f.dest)
        .join(classpathSep());

      // ---- 启动前体检：缺文件先补装，绝不带着残缺 classpath 硬启动 ----
      // 旧逻辑缺 49 个库也照 spawn，JVM 2 秒内 NoClassDefFoundError，
      // 前端只看到「游戏已退出」，用户完全不知道原因。
      const { inspectInstallation } = require('./core/download/install.js');
      let health = inspectInstallation(backend.mirrors, dir, version);
      if (!health.ready) {
        const launchLog = backend.log.child('launch');
        launchLog.warn(
          `版本 ${versionId} 不完整（缺 ${health.missingJars.length} 个依赖文件` +
            `${health.nativesEmpty ? '、natives 未解压' : ''}` +
            `${health.assetIndexMissing ? '、缺资源索引' : ''}），开始自动修复`,
        );
        emitGame('game:launchState', {
          state: 'repair',
          versionId: versionId,
          missingCount: health.missingCount,
          message: '检测到版本文件缺失，正在自动修复…',
        });
        const prevInstalling = GAME.installing;
        GAME.installing = true;
        GAME.installVersionId = versionId;
        let repairError = null;
        try {
          // 复用安装流程：已落盘的文件会 reuse，只补缺的（含 natives 解压与 assets 索引）
          const summary = await backend.installVersion(versionId, {});
          if (summary && summary.failed > 0) repairError = `${summary.failed} 个文件下载失败（网络或镜像问题）`;
        } catch (e) {
          repairError = String((e && e.message) || e);
          logError('game:launch/repair', e);
        } finally {
          GAME.installing = prevInstalling;
          GAME.installVersionId = null;
        }
        health = inspectInstallation(backend.mirrors, dir, version);
        if (!health.ready) {
          const detail = [
            health.missingJars.length ? `缺 ${health.missingJars.length} 个依赖` : '',
            health.nativesEmpty ? 'natives 未解压' : '',
            health.assetIndexMissing ? '缺资源索引' : '',
          ]
            .filter(Boolean)
            .join('、');
          return {
            ok: false,
            error:
              `该版本缺少 ${health.missingCount} 项必要文件（${detail}），自动修复` +
              (repairError ? `失败：${repairError}` : '未完成') +
              '。请检查网络后重试，或在安装页重新下载该版本。',
          };
        }
        emitGame('game:launchState', { state: 'prepare', versionId: versionId });
      }

      // 启动语言：先写进游戏目录的 options.txt（lang:zh_cn / lang:en_us），
      // 再拉 JVM。Minecraft 只从这里读语言，没有命令行开关。
      // 老前端不带这个字段时直接跳过（不写日志、不改文件）；
      // 写失败（目录只读等）也不阻断启动。
      if (p.language) {
        try {
          const langRes = applyGameLanguage(dir, p.language);
          if (!langRes.ok && langRes.reason) {
            backend.log.child('launch').warn('启动语言未写入：' + langRes.reason);
          }
        } catch (err) {
          logError('applyGameLanguage', err);
        }
      }

      // 退出时要把「为什么崩」说清楚：缓冲最后若干行输出，退出时提取最后一条错误行。
      const outputTail = [];
      const pushOutput = (_stream, line) => {
        outputTail.push(line);
        if (outputTail.length > 200) outputTail.shift();
      };
      const pickLastError = (lines) => {
        const re = /Exception|Error|FATAL|Caused by|Could not|Failed to/i;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (re.test(lines[i])) return String(lines[i]).trim();
        }
        return '';
      };

      // 自适应限制：UI 会把 perf:info 里拿到的 resolved 原样塞进 payload.limits。
      // normalizeLimits 内部做边界校验（内存对齐、优先级白名单、掩码只认十进制、JVM 参数过滤），
      // 前端传脏了也只是回落默认，不会把 JVM 参数拼坏或把 -Xmx 写成非法值。
      const lim = launchLimits.normalizeLimits(p.limits);

      // ---- Super X 渲染引擎（默认关闭）----
      // 开启后两条腿走路：
      //   资源调度引擎：进程优先级 + 全核亲和（用户显式设过的优先级/亲和性一律尊重）
      //   资源优化引擎：JVM 多线程 GC 参数（白名单 + 版本门控 + spawn 前自检）
      // 任一步失败都静默退回原参数，绝不影响启动，也绝不改变任何版本的可启动性。
      let sxFlags = [];
      let sxNotes = [];
      let effectiveLimits = p.limits;
      if (String(p.superX || '') === 'on') {
        try {
          const existedArgs = [].concat(
            Array.isArray(p.extraJvmArgs) ? p.extraJvmArgs : [],
            launchLimits.buildJvmArgsFromLimits(p.limits) || [],
          );
          const plan = superx.planFlags({
            javaMajor: version.javaVersion && version.javaVersion.majorVersion,
            versionId: versionId,
            existingArgs: existedArgs,
          });
          sxNotes = plan.notes.slice();
          if (plan.flags.length) {
            const chk = await superx.selfTest(java.javaPath, plan.flags, {
              userDataDir: app.getPath('userData'),
              log: backend.log.child('superx'),
            });
            if (chk.ok) {
              sxFlags = plan.flags;
              backend.log.child('superx').info(
                'Super X 已启用（' + plan.plan + '）：' + plan.flags.join(' ') + (chk.cached ? '（自检缓存命中）' : ''),
              );
            } else {
              sxNotes.push('自检未通过，本次只做资源调度');
            }
          }
          const sched = superx.planScheduling(p.limits);
          effectiveLimits = sched.limits;
          sxNotes = sxNotes.concat(sched.notes);
        } catch (e) {
          backend.log.child('superx').warn('Super X 计划生成失败，按原参数启动：' + ((e && e.message) || e));
        }
      }


      // 额外 JVM 参数：老字段 p.extraJvmArgs 继续原样生效（保持旧前端行为不变），
      // limits.jvmArgs 经 buildJvmArgsFromLimits 过滤后并入，再整体去重。
      // 顺序 = 先旧字段后新字段：老逻辑里「后面的参数覆盖前面的」这条直觉得以保留。
      const mergedJvmArgs = (() => {
        const out = [];
        const push = (a) => {
          if (typeof a !== 'string') return;
          const s = a.trim();
          if (!s || out.indexOf(s) !== -1) return;
          out.push(s);
        };
        if (Array.isArray(p.extraJvmArgs)) p.extraJvmArgs.forEach(push);
        launchLimits.buildJvmArgsFromLimits(p.limits).forEach(push);
        /* Super X 的资源优化参数放在最后：JVM 以最后一次 GC 选择为准 */
        sxFlags.forEach(push);
        return out.length ? out : undefined;
      })();

      const handle = launchGame({
        log: backend.log.child('launch'),
        events: backend.events,
        javaPath: java.javaPath,
        version: version,
        identity: identity,
        paths: {
          nativesDir: path.join(dir, 'natives', versionId),
          librariesDir: path.join(dir, 'libraries'),
          assetsDir: path.join(dir, 'assets'),
          gameDir: dir,
          classpath: classpath,
          classpathSeparator: classpathSep(),
        },
        settings: {
          // 内存回退链在 1.0.10 最前面插了一档 limits.memoryMB（已 256 对齐）：
          //   limits.memoryMB → payload.maxMemoryMB → config.runtime.maxMemoryMB → 2048
          // lim.memoryMB 为 null 表示 UI 没指定，继续往下走原来的链，老行为完全不变。
          maxMemoryMB:
            lim.memoryMB || Number(p.maxMemoryMB) || backend.config.runtime.maxMemoryMB || 2048,
          extraJvmArgs: mergedJvmArgs,
          width: Number(p.width) || 1280,
          height: Number(p.height) || 720,
          fullscreen: !!p.fullscreen,
        },
        ctx: buildContext(),
        onOutput: pushOutput,
      });

      GAME.proc = handle;
      GAME.running = true;
      GAME.versionId = versionId;
      GAME.startedAt = Date.now();
      GAME.javaPath = java.javaPath;
      emitGame('game:launchState', { state: 'running', versionId: versionId, pid: handle.pid });

      // 进程已拿到 pid：延迟挂限制（失败自动重试一次，全程只记日志）
      attachProcessLimits(handle.pid, effectiveLimits);
      /* 「独显情况下最大显卡」：只在这一项被显式打开时才写图形首选项 */
      if (String(p.gpuPref || '') === 'discrete' && java && java.javaPath) {
        applyGpuPreference(java.javaPath, 'discrete');
      }
      // 同时开始采样：CPU / 内存曲线是「下一次给多少」的唯一依据，
      // 只采不存，退出时才落一条（perf 模块自己只保留最近 5 条）。
      startPerfSampling(handle.pid);

      handle
        .wait()
        .then((res) => {
          const uptimeMs = Date.now() - GAME.startedAt;
          const lastError = pickLastError(outputTail);
          const lastLines = outputTail.slice(-12);
          // 先停采样再往下走：此刻进程已退出，晚一步就读不到准确的峰值了
          finishPerfSampling(uptimeMs);
          GAME.running = false;
          GAME.proc = null;
          GAME.versionId = null;
          emitGame('game:launchState', {
            state: 'exit',
            versionId: versionId,
            code: res.exitCode,
            signal: res.signal,
            uptimeMs: uptimeMs,
            lastError: lastError,
            lastLines: lastLines,
          });
          // 退出现场存一份：手动打诊断包时（那时已不在运行）也要能带上退出码与错误行
          GAME.lastExit = {
            versionId: versionId,
            exitCode: res.exitCode,
            signal: res.signal,
            uptimeMs: uptimeMs,
            lastError: lastError,
            lastLines: outputTail.slice(-30),
            at: Date.now(),
          };
          if (res.exitCode !== 0 && uptimeMs < 20000) {
            backend.log
              .child('launch')
              .error(
                `启动疑似失败：退出码 ${res.exitCode}，存活 ${uptimeMs}ms` +
                  (lastError ? `，最后一条错误：${lastError}` : ''),
              );
          }
          // 异常退出自动打包：用户主动 stop / 启动器退出时杀的（cleanup 会置 stoppedByUser）都不算
          if (res.exitCode !== 0 && !GAME.stoppedByUser) autoPack('game-crash');
        })
        .catch((err) => {
          const uptimeMs = Date.now() - GAME.startedAt;
          GAME.running = false;
          GAME.proc = null;
          // 等进程失败同样收尾采样：崩溃前的内存峰值恰恰是最有价值的一条记录
          finishPerfSampling(uptimeMs);
          logError('game:launch/wait', err);
          emitGame('game:launchState', {
            state: 'exit',
            versionId: versionId,
            code: -1,
            uptimeMs: uptimeMs,
            lastError: pickLastError(outputTail),
            lastLines: outputTail.slice(-12),
          });
          GAME.lastExit = {
            versionId: versionId,
            exitCode: -1,
            uptimeMs: uptimeMs,
            lastError: pickLastError(outputTail),
            lastLines: outputTail.slice(-30),
            at: Date.now(),
          };
          // 等进程失败（spawn 失败 / 管道断开）同样是「游戏没跑起来」，一样自动打包
          if (!GAME.stoppedByUser) autoPack('game-crash');
        });

      return { ok: true, data: { pid: handle.pid, java: java.javaPath } };
    }

    if (channel === 'game:stop') {
      if (!GAME.running || !GAME.proc) return { ok: true, data: { stopped: false } };
      try {
        // 先打标记再 kill：kill 后进程立刻退出，退出分支是异步回调，
        // 不先置位的话这一次「用户主动结束」会被当成崩溃自动打包。
        GAME.stoppedByUser = true;
        GAME.proc.kill();
      } catch (e) {
        GAME.stoppedByUser = false;
        return { ok: false, error: String((e && e.message) || e) };
      }
      return { ok: true, data: { stopped: true } };
    }

    if (channel === 'game:status') {
      return {
        ok: true,
        data: {
          running: GAME.running,
          pid: GAME.proc ? GAME.proc.pid : null,
          versionId: GAME.versionId,
          installing: GAME.installing,
          installVersionId: GAME.installVersionId,
          dir: GAME.dir || resolveGameDir(''),
        },
      };
    }

    return { ok: false, error: '未知游戏通道：' + channel };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * 只读采样一个进程的工作集内存（字节）。
 *
 * Windows 走 tasklist —— 比 powershell 冷启动快一个数量级（约 30ms 一次），
 * 面板每 3 秒采一次也不会拖慢界面；其它平台退回 ps。
 * 只读：不结束、不注入、不写文件。进程已退出或无权限时返回 ok:false，
 * 由前端显示「—」，不允许编一个看着像真的数字。
 */
function procUsage(pid) {
  return new Promise((resolve) => {
    const done = (rss) => {
      if (rss > 0) resolve({ ok: true, data: { pid, rss } });
      else resolve({ ok: false, error: '进程不存在或已退出' });
    };

    if (process.platform === 'win32') {
      execFile(
        'tasklist',
        ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 4000 },
        (err, stdout) => {
          if (err || !stdout) return done(0);
          const line = String(stdout).trim().split(/\r?\n/)[0] || '';
          if (!line || /^INFO:/i.test(line)) return done(0);
          // "java.exe","1234","Console","1","1,234,567 K"
          const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
          const kb = Number(String(cols[cols.length - 1] || '').replace(/[^\d]/g, ''));
          done(isFinite(kb) ? kb * 1024 : 0);
        }
      );
      return;
    }

    execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return done(0);
      const kb = Number(String(stdout).trim().split(/\s+/)[0]);
      done(isFinite(kb) ? kb * 1024 : 0);
    });
  });
}

// ---------------------------------------------------------------------------
// 后端 + 桥接初始化（只在主进程内完成，不监听任何端口）
// ---------------------------------------------------------------------------
async function initBackend() {
  const { FusionBackend } = require('./core/backend.js');
  const { DesktopBridge } = require('./core/desktop/bridge.js');

  backend = new FusionBackend();
  await backend.init();

  bridge = new DesktopBridge({ backend });

  // 资源探测用 Electron 主进程的能力（含 Windows 提交内存 swapTotal/swapFree），
  // 比纯 Node 的 os.freemem 更能反映「页面文件耗尽」这类真实卡顿。
  if (bridge.setResourceProbe) {
    bridge.setResourceProbe(() => {
      // 注意：process.getSystemMemoryInfo() 返回的单位是「千字节 KB」，
      // 而后端 SystemResourceSample 契约是「字节」。必须 ×1024 对齐，否则
      // free 被当成字节后恒小于 700MB 阈值，导致内存充足时也误弹「资源严重不足」。
      const m = process.getSystemMemoryInfo();
      return {
        total: m.total * 1024,
        free: m.free * 1024,
        swapTotal: m.swapTotal * 1024,
        swapFree: m.swapFree * 1024,
      };
    });
  }

  // 渲染进程 → 主进程：所有子通道都从这一条 IPC 进来。
  // 其中 fs:* 三条在主进程直接处理：目录选择需要 dialog + 窗口引用，
  // 文件读写需要 Node fs（渲染进程 nodeIntegration 关，拿不到 fs）。
  ipcMain.handle('fmbridge:invoke', async (event, channel, payload) => {
    // 游戏安装 / 启动：直连 core（bridge 白名单不含这些通道，避免动 core 的 TS 定义）
    if (typeof channel === 'string' && channel.indexOf('game:') === 0) {
      return handleGameChannel(channel, payload);
    }
    // 应用信息 / 自动更新：实现在 update-service.js，状态变化经 fmbridge:event:update:status 推送
    if (
      typeof channel === 'string' &&
      (channel === 'app:info' || channel.indexOf('update:') === 0)
    ) {
      return updateService.handle(channel, payload);
    }
    // 设备画像：设置页据此渲染「跟随设备」的自动并发值与自定义上限（= CPU 线程数）
    // 内测功能入口：状态 / 开启（首次上报）/ 关闭 / 手动再报一次
    if (channel === 'beta:status') {
      const st = betaState();
      return { ok: true, data: Object.assign({}, st, { anon: st.anon || betaReport.anonId(betaStateFile()) }) };
    }
    if (channel === 'beta:enable') {
      const st = betaState();
      const anon = st.anon || betaReport.anonId(betaStateFile());
      saveBetaState(Object.assign({}, st, { enabled: true, anon, enabledAt: new Date().toISOString() }));
      const res = await betaUpload('enable');
      return res;
    }
    if (channel === 'beta:disable') {
      const st = betaState();
      return { ok: true, data: saveBetaState(Object.assign({}, st, { enabled: false, disabledAt: new Date().toISOString() })) };
    }
    if (channel === 'beta:send') {
      return betaUpload(String((payload && payload.reason) || 'manual'));
    }

    // 内存优化：状态 / 候选进程 / 执行清理 / 开关注册监控
    // 实时性能预览：整机 CPU / 内存瞬时值（性能设置页打开时才被调用）
    if (channel === 'sys:perf') {
      try {
        return { ok: true, data: perfSnapshot() };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    if (channel === 'mem:status') {
      return { ok: true, data: memWatcher.status() };
    }
    if (channel === 'mem:candidates') {
      try {
        return { ok: true, data: await memopt.listCandidates() };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    if (channel === 'mem:cleanup') {
      try {
        const pids = Array.isArray(payload && payload.pids) ? payload.pids : [];
        const r = await memopt.cleanup(pids);
        return { ok: true, data: r };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    if (channel === 'mem:watch') {
      const on = !!(payload && payload.on);
      if (on) memWatcher.start(); else memWatcher.stop();
      return { ok: true, data: memWatcher.status() };
    }

    if (channel === 'app:device') {
      return { ok: true, data: deviceProfile() };
    }
    // Super X 渲染引擎：能力摘要 / 当前版本计划预览（只读，不写任何配置）
    if (channel === 'superx:info') {
      try {
        return {
          ok: true,
          data: superx.describe({
            javaMajor: Number(payload && payload.javaMajor) || 0,
            versionId: String((payload && payload.versionId) || ''),
            existingArgs: Array.isArray(payload && payload.existingArgs) ? payload.existingArgs : [],
            memMB: Number(payload && payload.memMB) || 0,
          }),
        };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    // 自适应运行限制：perf:info / perf:reset / perf:launchNote
    // perf.js 可能还没落地，handlePerfChannel 内部统一降级，不含任何会冒到渲染层的抛错
    if (typeof channel === 'string' && channel.indexOf('perf:') === 0) {
      return handlePerfChannel(channel, payload);
    }
    // 诊断包：diag:status / pack / reveal / clear / path
    // 同样是「模块未就绪也返回 ok:false」，不让 require/初始化失败冒到渲染层
    if (typeof channel === 'string' && channel.indexOf('diag:') === 0) {
      return handleDiagChannel(channel, payload);
    }
    // 单个进程的工作集内存：服务端面板用来看「这间服吃了多少内存」。
    // 纯只读采样 —— 不结束进程、不注入、不写文件，pid 由渲染进程传入
    // （来自 server:list 返回的服务端 pid）。读不到就如实报错，绝不编数字。
    if (channel === 'proc:usage') {
      const pid = Number(payload && payload.pid);
      if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: '缺少 pid' };
      return procUsage(pid);
    }
    if (channel === 'fs:pickDirectory') {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts = {
        title: '选择 .minecraft 目录',
        properties: ['openDirectory', 'createDirectory'],
      };
      const res = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (res.canceled || !res.filePaths || !res.filePaths.length) {
        return { ok: true, data: { canceled: true } };
      }
      return { ok: true, data: { path: res.filePaths[0] } };
    }
    if (channel === 'fs:stat') {
      const p = payload && payload.path;
      if (typeof p !== 'string' || !p) return { ok: false, error: '缺少 path' };
      try {
        const st = fs.statSync(p);
        return { ok: true, data: { size: st.size } };
      } catch (e) {
        return { ok: true, data: { missing: true } };
      }
    }
    if (channel === 'fs:writeFile') {
      const p = payload && payload.path;
      const d = payload && payload.data;
      if (typeof p !== 'string' || !p) return { ok: false, error: '缺少 path' };
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, Buffer.from(d));
        return { ok: true, data: { ok: true } };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    // ---------- 资源导入（材质包 / 光影 / 模组） ----------
    // 渲染进程没有 fs，拖进来的文件也只剩一个名字拿不到真实路径，
    // 所以选择、复制、列举、删除统一在主进程做。
    if (typeof channel === 'string' && channel.indexOf('resources:') === 0) {
      return handleResourcesChannel(channel, payload);
    }
    if (channel === 'fs:pickFiles') {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts = {
        title: '选择要导入的资源',
        buttonLabel: '导入',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '资源包 / 模组', extensions: ['zip', 'jar', 'mcpack', 'mcaddon', '7z', 'rar'] },
          { name: '全部文件', extensions: ['*'] },
        ],
      };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (res.canceled || !res.filePaths || !res.filePaths.length) {
        return { ok: true, data: { canceled: true, paths: [] } };
      }
      return { ok: true, data: { canceled: false, paths: res.filePaths } };
    }
    // ---------- 启动器自定义背景（图片 / 视频） ----------
    // 文件复制到 userData/background/ 后由渲染进程用 file:// 引用；
    // 只做「选择 → 复制 → 读取 / 清理」，从不修改用户的原始文件。
    if (typeof channel === 'string' && channel.indexOf('bg:') === 0) {
      const bgDir = path.join(app.getPath('userData'), 'background');
      const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'];
      const VID_EXT = ['.mp4', '.webm', '.mov', '.m4v', '.ogv'];
      const kindOf = (p) => {
        const ext = path.extname(String(p || '')).toLowerCase();
        if (IMG_EXT.includes(ext)) return 'image';
        if (VID_EXT.includes(ext)) return 'video';
        return '';
      };
      const listBgs = () => {
        try {
          return fs
            .readdirSync(bgDir)
            .map((f) => {
              const abs = path.join(bgDir, f);
              let size = 0;
              try { size = fs.statSync(abs).size; } catch (_) {}
              return { path: abs, name: f, kind: kindOf(f), size };
            })
            .filter((x) => x.kind);
        } catch (_) {
          return [];
        }
      };
      if (channel === 'bg:current') {
        const all = listBgs();
        return { ok: true, data: { item: all[0] || null, count: all.length } };
      }
      if (channel === 'bg:choose') {
        const kind = String((payload && payload.kind) || '');
        const win = BrowserWindow.fromWebContents(event.sender);
        const opts = {
          title: kind === 'video' ? '选择背景视频' : '选择背景图片',
          buttonLabel: '设为背景',
          properties: ['openFile'],
          filters:
            kind === 'video'
              ? [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogv'] }]
              : kind === 'image'
                ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }]
                : [
                    { name: '图片或视频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'mp4', 'webm', 'mov', 'm4v', 'ogv'] },
                  ],
        };
        const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        if (res.canceled || !res.filePaths || !res.filePaths.length) {
          return { ok: true, data: { canceled: true } };
        }
        const src = res.filePaths[0];
        const kind2 = kindOf(src);
        if (!kind2) return { ok: false, error: '不支持的文件类型' };
        try {
          fs.mkdirSync(bgDir, { recursive: true });
          /* 一次只保留一个背景：先清掉旧的，再把新文件复制进来 */
          for (const f of fs.readdirSync(bgDir)) {
            try { fs.unlinkSync(path.join(bgDir, f)); } catch (_) {}
          }
          const dest = path.join(bgDir, 'bg' + path.extname(src).toLowerCase());
          fs.copyFileSync(src, dest);
          let size = 0;
          try { size = fs.statSync(dest).size; } catch (_) {}
          return { ok: true, data: { canceled: false, item: { path: dest, name: path.basename(src), kind: kind2, size } } };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      }
      if (channel === 'bg:clear') {
        try {
          if (fs.existsSync(bgDir)) {
            for (const f of fs.readdirSync(bgDir)) {
              try { fs.unlinkSync(path.join(bgDir, f)); } catch (_) {}
            }
          }
          return { ok: true, data: { cleared: true } };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      }
      return { ok: false, error: '未知的背景通道：' + channel };
    }
    if (channel === 'app:paths') {
      // 软件安装目录（exe 所在目录）+ 默认游戏目录 <exe目录>\Game
      // 前端「安装路径」留空时用它作为下载落点，写入时由 fs:writeFile 自动建目录。
      try {
        const exeDir = path.dirname(app.getPath('exe'));
        return { ok: true, data: { exeDir, defaultGameDir: path.join(exeDir, 'Game') } };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }
    if (!bridge) return { ok: false, error: '后端尚未就绪' };
    return bridge.handle(channel, payload);
  });

  const forward = (event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fmbridge:event:' + event, data);
    }
  };
  detachEmitter = bridge.attachEmitter(forward);
  bridge.setProgressSink(forward);
}

// ---------------------------------------------------------------------------
// 自适应运行限制 IPC（perf:info / perf:reset / perf:launchNote）
//
// 渲染进程只读这里的结果，不做任何探测：硬件检测要读 CPU/内存/显卡，属于主进程的活。
// perf.js 是 concurrent 开发中的新模块 —— 不存在时必须返回 {ok:false,error:'性能模块尚未就绪'}，
// 而不是让 require 抛出去把 initBackend 打断（那会让整个界面连后端都用不了）。
// ---------------------------------------------------------------------------
function perfNoteFile() {
  try {
    return path.join(app.getPath('userData'), 'perf-note.json');
  } catch {
    return null;
  }
}

/** 读「首次向导已看过」之类的小标记；没有就 null。 */
function readPerfNote() {
  const f = perfNoteFile();
  if (!f) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function handlePerfChannel(channel, payload) {
  const p = payload || {};
  try {
    const perf = loadPerf();

    if (channel === 'perf:info') {
      // 降级文案要与 UI 侧对好：它不是「出错」，而是「这个版本还没有性能模块」
      if (!perf) return { ok: false, error: '性能模块尚未就绪' };
      let dir = null;
      try {
        dir = app.getPath('userData');
      } catch {
        dir = null; // 极端情况下（app 还没 ready）统计读不到，但不该让面板整个失败
      }
      const hw = typeof perf.detectHardware === 'function' ? perf.detectHardware() : null;
      const stats = dir && typeof perf.readStats === 'function' ? perf.readStats(dir) : null;
      const recommend = typeof perf.recommend === 'function' ? perf.recommend(hw, stats) : null;
      // choice：用户在设置页手动挑的档位（如 'low'/'balanced'/'high'）；null = 交给 perf 自己按硬件推导
      const resolved =
        typeof perf.resolveLimits === 'function' ? perf.resolveLimits(hw, stats, p.choice || null) : null;
      // note 是附加字段（UI 可忽略），用来回读「向导已完成」标记
      return { ok: true, hw, stats, recommend, resolved, note: readPerfNote() };
    }

    if (channel === 'perf:reset') {
      if (!perf) return { ok: false, error: '性能模块尚未就绪' };
      let dir = null;
      try {
        dir = app.getPath('userData');
      } catch {
        dir = null;
      }
      if (dir && typeof perf.resetStats === 'function') perf.resetStats(dir);
      // 清空后立刻回读一份「干净」的推荐值：UI 不用再发一次 perf:info
      const hw = typeof perf.detectHardware === 'function' ? perf.detectHardware() : null;
      const stats = dir && typeof perf.readStats === 'function' ? perf.readStats(dir) : null;
      const recommend = typeof perf.recommend === 'function' ? perf.recommend(hw, stats) : null;
      return { ok: true, stats, recommend };
    }

    // 可选通道：UI 首次向导点「知道了」时调一次，落一个小标记文件。
    // 只写 userData 下一个几十字节的 json，不改配置、不碰游戏目录。
    if (channel === 'perf:launchNote') {
      const f = perfNoteFile();
      if (!f) return { ok: false, error: '无法定位用户数据目录' };
      const note = {
        wizardDoneAt: new Date().toISOString(),
        auto: p.auto !== false,
      };
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(note), 'utf8');
      return { ok: true, data: note };
    }

    return { ok: false, error: '未知性能通道：' + channel };
  } catch (e) {
    // 任何内部异常（含 perf.js 自己抛的）都收敛成一行文案，绝不冒到渲染层
    logError('perf:' + channel, e);
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ---------------------------------------------------------------------------
// 诊断包（diag:status / diag:pack / diag:reveal / diag:clear / diag:path）
//
// 逻辑全部在 core/system/diag.js（纯 Node，可无头自测），这里只负责：
//   - 把 electron 侧的路径与能力注入进去（userData、shell 打开目录）
//   - 三处自动触发：游戏异常退出 / 主进程未捕获异常 / 界面进程崩溃
//   - 自动触发节流 + 只记日志，任何失败都不弹框、不影响退出流程
// ---------------------------------------------------------------------------
/** @type {ReturnType<typeof createDiag> | null} */
let DIAG = null;
/** 主进程异常类自动打包的节流时间戳（10 分钟一次） */
let diagAutoAt = 0;
const DIAG_AUTO_GAP = 10 * 60 * 1000;

/** 给诊断包用的运行上下文（取不到就当空值，绝不抛）。 */
function diagContext() {
  const last = GAME.lastExit || {};
  const cpus = (() => {
    try {
      return os.cpus() || [];
    } catch {
      return [];
    }
  })();
  const cfg = (() => {
    try {
      return backend && backend.config ? backend.config.runtime : null;
    } catch {
      return null;
    }
  })();
  return {
    versionId: GAME.versionId || last.versionId || '',
    javaPath: GAME.javaPath || '',
    exitCode: GAME.running ? null : last.exitCode,
    signal: GAME.running ? '' : last.signal,
    uptimeMs: GAME.running ? Date.now() - (GAME.startedAt || Date.now()) : last.uptimeMs || 0,
    // 游戏正在跑的时候，上一次的 lastError / lastLines 与本次无关，不能带进摘要
    lastError: GAME.running ? '' : last.lastError || '',
    lastLines: GAME.running ? [] : last.lastLines || [],
    os: { platform: process.platform, arch: process.arch, type: os.type(), release: os.release() },
    cpu: { model: cpus.length ? cpus[0].model : '', threads: cpus.length },
    mem: { total: os.totalmem(), free: os.freemem() },
    config: cfg,
  };
}

/** 创建诊断单例。必须在 app ready 之后调用（getPath('userData') 才可用）。 */
function initDiag() {
  try {
    const userData = app.getPath('userData');
    DIAG = createDiag({
      rootDir: path.join(userData, 'crash'),
      appVersion: app.getVersion(),
      mainErrorLog: errorLogFile(),
      // perf 统计文件名在不同版本里叫过 stats.json / perf-stats.json，两个都试
      perfFile: [path.join(userData, 'stats.json'), path.join(userData, 'perf-stats.json')],
      getGameDir: () => GAME.dir || resolveGameDir(''),
      getContext: diagContext,
      showItemInFolder: (f) => shell.showItemInFolder(f),
      openPath: (p) => shell.openPath(p),
      log: (line) => {
        try {
          if (backend && backend.log) backend.log.child('diag').warn(line);
          else console.warn(line);
        } catch {
          /* 记日志失败不能再抛 */
        }
      },
    });
  } catch (err) {
    DIAG = null;
    logError('initDiag', err);
  }
}

/**
 * 自动打包（游戏异常退出 / 主进程异常 / 界面崩溃）。
 * 契约：同一进程内 main-exception、renderer-gone 10 分钟最多 1 次；
 *       游戏异常退出每次启动最多 1 次（GAME.crashPacked 在 game:launch 重置）。
 * 一律不 await、不阻塞退出流程；失败只写 main-error.log。
 */
function autoPack(reason) {
  if (!DIAG) return;
  const now = Date.now();
  if (reason === 'main-exception' || reason === 'renderer-gone') {
    if (now - diagAutoAt < DIAG_AUTO_GAP) return;
    diagAutoAt = now;
  }
  if (reason === 'game-crash') {
    if (GAME.crashPacked) return;
    GAME.crashPacked = true;
  }
  // 让出一轮事件循环：崩溃现场往往正好卡在某个同步栈里
  const t = setTimeout(() => {
    DIAG.pack({ reason: reason, note: '', includeGameLogs: true })
      .then((data) => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('fmbridge:event:diag:ready', {
              file: data.file,
              name: data.name,
              size: data.size,
              at: data.at,
              reason: reason,
              auto: true,
            });
          }
        } catch {
          /* 窗口已销毁（正在退出）：包已经写好了，不推送也无所谓 */
        }
        try {
          if (backend && backend.log) {
            backend.log
              .child('diag')
              .info('已自动生成诊断包：' + data.name + '（' + data.size + ' 字节，原因 ' + reason + '）');
          }
        } catch {
          /* 忽略 */
        }
      })
      .catch((err) => logError('diag.pack/' + reason, err));
  }, 0);
  if (t.unref) t.unref();
}

/** 诊断通道统一入口：写法对齐 handlePerfChannel，永不把异常抛到渲染层。 */
async function handleDiagChannel(channel, payload) {
  const p = payload || {};
  try {
    if (channel === 'diag:path') {
      if (!DIAG) return { ok: false, error: '诊断模块不可用' };
      return { ok: true, data: { dir: DIAG.dir } };
    }
    if (!DIAG) return { ok: false, error: '诊断模块不可用' };

    if (channel === 'diag:status') {
      return { ok: true, data: await DIAG.status() };
    }

    if (channel === 'diag:pack') {
      const reason = String(p.reason || 'manual');
      if (['manual', 'game-crash', 'main-exception', 'renderer-gone'].indexOf(reason) < 0) {
        return { ok: false, error: '未知的打包原因：' + reason };
      }
      const data = await DIAG.pack({
        reason: reason,
        note: typeof p.note === 'string' ? p.note : '',
        includeGameLogs: p.includeGameLogs !== false,
      });
      try {
        if (backend && backend.log) backend.log.child('diag').info('手动生成诊断包：' + data.name);
      } catch {
        /* 忽略 */
      }
      return { ok: true, data };
    }

    if (channel === 'diag:reveal') {
      const data = await DIAG.reveal({ file: p.file });
      return { ok: true, data };
    }

    if (channel === 'diag:clear') {
      return { ok: true, data: await DIAG.clear() };
    }

    // 单个删除（契约外的新增通道，纯附加，不影响已有字段）：
    // 列表里的「删除」不该只能全清，否则用户想留最近一个包只能整目录清空。
    if (channel === 'diag:delete') {
      return { ok: true, data: await DIAG.remove({ file: p.file }) };
    }

    return { ok: false, error: '未知诊断通道：' + channel };
  } catch (e) {
    logError('diag:' + channel, e);
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ---------------------------------------------------------------------------
// 资源导入（材质包 / 光影 / 模组）
//
// 目录：<exe目录>\Game\resources（开发态退到 userData/Game/resources）。
// 与「安装路径」留空时的默认游戏目录同级，用户能在安装目录里直接找到。
// ---------------------------------------------------------------------------
function resRoot() {
  try {
    const base = app.isPackaged
      ? path.join(path.dirname(app.getPath('exe')), 'Game')
      : path.join(app.getPath('userData'), 'Game');
    return path.join(base, 'resources');
  } catch (e) {
    return path.join(app.getPath('userData'), 'resources');
  }
}

/** 重名不覆盖：a.zip → a (2).zip */
function uniqueResName(dir, name) {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, name.length - ext.length) : name;
  let cand = name;
  let i = 2;
  while (fs.existsSync(path.join(dir, cand)) && i < 1000) {
    cand = base + ' (' + i + ')' + ext;
    i += 1;
  }
  return cand;
}

function handleResourcesChannel(channel, payload) {
  const dir = resRoot();
  try {
    if (channel === 'resources:dir') {
      fs.mkdirSync(dir, { recursive: true });
      return { ok: true, data: { dir } };
    }

    if (channel === 'resources:list') {
      fs.mkdirSync(dir, { recursive: true });
      const items = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.charAt(0) !== '.')
        .map((d) => {
          let size = 0;
          let mtime = 0;
          try {
            const st = fs.statSync(path.join(dir, d.name));
            size = st.size;
            mtime = st.mtimeMs;
          } catch (e) {}
          return { name: d.name, size, mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);
      return { ok: true, data: { dir, items } };
    }

    if (channel === 'resources:import') {
      const paths = payload && Array.isArray(payload.paths) ? payload.paths : [];
      if (!paths.length) return { ok: false, error: '没有要导入的文件' };
      fs.mkdirSync(dir, { recursive: true });
      const added = [];
      const failed = [];
      for (const src of paths) {
        if (typeof src !== 'string' || !src) continue;
        try {
          const st = fs.statSync(src);
          if (!st.isFile()) {
            failed.push({ path: src, error: '不是文件' });
            continue;
          }
          // 已经在资源目录里（用户把目录内的文件又拖进来）：不重复复制
          if (path.resolve(path.dirname(src)) === path.resolve(dir)) {
            added.push(path.basename(src));
            continue;
          }
          const target = uniqueResName(dir, path.basename(src));
          fs.copyFileSync(src, path.join(dir, target));
          added.push(target);
        } catch (e) {
          failed.push({ path: src, error: String((e && e.message) || e) });
        }
      }
      return { ok: true, data: { dir, added, failed } };
    }

    if (channel === 'resources:remove') {
      const name = path.basename(String((payload && payload.name) || ''));
      if (!name || name === '.' || name === '..') return { ok: false, error: '缺少文件名' };
      const fp = path.join(dir, name);
      if (!fs.existsSync(fp)) return { ok: true, data: { removed: false } };
      fs.unlinkSync(fp);
      return { ok: true, data: { removed: true } };
    }

    if (channel === 'resources:reveal') {
      fs.mkdirSync(dir, { recursive: true });
      const name = payload && payload.name ? path.basename(String(payload.name)) : '';
      const fp = name ? path.join(dir, name) : '';
      if (fp && fs.existsSync(fp)) shell.showItemInFolder(fp);
      else shell.openPath(dir);
      return { ok: true, data: { ok: true } };
    }

    return { ok: false, error: '未知资源通道：' + channel };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function createWindow() {
  // 无边框窗口的控制通道（幂等注册，避免重复创建窗口时报 "second handler"）
  ipcMain.removeHandler('fmwin:control');
  ipcMain.handle('fmwin:control', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: '窗口不存在' };
    switch (action) {
      case 'minimize':
        win.minimize();
        break;
      case 'toggle-maximize':
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
        break;
      case 'close':
        win.close();
        break;
      case 'state':
        break;
      default:
        return { ok: false, error: '未知动作：' + String(action) };
    }
    return { ok: true, data: { maximized: win.isMaximized(), fullscreen: win.isFullScreen() } };
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#0b0f0d',
    autoHideMenuBar: true,
    show: false,
    title: 'X Craft Launcher',
    // 无边框：系统标题栏交给页面内的 .wbar（跟主题一致的毛玻璃标题栏）
    // thickFrame 保持默认 true，这样窗口仍可用边角拉伸、支持双击最大化
    frame: false,
    // 窗口 / 任务栏图标（打包后在 asar 内同样可读）
    icon: path.join(__dirname, 'ui', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 需要 require('electron')
      webSecurity: true,
      spellcheck: false,
    },
  });

  // 先隐藏再显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  // ---- 自定义标题栏：窗口控制（无边框后系统按钮没了，改由页面按钮驱动） ----
  const pushWinState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('fmbridge:event:fmwin:state', {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    });
  };
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) {
    mainWindow.on(ev, pushWinState);
  }
  // 页面按钮加载完成后主动推一次初始状态
  mainWindow.webContents.on('did-finish-load', pushWinState);

  // 所有 window.open / target=_blank 一律交给系统浏览器（只放行 https）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  // 渲染进程内的页面跳转同样拦截：本应用只应停留在本地文件里
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });

  // 关窗口前确认：游戏在跑时不要「一点关闭就悄悄杀掉」。
  // 背景：Minecraft 首次启动要加载资源、跑 JIT，30~60 秒内没有窗口是正常的。
  // 之前关窗口一律 kill 游戏：用户等不到窗口就关掉启动器 → 游戏被杀 →
  // 表现成「点了启动，没窗口，直接退出」。现在关窗口会先问，默认「继续等待」，
  // 也可以选「最小化启动器」把窗口收起来、游戏继续跑。
  mainWindow.on('close', (event) => {
    if (closingConfirmed || allowQuit) return;
    if (!GAME.running || !GAME.proc) return;

    const waited = Date.now() - (GAME.startedAt || 0);
    let idx = 0;
    try {
      idx = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['继续等待（不关闭）', '最小化启动器（游戏继续）', '关闭并结束游戏'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: '游戏正在运行',
        message: 'Minecraft ' + (GAME.versionId || '') + ' 正在运行',
        detail:
          waited < 120000
            ? '游戏可能还在加载：首次启动通常需要 30~60 秒，这段时间没有游戏窗口是正常的。\n\n想保留游戏请选「最小化启动器」；关闭启动器会同时结束游戏进程。'
            : '关闭启动器会同时结束游戏进程；想留着游戏请选「最小化启动器」。',
      });
    } catch {
      idx = 0;
    }

    // 两种情况都不真正关闭：继续等待 / 最小化
    event.preventDefault();
    if (idx === 1) {
      try {
        mainWindow.minimize();
      } catch (err) {
        logError('minimizeOnClose', err);
      }
      return;
    }
    if (idx === 2) {
      closingConfirmed = true;
      mainWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logError('render-process-gone', JSON.stringify(details));
    // 界面进程崩了 = 用户看到白屏/黑屏，现场只剩主进程这边能捞（10 分钟节流）
    autoPack('renderer-gone');
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, err) => {
    logError('preload-error ' + preloadPath, err);
  });
}

/** 只允许打开 https 外链。 */
function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      shell.openExternal(url).catch((err) => logError('openExternal', err));
    } else {
      console.warn('[main] 已拒绝打开非 https 链接：', url);
    }
  } catch {
    console.warn('[main] 非法 URL：', url);
  }
}

// ---------------------------------------------------------------------------
// 单实例
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // 后端初始化失败也给用户一个能看错误文案的窗口
    try {
      await initBackend();
    } catch (err) {
      logError('initBackend', err);
    }
    // 诊断包单例：必须在 whenReady 之后（此时才能取到 userData 路径）
    initDiag();
    createWindow();

    // 自动更新服务：启动后 8~12 秒静默检查一次（资源不足会被门控跳过）
    updateService.init({
      sendEvent: (name, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('fmbridge:event:' + name, data);
        }
      },
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// ---------------------------------------------------------------------------
// 退出清理：停掉本地服务端 / 红石 / Terracotta 会话，避免残留进程
// ---------------------------------------------------------------------------
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  // 从这里开始整段都是「退出流程」：之后游戏再退出（包括停服务耗时期间它自己先退）
  // 一律不算崩溃，不算用户遇到的故障，也就不能再自动生成诊断包。
  GAME.stoppedByUser = true;
  try {
    if (detachEmitter) detachEmitter();
  } catch (err) {
    logError('detachEmitter', err);
  }
  try {
    if (backend && typeof backend.stopAllServers === 'function') {
      await backend.stopAllServers();
    }
  } catch (err) {
    logError('stopAllServers', err);
  }
  // 关窗口 = 退出启动器：一并结束游戏进程，避免留下没人能再管理的孤儿 javaw。
  // （不提供「关掉启动器、游戏继续」：实测父进程退出后 java 子进程会随管道断开一起终止，
  //  想保留游戏请在关闭确认框里选「最小化启动器」。）
  try {
    if (GAME.proc && typeof GAME.proc.kill === 'function') {
      // stoppedByUser 已在函数开头置位：这是清理，不是崩溃
      GAME.proc.kill();
    }
  } catch (err) {
    logError('killGame', err);
  }
  try {
    if (bridge && typeof bridge.dispose === 'function') {
      await bridge.dispose();
    }
  } catch (err) {
    logError('bridge.dispose', err);
  }
  // 取消进行中的更新下载（临时文件由 update-service 自行清理）
  try {
    updateService.dispose();
  } catch (err) {
    logError('updateService.dispose', err);
  }
  try {
    ipcMain.removeHandler('fmbridge:invoke');
  } catch {
    /* 忽略 */
  }
}

app.on('before-quit', (event) => {
  if (allowQuit) return;
  event.preventDefault();
  cleanup()
    .catch((err) => logError('cleanup', err))
    .finally(() => {
      allowQuit = true;
      app.quit();
    });
});

// ---------------------------------------------------------------------------
// 自动更新的退出通道
// ---------------------------------------------------------------------------
// update-service 在把替换脚本拉起来之后会 emit 这个事件。
// 它不能走 before-quit：那条路要等 cleanup() 里的异步收尾（停联机服务、
// dispose bridge），任何一步卡住进程就退不掉 —— exe / dll 一直被占用，
// 更新脚本等再久也覆盖不了文件，表现就是「点了更新并重启却没重启，
// 手动再打开还是旧版本」。所以这条路只做「必须做且一定做得完」的事：
// 结束游戏子进程（它可能占着 java 运行时文件），然后让 app.exit(0) 直接退出。
app.on('xcl-update-exit', () => {
  allowQuit = true;
  try {
    if (GAME.proc && typeof GAME.proc.kill === 'function') {
      GAME.stoppedByUser = true;
      GAME.proc.kill();
    }
  } catch (err) {
    logError('update-exit killGame', err);
  }
});

// Windows / Linux：关掉最后一个窗口就退出；macOS 保留常驻习惯
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
