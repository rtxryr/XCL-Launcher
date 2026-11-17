'use strict';

/**
 * 内测上报（beta report）。
 *
 * 用户主动打开「内测功能」后才会用到：把设备画像 + 最近一段运行日志收成一个
 * JSON，POST 到官网 /api/v1/beta/report，服务端按月份落盘，供开发者排查内测问题。
 *
 * 三条硬约束：
 *   1. **不 require('electron')**：路径、版本、日志列表全部从 opts 注入，
 *      这样可以用 node 在无头环境里跑自测（见 _work/beta-selftest.js）。
 *   2. **上传前必须脱敏**：登录令牌、邮箱、32 位哈希、本机用户名路径一律抹掉。
 *      宁可少一条排障线索，也不把用户身份带出去。
 *   3. **任何失败都不抛**：采集失败就少一项，上传失败就返回 { ok:false }，
 *      绝不让上报动作影响启动器本身。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const API_BASE = 'https://rj-app-download.app.workbuddy.host';
const API_PATH = '/api/v1/beta/report';
const TIMEOUT_MS = 25000;
/** 单个日志文件最多取尾部这么多字节 */
const LOG_TAIL_BYTES = 512 * 1024;
/** 整个请求体上限（服务端也是 4MB，超了会被拒） */
const MAX_BODY_BYTES = 3.6 * 1024 * 1024;
/** 最多带几个日志文件 */
const MAX_LOG_FILES = 6;

/* ------------------------------------------------------------------ *
 * 脱敏
 * ------------------------------------------------------------------ */

const RULES = [
  /* Authorization: Bearer xxx / accessToken":"xxx" / refresh_token 等 */
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1<token>'],
  [/((?:access|refresh|session|id)_?token["'\s:=]+)[A-Za-z0-9._~+/-]{10,}/gi, '$1<token>'],
  [/((?:password|passwd|secret|api[_-]?key|client[_-]?secret)["'\s:=]+)[^\s"',}]{4,}/gi, '$1<redacted>'],
  /* 微软设备码 / 8 位代码 */
  [/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '<code>'],
  /* 邮箱 */
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  /* 32/40/64 位十六进制（session id、sha1、uuid 去横线） */
  [/\b[0-9a-f]{32,64}\b/gi, '<hash>'],
  /* UUID */
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  /* Windows 用户目录：C:\Users\xxx\... → %USERPROFILE%\...（正反斜杠都认） */
  [/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '%USERPROFILE%'],
  /* 其它盘符路径里的用户名片段兜底（AppData 之前那一段） */
  [/([A-Za-z]:[\\/]+(?:Documents and Settings|用户)[\\/]+)[^\\/\s"']+/gi, '$1%USER%']
];

function sanitize(text) {
  let s = String(text == null ? '' : text);
  for (const [re, rep] of RULES) {
    try { s = s.replace(re, rep); } catch { /* 单条规则失败不影响其它 */ }
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * 设备画像
 * ------------------------------------------------------------------ */

function cpuInfo() {
  const list = os.cpus() || [];
  const first = list[0] || {};
  return {
    model: String((first.model || '').trim()).replace(/\s+/g, ' '),
    cores: list.length,
    speedMHz: first.speed || 0,
    arch: process.arch
  };
}

function memInfo() {
  const total = os.totalmem();
  return {
    totalMB: Math.round(total / 1048576),
    freeMB: Math.round(os.freemem() / 1048576)
  };
}

/** 读一个日志文件的尾部（超出取最后 LOG_TAIL_BYTES 字节），并脱敏 */
function tailOf(file) {
  try {
    const st = fs.statSync(file);
    const size = st.size;
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const fd = fs.openSync(file, 'r');
    try {
      const len = Math.min(LOG_TAIL_BYTES, size - start);
      const buf = Buffer.allocUnsafe(len);
      fs.readSync(fd, buf, 0, len, start);
      let text = buf.toString('utf8');
      if (start > 0) {
        /* 从中间切开可能切坏一行，丢掉第一行残片 */
        const nl = text.indexOf('\n');
        if (nl >= 0 && nl < 400) text = text.slice(nl + 1);
        text = '…（仅末尾 ' + Math.round(LOG_TAIL_BYTES / 1024) + ' KB）\n' + text;
      }
      return { name: path.basename(file), size, text: sanitize(text) };
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  } catch (e) {
    return null;
  }
}

/**
 * 收集一次上报内容。
 * @param {object} opts
 *   - appVersion  {string}
 *   - logFiles    {string[]}  候选日志绝对路径（主进程会挑几个传进来）
 *   - extra       {object}    额外字段（原因、Super X 开关快照等）
 * @returns {object} payload（不含 anon，anon 在 upload 时补）
 */
function collect(opts) {
  const o = opts || {};
  const payload = {
    schema: 1,
    at: new Date().toISOString(),
    appVersion: String(o.appVersion || ''),
    os: {
      platform: process.platform,
      release: os.release(),
      version: String(os.version ? os.version() : ''),
      arch: process.arch,
      hostnameHash: crypto.createHash('sha256').update(String(os.hostname() || '')).digest('hex').slice(0, 12)
    },
    cpu: cpuInfo(),
    mem: memInfo(),
    uptimeMin: Math.round(os.uptime() / 60),
    node: process.versions && process.versions.node,
    electron: process.versions && process.versions.electron,
    locale: String(process.env.LANG || process.env.LC_ALL || '').slice(0, 32),
    extra: o.extra || {},
    logs: []
  };

  const files = Array.isArray(o.logFiles) ? o.logFiles.slice(0, MAX_LOG_FILES) : [];
  for (const f of files) {
    const t = tailOf(f);
    if (t) payload.logs.push(t);
  }
  return payload;
}

/* ------------------------------------------------------------------ *
 * 匿名标识：一台机器一个，落在 userData，不随账号变化
 * ------------------------------------------------------------------ */

function anonId(stateFile) {
  const file = stateFile || path.join(os.tmpdir(), 'xcl-beta-anon');
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && j.anon) return String(j.anon);
    }
  } catch { /* 读不出来就重建一个 */ }
  const id = crypto.randomBytes(9).toString('hex');
  try {
    let j = {};
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
    j.anon = id;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(j, null, 2), 'utf8');
  } catch { /* 落不了盘也照常上报，只是下次换个 id */ }
  return id;
}

/* ------------------------------------------------------------------ *
 * 上传
 * ------------------------------------------------------------------ */

function postJson(url, bodyObj) {
  return new Promise((resolve) => {
    let body = '';
    try { body = JSON.stringify(bodyObj); } catch (e) {
      resolve({ ok: false, error: '序列化失败：' + e.message });
      return;
    }
    if (body.length > MAX_BODY_BYTES) {
      /* 超限就砍日志（保留最后一条），再序列化一次 */
      try {
        const slim = Object.assign({}, bodyObj, {
          logs: (bodyObj.logs || []).slice(-1).map((l) => Object.assign({}, l, {
            text: String(l.text || '').slice(-160 * 1024)
          }))
        });
        body = JSON.stringify(slim);
      } catch { /* 保持原样，服务端会拒 */ }
    }
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };

    let req;
    try {
      const u = new URL(url);
      const mod = u.protocol === 'http:' ? require('http') : require('https');
      req = mod.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'user-agent': 'XCL-BetaReport/1'
        },
        timeout: TIMEOUT_MS
      }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; if (text.length > 65536) text = text.slice(0, 65536); });
        res.on('end', () => {
          let j = {};
          try { j = JSON.parse(text) || {}; } catch {}
          const ok = res.statusCode >= 200 && res.statusCode < 300 && j.ok !== false;
          finish({ ok, id: j.id || (j.data && j.data.id) || '', error: ok ? '' : (j.error || ('HTTP ' + res.statusCode)) });
        });
      });
      req.on('timeout', () => { try { req.destroy(new Error('超时')); } catch {} });
      req.on('error', (e) => finish({ ok: false, error: String((e && e.message) || e) }));
      req.write(body);
      req.end();
    } catch (e) {
      finish({ ok: false, error: String((e && e.message) || e) });
    }
  });
}

/**
 * 上传一次。
 * @param {object} payload collect() 的产物
 * @param {object} opts    { anon, saveFile }
 */
async function upload(payload, opts) {
  const o = opts || {};
  const body = Object.assign({}, payload, {
    anon: String(o.anon || ''),
    app: 'xcl',
    platform: process.platform
  });
  const res = await postJson(API_BASE + API_PATH, body);
  if (o.saveFile) {
    try {
      fs.writeFileSync(String(o.saveFile), JSON.stringify({
        at: new Date().toISOString(),
        ok: res.ok,
        id: res.id || '',
        error: res.error || '',
        payload: body
      }, null, 2), 'utf8');
    } catch { /* 只是留个本地副本，失败无所谓 */ }
  }
  return res;
}

module.exports = { collect, upload, anonId, sanitize, API_BASE, API_PATH };
