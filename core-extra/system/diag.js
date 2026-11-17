'use strict';

/**
 * 诊断包（crash report）模块。
 *
 * 目标：用户「游戏崩了 / 界面白屏 / 启动器报错」时，一键把定位问题需要的现场
 * 打成一个 zip，直接发给客服，不用再教用户「去哪个目录找哪个 log」。
 *
 * 设计约束：
 *   - **不 require('electron')**：所有环境相关的东西（路径、打开目录、窗口事件）都从
 *     opts 注入。这样才能用 `node _work/diag-selftest.js` 在无头环境里真跑一遍。
 *   - 所有文件操作单独 try/catch：单个文件读不到只是包内容少一项，绝不让整次打包失败。
 *   - 打包内容与目录布局见 _work/diag-contract.md（已冻结，字段名不得改）。
 *   - 绝不写入 token / secret / password 一类字段：写盘前统一过一遍脱敏。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeZip } = require('./zip.js');

/** 保留的诊断包个数（超出按 mtime 最旧删） */
const KEEP_ZIPS = 20;

/** 允许的触发原因；不在表里的一律按 manual 处理 */
const REASONS = ['manual', 'game-crash', 'main-exception', 'renderer-gone'];

/** 单个日志文件最多读这么多（取尾部）：latest.log 几十 MB 很常见，全塞进 zip 没意义 */
const LOG_TAIL_BYTES = 4 * 1024 * 1024;

/** summary / meta 里最多带多少行游戏输出 */
const TAIL_LINES = 30;

/** 包名形如 20261111-172401-game-crash，清理残留目录时用它判断 */
const NAME_RE = /^\d{8}-\d{6}-[a-z-]+$/;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 本地时间 yyyymmdd-hhmmss（不用 ISO：用户看包名要一眼认出「什么时候」） */
function stamp(d) {
  const t = d instanceof Date ? d : new Date();
  return (
    String(t.getFullYear()) +
    pad2(t.getMonth() + 1) +
    pad2(t.getDate()) +
    '-' +
    pad2(t.getHours()) +
    pad2(t.getMinutes()) +
    pad2(t.getSeconds())
  );
}

function formatTime(d) {
  const t = d instanceof Date ? d : new Date();
  return (
    t.getFullYear() +
    '-' +
    pad2(t.getMonth() + 1) +
    '-' +
    pad2(t.getDate()) +
    ' ' +
    pad2(t.getHours()) +
    ':' +
    pad2(t.getMinutes()) +
    ':' +
    pad2(t.getSeconds())
  );
}

function bytesToMB(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '0 MB';
  const mb = v / 1024 / 1024;
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return mb.toFixed(mb >= 100 ? 0 : 1) + ' MB';
}

function truncate(s, max) {
  const str = String(s == null ? '' : s);
  if (str.length <= max) return str;
  return str.slice(0, max) + '…（已截断）';
}

/** 深拷贝 + 脱敏：命中 token/secret/password/key 的键值一律换成 '***'。 */
function sanitize(value, depth) {
  const d = typeof depth === 'number' ? depth : 0;
  if (d > 6) return '***';
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitize(v, d + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (/token|secret|password|passwd|credential|key/i.test(k)) {
        out[k] = '***';
      } else {
        out[k] = sanitize(value[k], d + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    // 值本身也可能是 "Authorization: Bearer xxx" 这种，抹掉明显的 token 片段
    return value.replace(/((?:token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1***');
  }
  return value;
}

/** config 只放白名单字段（键名本身就敏感的绝不外带，所以这里用正向列举）。 */
const CONFIG_WHITELIST = ['maxMemoryMB', 'width', 'height', 'javaPath', 'fullscreen', 'language', 'gameDir'];

function pickConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const out = {};
  let n = 0;
  for (const k of CONFIG_WHITELIST) {
    if (cfg[k] !== undefined) {
      out[k] = sanitize(cfg[k]);
      n += 1;
    }
  }
  return n ? out : null;
}

/** 读文件尾部若干字节（返回字符串）。文件不存在 / 读失败返回 null。 */
async function readTail(file, maxBytes) {
  if (!file) return null;
  let handle = null;
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) return null;
    const start = st.size > maxBytes ? st.size - maxBytes : 0;
    handle = await fs.promises.open(file, 'r');
    const len = st.size - start;
    if (len <= 0) return { text: '', size: st.size, truncated: false };
    const buf = Buffer.alloc(len);
    await handle.read(buf, 0, len, start);
    let text = buf.toString('utf8');
    // 从中间开始读可能切在多字节字符上：丢掉第一个残字
    if (start > 0 && text.length && text.charCodeAt(0) === 0xfffd) text = text.slice(1);
    return { text: text, size: st.size, truncated: start > 0 };
  } catch {
    return null;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* 忽略 */
      }
    }
  }
}

/** 整块读一个小文件（crash report 通常几十 KB）。失败返回 null。 */
async function readWhole(file, maxBytes) {
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) return null;
    if (st.size > maxBytes) return readTail(file, maxBytes);
    const buf = await fs.promises.readFile(file);
    return { text: buf.toString('utf8'), size: st.size, truncated: false };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// createDiag
// ---------------------------------------------------------------------------
/**
 * @param {{
 *   rootDir: string,
 *   appVersion?: string,
 *   mainErrorLog?: string,
 *   perfFile?: string|string[],
 *   getGameDir?: () => string,
 *   getContext?: () => object,
 *   getConfig?: () => object,
 *   showItemInFolder?: (file:string)=>void,
 *   openPath?: (dir:string)=>any,
 *   log?: { info?:Function, warn?:Function, error?:Function } | Function
 * }} opts
 */
function createDiag(opts) {
  const o = opts || {};
  const rootDir = path.resolve(String(o.rootDir || path.join(os.tmpdir(), 'xcl-crash')));

  const appVersion = String(o.appVersion || '');
  const getGameDir = typeof o.getGameDir === 'function' ? o.getGameDir : () => '';
  const getContext = typeof o.getContext === 'function' ? o.getContext : () => ({});
  const getConfig = typeof o.getConfig === 'function' ? o.getConfig : null;
  const showItemInFolder = typeof o.showItemInFolder === 'function' ? o.showItemInFolder : null;
  const openPath = typeof o.openPath === 'function' ? o.openPath : null;

  /** perf 统计文件：允许传数组，逐个探测第一个存在的（版本迭代里文件名变过） */
  const perfFiles = (() => {
    const raw = o.perfFile;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.filter((f) => typeof f === 'string' && f);
  })();

  const logger = o.log;
  const warn = (msg, err) => {
    const line = '[diag] ' + msg + (err ? '：' + (err && err.message ? err.message : String(err)) : '');
    try {
      if (typeof logger === 'function') logger(line);
      else if (logger && typeof logger.warn === 'function') logger.warn(line);
    } catch {
      /* 记日志本身失败也不能影响打包 */
    }
  };

  /** 读当前上下文，所有字段做归一化 + 兜底（getContext 抛错也不能打断打包）。 */
  function context() {
    let raw = {};
    try {
      raw = getContext() || {};
    } catch (err) {
      warn('读取运行上下文失败', err);
      raw = {};
    }
    const cpus = (() => {
      try {
        return os.cpus() || [];
      } catch {
        return [];
      }
    })();
    const cpuModel = raw.cpu && raw.cpu.model ? raw.cpu.model : cpus.length ? cpus[0].model : '';
    const cpuThreads =
      raw.cpu && Number(raw.cpu.threads) > 0 ? Number(raw.cpu.threads) : cpus.length || 0;
    const memTotal = raw.mem && Number(raw.mem.total) > 0 ? Number(raw.mem.total) : os.totalmem();
    const memFree = raw.mem && Number(raw.mem.free) >= 0 ? Number(raw.mem.free) : os.freemem();

    let gameDir = '';
    try {
      gameDir = String(getGameDir() || '');
    } catch {
      gameDir = '';
    }

    let config = null;
    if (getConfig) {
      try {
        config = pickConfig(getConfig());
      } catch {
        config = null;
      }
    }
    if (!config && raw.config) config = pickConfig(raw.config);

    const lastLines = Array.isArray(raw.lastLines)
      ? raw.lastLines.map((l) => String(l)).slice(-TAIL_LINES)
      : [];

    return {
      versionId: raw.versionId ? String(raw.versionId) : '',
      javaPath: raw.javaPath ? String(raw.javaPath) : '',
      exitCode: raw.exitCode === undefined || raw.exitCode === null ? null : raw.exitCode,
      signal: raw.signal ? String(raw.signal) : '',
      uptimeMs: Number(raw.uptimeMs) > 0 ? Number(raw.uptimeMs) : 0,
      lastError: raw.lastError ? String(raw.lastError) : '',
      lastLines: lastLines,
      gameDir: gameDir,
      os: raw.os && typeof raw.os === 'object' ? sanitize(raw.os) : {
        platform: process.platform,
        arch: process.arch,
        type: os.type(),
        release: os.release(),
      },
      cpu: { model: cpuModel, threads: cpuThreads },
      mem: { total: memTotal, free: memFree },
      config: config,
      extra: raw.extra ? sanitize(raw.extra) : null,
    };
  }

  /** 生成 summary.txt（纯文本、中文、关键信息全部在前 40 行内） */
  function buildSummary(ctx, reason, note, files) {
    const L = [];
    const push = (s) => L.push(s == null ? '' : String(s));
    push('X Craft Launcher 诊断包');
    push('生成时间：' + formatTime(new Date()));
    push('触发原因：' + reasonLabel(reason) + '（' + reason + '）');
    if (note) push('用户描述：' + note);
    push('');
    push('【启动器】');
    push('版本：' + (appVersion || '未知'));
    push(
      '平台：' + process.platform + ' / ' + process.arch + ' / Node ' + (process.versions ? process.versions.node : '?'),
    );
    push('');
    push('【系统】');
    push('操作系统：' + osText(ctx.os));
    push('CPU：' + (ctx.cpu.model || '未知') + '（' + (ctx.cpu.threads || '?') + ' 线程）');
    push('物理内存：' + bytesToMB(ctx.mem.total) + '（可用 ' + bytesToMB(ctx.mem.free) + '）');
    push('');
    push('【游戏】');
    push('当前版本 id：' + (ctx.versionId || '（未记录）'));
    push('安装目录：' + (ctx.gameDir || '（未知）'));
    push('Java 路径：' + (ctx.javaPath || '（未知）'));
    push('退出码：' + (ctx.exitCode === null ? '（未记录）' : String(ctx.exitCode)));
    if (ctx.signal) push('退出信号：' + ctx.signal);
    push('存活毫秒：' + (ctx.uptimeMs ? String(ctx.uptimeMs) : '（未记录）'));
    push('最后一条错误：' + (ctx.lastError || '（没有捕获到明确的错误行）'));
    if (ctx.config) {
      push('');
      push('【启动参数（白名单字段）】');
      push(JSON.stringify(ctx.config));
    }
    push('');
    push('【输出尾部 ' + TAIL_LINES + ' 行】');
    if (ctx.lastLines.length) {
      for (const line of ctx.lastLines) push(line);
    } else {
      push('（没有捕获到游戏输出）');
    }
    push('');
    push('【包内文件】');
    if (files.length) for (const f of files) push('- ' + f.name + '（' + f.size + ' 字节）');
    else push('（只有本摘要）');
    push('');
    push('提示：本包不含账号 token / 密码 / 密钥，可直接发给客服。');
    return L.join('\n');
  }

  function reasonLabel(reason) {
    switch (reason) {
      case 'game-crash':
        return '游戏异常退出';
      case 'main-exception':
        return '主进程未捕获异常';
      case 'renderer-gone':
        return '界面进程崩溃';
      default:
        return '用户手动打包';
    }
  }

  function osText(o2) {
    if (!o2) return process.platform + ' ' + os.release();
    if (o2.type || o2.release) {
      return [o2.type || process.platform, o2.release || os.release(), o2.arch || process.arch]
        .filter(Boolean)
        .join(' ');
    }
    return [o2.platform || process.platform, o2.release || '', o2.arch || process.arch]
      .filter(Boolean)
      .join(' ');
  }

  // -------------------------------------------------------------------------
  // 收集包内容
  // -------------------------------------------------------------------------
  /** 往 entries 里推一个文件；读失败只记一行警告。 */
  async function addFile(entries, files, zipName, srcFile, maxBytes) {
    if (!srcFile) return false;
    let res;
    try {
      res = await readWhole(srcFile, maxBytes || LOG_TAIL_BYTES);
    } catch (err) {
      warn('读取失败 ' + zipName, err);
      res = null;
    }
    if (!res) return false;
    entries.push({ name: zipName, data: res.text });
    files.push({ name: zipName, size: Buffer.byteLength(res.text), from: srcFile, truncated: !!res.truncated });
    return true;
  }

  /** 游戏目录里的 crash-reports：只取 mtime 最新的 3 个 .txt。 */
  async function newestCrashReports(gameDir) {
    if (!gameDir) return [];
    const dir = path.join(gameDir, 'crash-reports');
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return [];
    }
    const stats = [];
    for (const name of names) {
      if (!/\.txt$/i.test(name)) continue;
      const full = path.join(dir, name);
      try {
        const st = await fs.promises.stat(full);
        if (st.isFile()) stats.push({ file: full, name: name, mtime: st.mtimeMs, size: st.size });
      } catch {
        /* 单个文件 stat 失败无所谓 */
      }
    }
    stats.sort((a, b) => b.mtime - a.mtime);
    return stats.slice(0, 3);
  }

  // -------------------------------------------------------------------------
  // 清理
  // -------------------------------------------------------------------------
  /** 包名 → reason："20261111-172401-game-crash.zip" → "game-crash"（含 -2 后缀的重名包） */
  function reasonOf(name) {
    const base = String(name).replace(/\.zip$/i, '');
    const m = /^\d{8}-\d{6}-(.+)$/.exec(base);
    if (!m) return 'unknown';
    const rest = m[1];
    for (const r of REASONS) {
      if (rest === r || rest.indexOf(r + '-') === 0) return r;
    }
    return rest;
  }

  async function listZips() {
    let names;
    try {
      names = await fs.promises.readdir(rootDir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      if (!/\.zip$/i.test(name)) continue;
      const full = path.join(rootDir, name);
      try {
        const st = await fs.promises.stat(full);
        if (!st.isFile()) continue;
        out.push({ file: full, name: name, size: st.size, at: Math.round(st.mtimeMs), reason: reasonOf(name) });
      } catch {
        /* 读不到就跳过 */
      }
    }
    out.sort((a, b) => b.at - a.at);
    return out;
  }

  /** 保留最近 KEEP_ZIPS 个；残留临时目录（超过 1 小时）一并清掉。 */
  async function prune() {
    const zips = await listZips();
    for (const z of zips.slice(KEEP_ZIPS)) {
      try {
        await fs.promises.rm(z.file, { force: true });
      } catch (err) {
        warn('删除旧诊断包失败 ' + z.name, err);
      }
    }
    let names;
    try {
      names = await fs.promises.readdir(rootDir);
    } catch {
      return;
    }
    const now = Date.now();
    for (const name of names) {
      const full = path.join(rootDir, name);
      // 半截 zip（进程在 rename 之前被杀）：一小时后再清，避开正在写的
      if (/\.zip\.part$/i.test(name)) {
        try {
          const st = await fs.promises.stat(full);
          if (now - st.mtimeMs > 60 * 60 * 1000) await fs.promises.rm(full, { force: true });
        } catch {
          /* 忽略 */
        }
        continue;
      }
      if (!NAME_RE.test(name)) continue; // 只认自己生成的目录名，别的文件一概不碰
      try {
        const st = await fs.promises.stat(full);
        if (!st.isDirectory()) continue;
        if (now - st.mtimeMs < 60 * 60 * 1000) continue; // 可能是正在打包的，留一小时
        await fs.promises.rm(full, { recursive: true, force: true });
      } catch {
        /* 忽略 */
      }
    }
  }

  // -------------------------------------------------------------------------
  // pack
  // -------------------------------------------------------------------------
  async function pack(payload) {
    const p = payload || {};
    const reason = REASONS.indexOf(String(p.reason)) >= 0 ? String(p.reason) : 'manual';
    const note = truncate(String(p.note == null ? '' : p.note).trim(), 500);
    const includeGameLogs = p.includeGameLogs !== false;

    await fs.promises.mkdir(rootDir, { recursive: true });

    // 同名（同一秒内连打两次）时加序号，别覆盖前一个包
    const baseName = stamp(new Date()) + '-' + reason;
    let name = baseName;
    for (let i = 2; i < 100; i += 1) {
      const exists =
        fs.existsSync(path.join(rootDir, name)) || fs.existsSync(path.join(rootDir, name + '.zip'));
      if (!exists) break;
      name = baseName + '-' + i;
    }

    const tmpDir = path.join(rootDir, name);
    const zipFile = path.join(rootDir, name + '.zip');
    // 先写 .part 再改名：打包中途被打断（退出流程 / 崩溃）时不会留下半截 zip，
    // 用户看到的一定是完整包，否则「发出去的文件打不开」比没包更糟。
    const zipTmp = zipFile + '.part';
    const ctx = context();
    const entries = [];
    const files = [];

    try {
      await fs.promises.mkdir(tmpDir, { recursive: true });

      // ---- 1) 主进程错误日志 ----
      if (o.mainErrorLog) {
        await addFile(entries, files, 'app/main-error.log', o.mainErrorLog, LOG_TAIL_BYTES);
      }

      // ---- 2) 游戏日志 ----
      const gameDir = ctx.gameDir || (() => {
        try {
          return String(getGameDir() || '');
        } catch {
          return '';
        }
      })();
      if (includeGameLogs && gameDir) {
        await addFile(entries, files, 'game/latest.log', path.join(gameDir, 'logs', 'latest.log'), LOG_TAIL_BYTES);

        // ---- 3) 最近的崩溃报告 ----
        const reports = await newestCrashReports(gameDir);
        for (const rep of reports) {
          let text = null;
          try {
            const res = await readWhole(rep.file, 2 * 1024 * 1024);
            if (res) text = res.text;
          } catch (err) {
            warn('读取崩溃报告失败 ' + rep.name, err);
          }
          if (text == null) continue;
          const zipName = 'game/crash-reports/' + rep.name;
          entries.push({ name: zipName, data: text });
          files.push({ name: zipName, size: Buffer.byteLength(text), from: rep.file, truncated: false });
        }
      }

      // ---- 4) 性能统计 ----
      for (const cand of perfFiles) {
        const ok = await addFile(entries, files, 'perf.json', cand, 2 * 1024 * 1024);
        if (ok) break;
      }

      // ---- 5) summary.txt + meta.json ----
      const summaryText = buildSummary(ctx, reason, note, files);
      entries.unshift({ name: 'summary.txt', data: summaryText });

      const meta = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        reason: reason,
        reasonLabel: reasonLabel(reason),
        note: note,
        launcher: { version: appVersion || null, node: process.versions ? process.versions.node : null },
        system: {
          os: ctx.os,
          cpu: ctx.cpu,
          mem: ctx.mem,
        },
        game: {
          versionId: ctx.versionId || null,
          javaPath: ctx.javaPath || null,
          gameDir: ctx.gameDir || null,
          exitCode: ctx.exitCode,
          signal: ctx.signal || null,
          uptimeMs: ctx.uptimeMs,
          lastError: ctx.lastError || null,
          lastLines: ctx.lastLines,
        },
        config: ctx.config,
        extra: ctx.extra,
        files: files.map((f) => ({ name: f.name, size: f.size, truncated: !!f.truncated })),
        privacy: '不含账号 token / 密码 / 密钥；config 仅白名单字段',
      };
      entries.push({ name: 'meta.json', data: JSON.stringify(sanitize(meta), null, 2) });

      // 临时目录落一份明文副本：压在 zip 里的东西打不开时还能直接看
      for (const e of entries) {
        const dest = path.join(tmpDir, e.name.split('/').join(path.sep));
        try {
          await fs.promises.mkdir(path.dirname(dest), { recursive: true });
          await fs.promises.writeFile(dest, e.data);
        } catch (err) {
          warn('写临时文件失败 ' + e.name, err);
        }
      }

      // 先写 .part 再改名，避免中途被打断时留下半截 zip
      const now = new Date();
      const written = await writeZip(
        zipTmp,
        entries.map((e) => ({ name: e.name, data: e.data, mtime: now })),
      );
      await fs.promises.rename(zipTmp, zipFile);

      return {
        file: zipFile,
        dir: rootDir,
        name: name + '.zip',
        size: written.size,
        at: Date.now(),
        summary: summaryText,
      };
    } finally {
      // 无论成败都删临时目录：zip 已生成，明文副本没有留存价值（还占地方、含崩溃现场）
      try {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      } catch {
        /* 删不掉就留给 prune() 一小时后再清 */
      }
      // 打包失败时别留下半截 zip / .part（用户点开是「文件损坏」，更困惑）
      try {
        await fs.promises.rm(zipTmp, { force: true });
      } catch {
        /* 改名成功后本来就不存在 */
      }
      try {
        const st = await fs.promises.stat(zipFile);
        if (st.size === 0) await fs.promises.rm(zipFile, { force: true });
      } catch {
        /* 文件不存在是正常情况（pack 抛错） */
      }
      try {
        await prune();
      } catch (err) {
        warn('清理旧诊断包失败', err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // status / reveal / clear
  // -------------------------------------------------------------------------
  async function status() {
    const zips = await listZips();
    return { dir: rootDir, count: zips.length, items: zips.slice(0, KEEP_ZIPS) };
  }

  /** 只允许在诊断根目录内打开：渲染进程传什么路径都不能变成「打开任意文件」。 */
  function insideRoot(p) {
    try {
      const rel = path.relative(rootDir, path.resolve(p));
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    } catch {
      return false;
    }
  }

  async function reveal(payload) {
    const wanted = payload && payload.file ? String(payload.file) : '';
    await fs.promises.mkdir(rootDir, { recursive: true });
    if (wanted && insideRoot(wanted) && fs.existsSync(wanted)) {
      try {
        if (showItemInFolder) showItemInFolder(wanted);
        else if (openPath) await openPath(path.dirname(wanted));
      } catch (err) {
        warn('打开诊断包位置失败', err);
      }
      return { opened: true, file: wanted };
    }
    try {
      if (openPath) await openPath(rootDir);
      else if (showItemInFolder) showItemInFolder(rootDir);
    } catch (err) {
      warn('打开诊断目录失败', err);
    }
    return { opened: true, dir: rootDir };
  }

  async function clear() {
    let removed = 0;
    let names;
    try {
      names = await fs.promises.readdir(rootDir);
    } catch {
      return { removed: 0 };
    }
    for (const name of names) {
      const full = path.join(rootDir, name);
      const isZip = /\.zip$/i.test(name);
      const isPart = /\.zip\.part$/i.test(name);
      const isTmpDir = NAME_RE.test(name);
      if (!isZip && !isPart && !isTmpDir) continue;
      try {
        await fs.promises.rm(full, { recursive: isTmpDir, force: true });
        removed += 1;
      } catch (err) {
        warn('删除诊断文件失败 ' + name, err);
      }
    }
    return { removed: removed };
  }

  /**
   * 删单个诊断包（列表里的「删除」按钮）。
   * 只认 rootDir 内的 .zip / .zip.part：其它路径一律抛错，绝不做「传什么删什么」。
   */
  async function remove(payload) {
    const wanted = payload && payload.file ? String(payload.file) : '';
    if (!wanted) throw new Error('缺少 file');
    const abs = path.resolve(wanted);
    if (!insideRoot(abs)) throw new Error('路径不在诊断目录内');
    const base = path.basename(abs);
    if (!/\.zip$/i.test(base) && !/\.zip\.part$/i.test(base)) {
      throw new Error('只能删除诊断包（.zip）');
    }
    if (!fs.existsSync(abs)) return { removed: false, file: abs };
    await fs.promises.rm(abs, { force: true });
    return { removed: true, file: abs };
  }

  return {
    dir: rootDir,
    status: status,
    pack: pack,
    reveal: reveal,
    clear: clear,
    remove: remove,
    /** 仅自测用：暴露脱敏与白名单实现，正常代码不要依赖 */
    _internals: { sanitize: sanitize, pickConfig: pickConfig },
  };
}

module.exports = { createDiag: createDiag };
