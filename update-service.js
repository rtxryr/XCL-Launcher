'use strict';
/**
 * X Craft Launcher 更新服务（主进程侧，CommonJS）。
 *
 * 职责：检查更新 / 下载 / 校验 / 替换并重启，全部走 IPC 通道，不监听任何端口。
 * 对外只暴露三个函数：
 *   init({ sendEvent })      初始化（载入已忽略列表、清理残留临时文件、排定自动检查）
 *   handle(channel,payload)  处理 update:* 与 app:info 通道，统一返回 { ok, data?, error? }
 *   dispose()                退出时取消下载、清掉定时器
 *
 * 设计要点：
 *   - 网络全部走 Node 原生 http/https，失败一律转成中文人话，绝不抛出未捕获异常；
 *   - 客户端不直接覆盖运行中的 exe：写一个临时 PowerShell 脚本，等主进程退出后再解压覆盖；
 *   - 只解压 zip 内存在的文件，绝不清空安装目录（Game 存档、用户数据不受影响）。
 *
 * 取消语义（2026-11-05 定稿，改前先看这段）：
 *   - update:cancel 在「已有 latestVersion + sha256」时落 available（不是 idle），
 *     只清 progress，保留版本信息，这样前端 available 分支可以直接「立即更新」重来；
 *   - 落 idle 会导致前端显示「已是最新版本」，与「其实有更新」矛盾。
 *
 * 替换策略（勿轻易改回「直接解压到安装目录」）：
 *   - 发布 zip 是单顶层目录 `X Craft Launcher/...`，解压前必须剥掉这一层，
 *     否则文件会铺到 <安装目录>\X Craft Launcher\ 下，等于没更新；
 *   - 但 bsdtar 用 `--strip-components 1 -C <安装目录>` 直接解到已有同名 exe 的目录时，
 *     会额外写一个无扩展名的副本（bsdtar 已知怪癖），因此改为「先解到临时暂存目录，
 *     再用 robocopy /E 覆盖合并」（robocopy 只覆盖同名文件，不删除目标里其它内容）；
 *   - 暂存目录下钻一层的判定必须是「只有一个条目、且该条目是目录」
 *     （$items.Count -eq 1 -and $items[0].PSIsContainer）。
 *     曾经写成「只有一个子目录」，剥层后 stage 里还有 resources 等子目录，
 *     于是把 resources/* 摊到安装根、exe 反而没被替换（更新"假装成功"）——已修复并有
 *     scripts/test-update.cjs 的 nested 用例守着。
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
/** 安装程序式更新（下载 Setup.exe → 显示进度 → 静默安装 → 自动重启） */
const installer = require('./update-installer.js');

// ---------------------------------------------------------------------------
// 常量与小工具
// ---------------------------------------------------------------------------
const APP_SLUG = 'xcraft-launcher';
const DEFAULT_FEED = 'https://rj-app-download.app.workbuddy.host';
const DEFAULT_INSTALL_KEY = 'XCL-4XX2-2026-INSTALL';
/** 网关要求所有请求都带 sharecode，否则直接 4xx。 */
const SHARECODE = '4XX2XCSHDN';

/** 更新包解压后重新启动的可执行文件名（相对安装目录）。 */
const RELAUNCH_EXE = 'X Craft Launcher.exe';

const CONNECT_TIMEOUT = 15000; // 单次请求 15 秒无响应即失败
const TOTAL_TIMEOUT = 10 * 60 * 1000; // 整包下载上限 10 分钟
const PROGRESS_INTERVAL = 400; // 进度事件最小间隔（毫秒）
const MAX_JSON_BYTES = 1024 * 1024;

/** 允许用环境变量覆盖阈值（仅用于自测/排障，正常运行时不会设置）。 */
function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const MIN_FREE_MEM = envNum('XCL_UPDATE_MIN_MEM_MB', 1536) * 1024 * 1024; // 1.5GB
const MIN_FREE_DISK = envNum('XCL_UPDATE_MIN_DISK_MB', 600) * 1024 * 1024; // 600MB

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024 * 1024) return (v / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (v >= 1024 * 1024) return Math.round(v / 1024 / 1024) + ' MB';
  if (v >= 1024) return Math.round(v / 1024) + ' KB';
  return Math.round(v) + ' B';
}

function msgOf(e) {
  return String((e && e.message) || e || '未知错误');
}

/** 把底层网络错误码翻成中文，避免把 ENOTFOUND 这类词直接甩给用户。 */
function friendlyNetError(e) {
  const code = e && e.code;
  const map = {
    ENOTFOUND: '无法解析更新服务器域名（请检查网络或 DNS）',
    EAI_AGAIN: 'DNS 解析超时，请稍后重试',
    ECONNREFUSED: '更新服务器拒绝连接（连接被拒绝）',
    ECONNRESET: '更新服务器连接被重置',
    ETIMEDOUT: '连接更新服务器超时（15 秒无响应）',
    EHOSTUNREACH: '无法连接到更新服务器（网络不可达）',
    CERT_HAS_EXPIRED: '更新服务器证书已过期',
  };
  if (map[code]) return new Error(map[code]);
  if (e && e.message && /timeout/i.test(e.message)) return new Error('连接更新服务器超时（15 秒无响应）');
  return new Error('网络请求失败：' + msgOf(e));
}

/** 版本号比较：按数字段比较，返回 -1 / 0 / 1。 */
function cmpVersion(a, b) {
  const pa = String(a || '0').split(/[.\-+_]/);
  const pb = String(b || '0').split(/[.\-+_]/);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = parseInt(pa[i], 10);
    const y = parseInt(pb[i], 10);
    if (!Number.isFinite(x) && !Number.isFinite(y)) continue;
    const nx = Number.isFinite(x) ? x : 0;
    const ny = Number.isFinite(y) ? y : 0;
    if (nx > ny) return 1;
    if (nx < ny) return -1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 运行态
// ---------------------------------------------------------------------------
/** @type {UpdateState} */
let state = {
  state: 'idle',
  currentVersion: '',
  latestVersion: null,
  checkedAt: null,
  /** 同版本安装程序信息 { version, size, sha256 }；拿不到时退回旧的 zip 覆盖流程 */
  installer: null,
};
/** 事件发送器（main.js 注入，内部已判空窗口） */
let sendEvent = null;
/** 正在下载的任务（用于取消） */
let download = null;
/** 检查/下载/校验期间为 true，避免重复进入 */
let busy = false;
/** 是否正在检查更新（与 busy 分开：检查期间还应允许 cancel） */
let checking = false;
/** 检查轮次：取消检查后自增，用来丢弃迟到的响应 */
let checkEpoch = 0;
/** 下载轮次：取消后自增，防止上一轮的 finally 清掉新一轮的状态 */
let runId = 0;
/** 已忽略的版本：{ version: 时间戳 } */
let dismissed = Object.create(null);
/** 自动检查定时器 */
let autoTimer = null;

/** UpdateState 快照（深拷贝，防止调用方改动内部状态）。 */
function snapshot() {
  try {
    return JSON.parse(JSON.stringify(state));
  } catch {
    return Object.assign({}, state);
  }
}

/** 合并状态、推送事件、返回快照。 */
function push(patch) {
  state = Object.assign({}, state, patch || {});
  const snap = snapshot();
  try {
    if (typeof sendEvent === 'function') sendEvent('update:status', snap);
  } catch {
    /* 事件推送失败不能影响主流程 */
  }
  return snap;
}

function installDir() {
  // 自测时用 XCL_INSTALL_DIR 指向临时目录，避免误触真实安装目录
  if (process.env.XCL_INSTALL_DIR) return path.resolve(process.env.XCL_INSTALL_DIR);
  try {
    return path.dirname(app.getPath('exe'));
  } catch {
    return process.cwd();
  }
}

function tempDir() {
  try {
    return path.join(app.getPath('temp'), 'xcl-update');
  } catch {
    return path.join(os.tmpdir(), 'xcl-update');
  }
}

function configFile() {
  return path.join(os.homedir(), '.fusionmc', 'config.json');
}

function prefsFile() {
  // 忽略列表独立成文件，不写进用户配置，避免污染 / 覆盖用户设置
  return path.join(os.homedir(), '.fusionmc', 'update-state.json');
}

/** 读用户配置：文件不存在/损坏都当作空对象，不报错。 */
function readConfig() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(configFile(), 'utf8')) || {};
  } catch {
    raw = {};
  }
  const nested = raw.update && typeof raw.update === 'object' ? raw.update : {};
  const feed = String(process.env.XCL_UPDATE_FEED || raw.updateFeed || nested.feed || DEFAULT_FEED);
  const installKey = String(
    process.env.XCL_INSTALL_KEY || raw.installKey || nested.installKey || DEFAULT_INSTALL_KEY,
  );
  return { feed: feed.replace(/\/+$/, ''), installKey };
}

function loadDismissed() {
  try {
    const j = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    if (j && j.dismissed && typeof j.dismissed === 'object') dismissed = j.dismissed;
  } catch {
    dismissed = Object.create(null);
  }
}

function saveDismissed() {
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify({ dismissed: dismissed }, null, 2), 'utf8');
  } catch {
    /* 写不进去只影响「下次不再提示」，不影响主流程 */
  }
}

/** 拼接口地址：统一带上网关要求的 sharecode。 */
function buildUrl(pathname, params) {
  const { feed } = readConfig();
  let u;
  try {
    u = new URL(feed + pathname);
  } catch {
    throw new Error('更新源地址不合法：' + feed);
  }
  u.searchParams.set('sharecode', SHARECODE);
  const extra = params || {};
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

// ---------------------------------------------------------------------------
// HTTP 基础请求
// ---------------------------------------------------------------------------
/**
 * 发起请求并拿到响应流（自动跟随最多 5 次重定向）。
 * 结果：{ req, res, code }
 */
function openResponse(urlStr, opts, redirects) {
  const o = opts || {};
  const depth = redirects || 0;
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      reject(new Error('更新地址不合法：' + urlStr));
      return;
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: o.method || 'GET',
      headers: Object.assign(
        { 'User-Agent': 'XCL-Updater/1.0', Accept: '*/*' },
        o.headers || {},
      ),
    });

    const timeoutMs = o.timeoutMs || CONNECT_TIMEOUT;
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('连接更新服务器超时（' + Math.round(timeoutMs / 1000) + ' 秒无响应）'));
    });
    req.on('error', (e) => reject(friendlyNetError(e)));
    req.on('response', (res) => {
      const code = res.statusCode || 0;
      const loc = res.headers.location;
      if ([301, 302, 303, 307, 308].indexOf(code) >= 0 && loc && depth < 5) {
        res.resume();
        openResponse(new URL(loc, u).toString(), o, depth + 1).then(resolve, reject);
        return;
      }
      resolve({ req: req, res: res, code: code });
    });
    if (o.body) req.write(o.body);
    req.end();
  });
}

function readAll(res, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        try {
          res.destroy();
        } catch {
          /* 忽略 */
        }
        reject(new Error('更新服务器返回的数据过大，已中止'));
        return;
      }
      chunks.push(c);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('aborted', () => reject(new Error('更新服务器连接中断')));
    res.on('error', (e) => reject(friendlyNetError(e)));
  });
}

/** 取 JSON：状态码与解析失败都给中文提示。 */
async function getJson(url, opts) {
  const r = await openResponse(url, opts);
  if (r.code === 401 || r.code === 403) {
    r.res.resume();
    throw new Error('安装密钥无效或已被拒绝（HTTP ' + r.code + '）');
  }
  if (r.code !== 200) {
    r.res.resume();
    throw new Error('更新服务器返回异常状态（HTTP ' + r.code + '）');
  }
  const text = await readAll(r.res, MAX_JSON_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('更新服务器返回的数据不是合法 JSON');
  }
}

/** 用安装密钥换下载令牌。 */
async function fetchToken() {
  const { installKey } = readConfig();
  const body = JSON.stringify({ app: APP_SLUG, key: installKey });
  const j = await getJson(buildUrl('/api/v1/app/verify-key'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body: body,
  });
  if (!j || j.ok !== true || !j.token) {
    throw new Error((j && (j.error || j.message)) || '安装密钥校验失败');
  }
  return String(j.token);
}

// ---------------------------------------------------------------------------
// 下载（边下边写 + 限流进度 + 可取消）
// ---------------------------------------------------------------------------
function startDownload(url, destFile, expectedTotal) {
  const job = {
    canceled: false,
    req: null,
    res: null,
    ws: null,
    file: destFile,
    bytes: 0,
    total: Number(expectedTotal) || 0,
    samples: [],
    lastEmit: 0,
  };

  job.promise = new Promise((resolve, reject) => {
    let settled = false;
    const overall = setTimeout(() => {
      if (settled) return;
      try {
        if (job.req) job.req.destroy(new Error('下载超时（超过 10 分钟），请稍后重试'));
      } catch {
        /* 忽略 */
      }
    }, TOTAL_TIMEOUT);
    if (overall.unref) overall.unref();

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      if (err) reject(err);
      else resolve(val);
    };

    openResponse(url, { timeoutMs: CONNECT_TIMEOUT })
      .then((r) => {
        job.req = r.req;
        job.res = r.res;
        if (settled) {
          try {
            r.res.destroy();
          } catch {
            /* 忽略 */
          }
          return;
        }
        if (r.code !== 200) {
          r.res.resume();
          if (r.code === 401 || r.code === 403) {
            return finish(new Error('下载被拒绝：安装密钥无效或已过期（HTTP ' + r.code + '）'));
          }
          if (r.code === 404) return finish(new Error('更新包不存在（HTTP 404），请联系发布者'));
          return finish(new Error('更新包下载失败（HTTP ' + r.code + '）'));
        }

        const len = Number(r.res.headers['content-length']);
        if (len > 0) job.total = len;

        job.ws = fs.createWriteStream(destFile);
        job.ws.on('error', (e) => finish(new Error('写入临时文件失败：' + msgOf(e))));
        r.res.on('data', (chunk) => {
          job.bytes += chunk.length;
          emitProgress(job, false);
        });
        r.res.on('aborted', () => finish(new Error(job.canceled ? '已取消下载' : '下载连接中断，请重试')));
        r.res.on('error', (e) =>
          finish(job.canceled ? new Error('已取消下载') : friendlyNetError(e)),
        );
        r.res.pipe(job.ws);

        job.ws.on('finish', () => {
          if (job.canceled) return finish(new Error('已取消下载'));
          if (job.total > 0 && job.bytes !== job.total) {
            return finish(
              new Error('下载不完整（' + fmtBytes(job.bytes) + ' / ' + fmtBytes(job.total) + '），请重试'),
            );
          }
          emitProgress(job, true);
          finish(null, { bytes: job.bytes, total: job.total });
        });
      })
      .catch((e) => finish(job.canceled ? new Error('已取消下载') : e));
  });

  return job;
}

/** 进度节流：400ms 一次，速度用最近几个采样点的滑动平均。 */
function emitProgress(job, force) {
  const now = Date.now();
  if (!force && now - job.lastEmit < PROGRESS_INTERVAL) return;
  job.lastEmit = now;

  job.samples.push({ t: now, b: job.bytes });
  if (job.samples.length > 6) job.samples.shift();
  const first = job.samples[0];
  const dt = (now - first.t) / 1000;
  const speed = dt > 0.2 ? Math.max(0, Math.round((job.bytes - first.b) / dt)) : 0;

  const total = job.total || 0;
  const percent = total > 0 ? Math.min(100, Math.round((job.bytes / total) * 1000) / 10) : 0;
  push({
    state: 'downloading',
    message: '正在下载更新包…',
    progress: { received: job.bytes, total: total, percent: percent, speed: speed },
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('error', (e) => reject(new Error('读取更新包失败：' + msgOf(e))));
    rs.on('data', (c) => h.update(c));
    rs.on('end', () => resolve(h.digest('hex')));
  });
}

// ---------------------------------------------------------------------------
// 资源门控（用户要求：资源充足才做后台更新检查）
// ---------------------------------------------------------------------------
function resourceGate() {
  const free = os.freemem();
  if (free < MIN_FREE_MEM) {
    return {
      ok: false,
      reason: '可用内存不足（' + fmtBytes(free) + ' < ' + fmtBytes(MIN_FREE_MEM) + '），已跳过本次更新检查',
    };
  }
  // statfsSync 在部分平台/旧内核不可用，失败就跳过磁盘判断，不阻断更新
  const targets = [installDir(), tempDir()];
  for (const p of targets) {
    try {
      const st = fs.statfsSync(p);
      const avail = Number(st.bavail) * Number(st.bsize);
      if (Number.isFinite(avail) && avail > 0 && avail < MIN_FREE_DISK) {
        return {
          ok: false,
          reason:
            '磁盘剩余空间不足（' + fmtBytes(avail) + ' < ' + fmtBytes(MIN_FREE_DISK) + '），已跳过本次更新检查',
        };
      }
    } catch {
      /* 跳过磁盘判断 */
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 检查更新
// ---------------------------------------------------------------------------
async function check(opts) {
  const force = !!(opts && opts.force);
  if (busy || checking) return snapshot();

  if (!force) {
    const gate = resourceGate();
    if (!gate.ok) {
      return push({
        state: 'skipped',
        message: gate.reason,
        progress: null,
        checkedAt: Date.now(),
      });
    }
  }

  checking = true;
  const epoch = ++checkEpoch;
  push({ state: 'checking', message: '正在检查更新…', progress: null });

  try {
    const currentVersion = app.getVersion();
    const url = buildUrl('/api/v1/app/update', { app: APP_SLUG, current: currentVersion });
    const j = await getJson(url, { timeoutMs: 20000 });
    // 期间用户点了取消：丢弃这份迟到的结果
    if (epoch !== checkEpoch) return snapshot();
    if (!j || j.ok !== true) {
      throw new Error((j && (j.error || j.message)) || '更新服务器返回异常');
    }

    const latest = j.latest || null;
    const latestVersion = latest && latest.version ? String(latest.version) : null;
    const hasUpdate =
      !!j.hasUpdate && !!latestVersion && cmpVersion(latestVersion, currentVersion) > 0;

    if (!hasUpdate) {
      return push({
        state: 'idle',
        currentVersion: currentVersion,
        latestVersion: null,
        notes: null,
        size: null,
        sha256: null,
        message: '当前已是最新版本（' + currentVersion + '）',
        checkedAt: Date.now(),
      });
    }

    // 顺带查一下「同版本的安装程序」：新链路是下载官方安装包，由它完成替换
    let setupInfo = null;
    try {
      const su = buildUrl('/api/v1/app/update', { app: installer.SETUP_SLUG, current: '0.0.0' });
      const sj = await getJson(su, { timeoutMs: 12000 });
      if (epoch !== checkEpoch) return snapshot();
      const sl = (sj && sj.ok && sj.latest) || null;
      /* 只有版本号与主包一致才采用，避免安装包滞后时把用户降级 */
      if (sl && String(sl.version || '') === latestVersion && String(sl.sha256 || '')) {
        setupInfo = {
          version: String(sl.version),
          size: Number(sl.size) || 0,
          sha256: String(sl.sha256),
        };
      }
    } catch {
      /* 拿不到安装程序信息就退回旧的 zip 覆盖流程，不阻断更新 */
    }

    const base = {
      currentVersion: currentVersion,
      latestVersion: latestVersion,
      installer: setupInfo,
      notes: String(latest.notes || ''),
      size: Number(latest.size) || 0,
      sha256: String(latest.sha256 || ''),
      progress: null,
      checkedAt: Date.now(),
    };

    // 用户点过「忽略此版本」：非强制检查不再打扰
    if (!force && dismissed[latestVersion]) {
      return push(
        Object.assign({}, base, {
          state: 'dismissed',
          message: '版本 ' + latestVersion + ' 已被忽略',
        }),
      );
    }

    return push(
      Object.assign({}, base, {
        state: 'available',
        message: '发现新版本 ' + latestVersion + '（当前 ' + currentVersion + '）',
      }),
    );
  } catch (e) {
    return push({
      state: 'error',
      message: '检查更新失败：' + msgOf(e),
      progress: null,
      checkedAt: Date.now(),
    });
  } finally {
    checking = false;
  }
}

// ---------------------------------------------------------------------------
// 应用更新：下载 → 校验 → 写脚本 → 重启
// ---------------------------------------------------------------------------
function apply() {
  if (busy) return snapshot();

  const version = state.latestVersion;
  if (!version || !state.sha256) {
    // 检查阶段就失败的情况：保留原始错误原因，不要用通用文案覆盖掉
    if (state.state === 'error') return snapshot();
    return push({ state: 'idle', message: '当前没有可用的更新，请先检查更新', progress: null });
  }

  busy = true;
  const myRun = ++runId;

  /* 有同版本安装程序就走「安装包」链路：下载 Setup.exe，交给更新器静默安装。
     拿不到安装程序信息时退回旧的「下载 zip → 解压覆盖」链路，功能不缺失。 */
  const useInstaller = !!(
    state.installer &&
    state.installer.version === version &&
    state.installer.sha256
  );

  const st = push({
    state: 'downloading',
    message: useInstaller ? '正在下载安装程序…' : '正在下载更新包…',
    progress: {
      received: 0,
      total: (useInstaller ? state.installer.size : state.size) || 0,
      percent: 0,
      speed: 0,
    },
  });

  (useInstaller ? runInstallerUpdate(version) : runApply(version))
    .catch((e) => {
      if (download && download.canceled) return; // 取消由 cancel() 负责收尾
      if (runId !== myRun) return; // 已被取消后重新开始的新一轮接管
      push({ state: 'error', message: '更新失败：' + msgOf(e), progress: null });
    })
    .finally(() => {
      // 只有自己还是当前轮次时才清理，避免把「取消后立刻重开」的新一轮状态关掉
      if (runId === myRun) {
        busy = false;
        download = null;
      }
    });

  return st;
}

/* ---------------------------------------------------------------------------
 * 安装程序式更新：下载 Setup.exe → 校验 → 拉起更新器（只显示百分比）→ 主进程退出
 * 更新器是一个独立的 PowerShell 窗口，不占用安装目录的任何文件，
 * 所以主进程可以放心退出；由它等进程消失、跑静默安装、最后把新版本拉起来。
 * --------------------------------------------------------------------------- */
async function runInstallerUpdate(version) {
  const info = state.installer || {};
  const dir = tempDir();
  fs.mkdirSync(dir, { recursive: true });
  const setupFile = path.join(dir, 'XCL-Setup-' + version + '.exe');

  // 1) 换令牌 + 下载安装程序（支持断点续传，与主包同一个下载器）
  const token = await fetchToken();
  const url = buildUrl('/api/v1/app/package', { app: installer.SETUP_SLUG, token });
  const job = startDownload(url, setupFile, info.size || 0);
  download = job;

  let result;
  try {
    result = await job.promise;
  } catch (e) {
    if (job.canceled) return;
    throw e;
  }
  if (job.canceled) return;
  download = null;

  // 2) 校验
  push({
    state: 'verifying',
    message: '正在校验安装程序…',
    progress: { received: result.bytes, total: result.total, percent: 100, speed: 0 },
  });

  const expected = String(info.sha256 || '').trim().toLowerCase();
  if (!expected) {
    try {
      fs.unlinkSync(setupFile);
    } catch {
      /* 忽略 */
    }
    throw new Error('安装程序信息不完整，已中止更新');
  }
  const actual = await sha256File(setupFile);
  if (actual !== expected) {
    try {
      fs.unlinkSync(setupFile);
    } catch {
      /* 忽略 */
    }
    throw new Error('安装程序校验失败（SHA-256 不一致），已删除损坏文件，请重试');
  }

  // 3) 拉起更新器，然后自己退出（更新器会等本进程 PID 消失再开始安装）
  push({
    state: 'ready',
    message: '正在关闭启动器并完成安装…',
    progress: { received: result.bytes, total: result.total, percent: 100, speed: 0 },
  });

  const launched = installer.launchUpdater({
    setup: setupFile,
    dest: installDir(),
    exeName: RELAUNCH_EXE,
    appPid: process.pid,
    version,
  });
  if (!launched.ok) {
    throw new Error('无法启动更新程序：' + launched.error);
  }

  try {
    app.emit('xcl-update-exit');
  } catch {
    /* 忽略 */
  }
  setTimeout(() => {
    try {
      app.exit(0);
    } catch {
      /* 忽略 */
    }
  }, 900);
}

async function runApply(version) {
  const dir = tempDir();
  fs.mkdirSync(dir, { recursive: true });
  const zipFile = path.join(dir, version + '.zip');

  // 1) 换令牌
  const token = await fetchToken();

  // 2) 下载
  const url = buildUrl('/api/v1/app/package', { app: APP_SLUG, token: token });
  const job = startDownload(url, zipFile, state.size || 0);
  download = job;

  let result;
  try {
    result = await job.promise;
  } catch (e) {
    // 用户主动取消：cancel() 已经把状态推成 idle，这里不能再改成 error
    if (job.canceled) return;
    throw e;
  }
  if (job.canceled) return;
  download = null;

  // 3) 校验
  push({
    state: 'verifying',
    message: '正在校验更新包完整性…',
    progress: { received: result.bytes, total: result.total, percent: 100, speed: 0 },
  });

  const expected = String(state.sha256 || '').trim().toLowerCase();
  if (!expected) {
    try {
      fs.unlinkSync(zipFile);
    } catch {
      /* 忽略 */
    }
    throw new Error('更新信息里缺少 SHA-256 校验值，为安全起见已中止更新');
  }
  const actual = await sha256File(zipFile);
  if (actual !== expected) {
    try {
      fs.unlinkSync(zipFile);
    } catch {
      /* 忽略 */
    }
    throw new Error('更新包校验失败（SHA-256 不一致），已删除损坏文件，请重新下载');
  }

  // 4) 生成替换脚本并执行
  const testMode = process.env.XCL_UPDATE_TEST_MODE === '1';
  const strip = detectStrip(zipFile);
  const scriptFile = path.join(dir, version + '-apply.ps1');
  fs.writeFileSync(
    scriptFile,
    '\ufeff' +
      buildApplyScript({
        pid: testMode ? 0 : process.pid,
        zip: zipFile,
        dest: installDir(),
        strip,
        version: version,
        relaunch: !testMode,
      }),
    'utf8',
  );

  if (testMode) {
    // 自测模式：同步执行脚本、不重启，方便断言解压结果
    const code = await launchScript(scriptFile, true);
    if (code !== 0) throw new Error('更新脚本执行失败（退出码 ' + code + '）');
    return push({
      state: 'ready',
      message: '更新包已解压覆盖到安装目录（测试模式，未重启应用）',
      progress: { received: result.bytes, total: result.total, percent: 100, speed: 0 },
    });
  }

  push({
    state: 'ready',
    message: '更新包已就绪，正在关闭并重启完成安装…',
    progress: { received: result.bytes, total: result.total, percent: 100, speed: 0 },
  });

  await launchScript(scriptFile, false);

  // 退出方式很关键：
  //   app.quit() 会先走 before-quit 的异步 cleanup（停联机服务、dispose bridge），
  //   只要其中任何一步卡住，进程就一直活着 —— exe / dll 被占用，更新脚本等满 90 秒
  //   也替换不了文件，于是「点了更新并重启却没重启，手动启动还是旧版」。
  //   这里改成：先给主进程发一个快速收尾信号（结束游戏子进程），再用 app.exit(0) 立即退出，
  //   解锁文件交给更新脚本处理。
  try {
    app.emit('xcl-update-exit');
  } catch {
    /* 忽略 */
  }
  setTimeout(() => {
    try {
      app.exit(0);
    } catch {
      /* 忽略 */
    }
  }, 800);
}

/** PowerShell 单引号字符串转义。 */
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/**
 * 判断更新包里是否有「统一的顶层文件夹」（例如我们的 zip 是 `X Craft Launcher/...`）。
 * 有的话解压时要剥掉这一层，否则会把文件铺到安装目录下的同名子目录里，等于没更新。
 * @returns {number} 需要剥掉的层数（0 或 1）
 */
function detectStrip(zipFile) {
  try {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const r = spawnSync(tar, ['-tf', zipFile], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0 || !r.stdout) return 0;
    const names = r.stdout.split(/\r?\n/).filter(Boolean);
    if (!names.length) return 0;
    const top = names[0].split('/')[0];
    if (!top) return 0;
    const prefix = top + '/';
    // 所有条目都以同一个顶层名开头，且存在真正的子项 → 剥一层
    const uniform = names.every((n) => n === top || n === top + '/' || n.startsWith(prefix));
    const hasChild = names.some((n) => n.startsWith(prefix) && n.length > prefix.length);
    return uniform && hasChild ? 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * 生成替换脚本：
 *   等主进程 PID 退出 → 系统 tar.exe 解压（失败回退 Expand-Archive -Force）
 *   → 删临时 zip → 重新启动 exe。
 * 解压只做「覆盖同名文件」，不删除安装目录中的其它内容（Game 存档等）。
 */
function buildApplyScript(o) {
  const lines = [
    '# X Craft Launcher 自动更新脚本（由启动器生成，执行完自行结束）',
    '# 只覆盖 zip 中存在的文件，不清空安装目录，不触碰 Game / 用户数据',
    '# 全过程写日志到 %TEMP%\\xcl-update.log；失败时在安装目录留 .update-failed.txt 供下次启动提示',
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$appPid = ' + (Number(o.pid) || 0),
    '$zip = ' + psQuote(o.zip),
    '$dst = ' + psQuote(o.dest),
    '$exeName = ' + psQuote(RELAUNCH_EXE),
    '$wantVer = ' + psQuote(String(o.version || '')),
    '$strip = ' + (Number(o.strip) || 0),
    "$log = Join-Path $env:TEMP 'xcl-update.log'",
    '',
    'function Log($m) {',
    "  ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m) | Out-File -FilePath $log -Append -Encoding utf8",
    '}',
    'Log ("===== 开始更新 目标版本=" + $wantVer + " PID=" + $appPid + " =====")',
    '',
    '# 1) 等启动器退出（最多 90 秒）。只有进程真的没了，exe / dll 才会解锁',
    'if ($appPid -gt 0) {',
    '  for ($i = 0; $i -lt 180; $i++) {',
    '    if (-not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) { break }',
    '    Start-Sleep -Milliseconds 500',
    '  }',
    '}',
    '# 兜底：同名残留实例一并结束，避免「窗口关了但进程还在」导致文件一直占用',
    '$pname = [IO.Path]::GetFileNameWithoutExtension($exeName)',
    'Get-Process -Name $pname -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue',
    'Start-Sleep -Milliseconds 800',
    'Log "启动器进程已结束，开始替换文件"',
    '',
    '# 2) 解压到暂存目录（不要直接解到安装目录：bsdtar 带 strip 解到已有同名文件处会多写无扩展名副本）',
    '$stage = Join-Path $env:TEMP ("xcl-upd-stage-" + [guid]::NewGuid().ToString("N"))',
    'New-Item -ItemType Directory -Path $stage -Force | Out-Null',
    '$ok = $false',
    '$tar = Join-Path $env:SystemRoot "System32\\tar.exe"',
    'if (Test-Path $tar) {',
    '  if ($strip -gt 0) { & $tar -xf $zip -C $stage --strip-components $strip 2>$null } else { & $tar -xf $zip -C $stage 2>$null }',
    '  if ($LASTEXITCODE -eq 0) { $ok = $true }',
    '}',
    'if (-not $ok) {',
    '  try { Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force -ErrorAction Stop; $ok = $true } catch { Log ("解压失败：" + $_.Exception.Message) }',
    '}',
    '',
    '# 3) 覆盖合并。被杀软/浏览器壳短暂占用的文件会让 robocopy 失败，这里重试到成功为止',
    'if ($ok) {',
    '  $src = $stage',
    '  # 仅在「暂存目录里只有一个条目、且是目录」时下钻一层；',
    '  # 不能只看目录数量：tar 已剥过顶层时 stage 里还有 resources 等子目录，按数量下钻会把 resources/* 摊到安装根',
    '  if ($strip -gt 0) {',
    '    $items = @(Get-ChildItem -LiteralPath $stage)',
    '    if ($items.Count -eq 1 -and $items[0].PSIsContainer) { $src = $items[0].FullName }',
    '  }',
    '  $rc = Join-Path $env:SystemRoot "System32\\robocopy.exe"',
    '  $copied = $false',
    '  for ($try = 1; $try -le 15; $try++) {',
    '    if (Test-Path $rc) {',
    '      & $rc $src $dst /E /IS /IT /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null',
    '      if ($LASTEXITCODE -lt 8) { $copied = $true }',
    '    } else {',
    '      try { Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force -ErrorAction Stop; $copied = $true } catch { }',
    '    }',
    '    if ($copied) { Log ("第 " + $try + " 次复制成功"); break }',
    '    Log ("第 " + $try + " 次复制失败，1 秒后重试")',
    '    Start-Sleep -Seconds 1',
    '  }',
    '  $ok = $copied',
    '  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue',
    '}',
    '',
    '# 4) 版本校验：exe 的 ProductVersion 必须等于目标版本，否则说明没真正替换',
    'if ($ok -and $wantVer -ne "") {',
    '  $exePath = Join-Path $dst $exeName',
    '  if (Test-Path $exePath) {',
    '    $have = (Get-Item $exePath).VersionInfo.ProductVersion',
    '    Log ("版本校验 期望=" + $wantVer + " 实际=" + $have)',
    '    # 用前缀比对：ProductVersion 偶尔带 .0 之类的尾缀，严格相等会误报失败',
    '    if (-not $have -or ($have.Trim() -notlike ($wantVer + "*"))) { $ok = $false }',
    '  } else { $ok = $false }',
    '}',
    '',
    'if ($ok) {',
    "  Remove-Item -LiteralPath (Join-Path $dst '.update-failed.txt') -Force -ErrorAction SilentlyContinue",
    "  Log '更新成功'",
    '} else {',
    "  ('更新未能完成（' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + '）：文件替换失败或版本校验未通过，详见 %TEMP%\\xcl-update.log') | Out-File -FilePath (Join-Path $dst '.update-failed.txt') -Encoding utf8",
    "  Log '更新失败，已写标记文件'",
    '}',
    '',
    '# 5) 成功才删压缩包；失败保留，便于重试与排查',
    'if ($ok) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }',
  ];

  if (o.relaunch) {
    lines.push(
      '',
      '# 6) 重新启动启动器',
      'Start-Sleep -Milliseconds 300',
      '$exe = Join-Path $dst $exeName',
      'if (Test-Path $exe) {',
      '  Start-Process -FilePath $exe -WorkingDirectory $dst',
      '  Log "已重新启动启动器"',
      '} else { Log ("找不到可执行文件：" + $exe) }',
    );
  }

  return lines.join('\r\n') + '\r\n';
}

/** 启动更新脚本；wait=true 时等它结束并返回退出码（自测用）。 */
function launchScript(scriptFile, wait) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptFile],
        { detached: !wait, stdio: 'ignore', windowsHide: true },
      );
    } catch (e) {
      reject(new Error('无法启动更新脚本：' + msgOf(e)));
      return;
    }
    child.on('error', (e) => reject(new Error('无法启动更新脚本：' + msgOf(e))));
    if (wait) {
      child.on('exit', (code) => resolve(typeof code === 'number' ? code : 0));
    } else {
      child.unref();
      resolve(0);
    }
  });
}

// ---------------------------------------------------------------------------
// 忽略 / 取消
// ---------------------------------------------------------------------------
function dismiss(version) {
  const v = version ? String(version) : state.latestVersion;
  if (!v) return snapshot();
  dismissed[v] = Date.now();
  saveDismissed();
  if (state.latestVersion === v) {
    return push({ state: 'dismissed', message: '已忽略版本 ' + v + ' 的更新' });
  }
  return snapshot();
}

function cancel() {
  const job = download;
  if (!job) {
    if (state.state === 'checking') {
      checkEpoch += 1; // 让迟到的检查响应作废
      checking = false;
      return push({ state: 'idle', message: '已取消检查更新', progress: null });
    }
    return snapshot();
  }
  job.canceled = true;
  try {
    if (job.res) job.res.destroy();
  } catch {
    /* 忽略 */
  }
  try {
    if (job.req) job.req.destroy();
  } catch {
    /* 忽略 */
  }
  try {
    if (job.ws) job.ws.destroy();
  } catch {
    /* 忽略 */
  }
  try {
    if (fs.existsSync(job.file)) fs.unlinkSync(job.file);
  } catch {
    /* 忽略 */
  }
  download = null;
  busy = false;
  runId += 1; // 让上一轮的 catch/finally 失效，避免覆盖下面推的 available
  // 下载取消了，但「有更新」这件事没变：落 available，让前端可以直接重新开始，
  // 而不是退回 idle 被误显示成「已是最新版本」（没有版本信息时才落 idle）。
  const back = state.latestVersion && state.sha256 ? 'available' : 'idle';
  return push({
    state: back,
    message: back === 'available' ? '已取消本次更新下载，可随时重新开始' : '已取消本次更新下载',
    progress: null,
  });
}

// ---------------------------------------------------------------------------
// 通道入口
// ---------------------------------------------------------------------------
function appInfo() {
  const v = process.versions || {};
  return {
    appVersion: app.getVersion(),
    electron: v.electron || '',
    chrome: v.chrome || '',
    node: v.node || '',
    os: os.type() + ' ' + os.release() + ' ' + process.arch,
    installDir: installDir(),
    isPackaged: !!app.isPackaged,
  };
}

async function handle(channel, payload) {
  const p = payload || {};
  try {
    if (channel === 'app:info') return { ok: true, data: appInfo() };
    if (channel === 'update:state') return { ok: true, data: snapshot() };
    if (channel === 'update:check') return { ok: true, data: await check({ force: !!p.force }) };
    if (channel === 'update:apply') return { ok: true, data: apply() };
    if (channel === 'update:dismiss') return { ok: true, data: dismiss(p.version) };
    if (channel === 'update:cancel') return { ok: true, data: cancel() };
    return { ok: false, error: '未知更新通道：' + String(channel) };
  } catch (e) {
    return { ok: false, error: msgOf(e) };
  }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
/** 清理超过 24 小时的残留临时文件（升级脚本正在用的不会被误删）。 */
function sweepTemp() {
  const dir = tempDir();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (now - st.mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
}

function scheduleAutoCheck() {
  if (process.env.XCL_UPDATE_AUTOCHECK === '0') return;
  // 启动后 8~12 秒随机延迟：避开启动高峰，也不至于让用户等太久
  const delay = 8000 + Math.floor(Math.random() * 4000);
  autoTimer = setTimeout(() => {
    check({ force: false }).catch(() => {
      /* check 内部已兜底，这里只防御 */
    });
  }, delay);
  if (autoTimer.unref) autoTimer.unref();
}

function init(ctx) {
  const c = ctx || {};
  sendEvent = typeof c.sendEvent === 'function' ? c.sendEvent : null;
  state = {
    state: 'idle',
    currentVersion: app.getVersion(),
    latestVersion: null,
    checkedAt: null,
  };
  loadDismissed();
  sweepTemp();
  scheduleAutoCheck();
}

function dispose() {
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  if (download) {
    download.canceled = true;
    try {
      if (download.res) download.res.destroy();
    } catch {
      /* 忽略 */
    }
    try {
      if (download.req) download.req.destroy();
    } catch {
      /* 忽略 */
    }
    try {
      if (download.ws) download.ws.destroy();
    } catch {
      /* 忽略 */
    }
    download = null;
  }
}

module.exports = {
  init: init,
  handle: handle,
  dispose: dispose,
  // 以下导出仅供自测/排障使用
  _internal: {
    cmpVersion: cmpVersion,
    buildApplyScript: buildApplyScript,
    resourceGate: resourceGate,
    state: () => snapshot(),
  },
};
