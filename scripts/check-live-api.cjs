'use strict';
/**
 * 线上更新接口只读体检（不入包，不会下载完整安装包）。
 *
 *   node scripts/check-live-api.cjs
 *   node scripts/check-live-api.cjs --current 1.0.0 --key XCL-4XX2-2026-INSTALL
 *   node scripts/check-live-api.cjs --feed https://rj-app-download.app.workbuddy.host
 *
 * 断言 8 项：
 *   1. GET  /api/v1/app/update   200 且 ok:true
 *   2. latest.version 存在
 *   3. latest.size > 0
 *   4. latest.sha256 是 64 位十六进制（空值/位数不对一律失败）
 *   5. POST /api/v1/app/verify-key 200 且拿到 token
 *   6. GET  /api/v1/app/package  200 且 content-type 是 zip
 *   7. content-length 与 manifest 的 size 一致
 *   8. x-checksum-sha256 与 manifest 的 sha256 一致
 *
 * 下载请求拿到响应头就 abort，不会拉 160MB。全部通过 exit 0，否则 exit 1。
 */

const FEED = process.env.XCL_UPDATE_FEED || 'https://rj-app-download.app.workbuddy.host';
const SHARECODE = '4XX2XCSHDN';
const DEFAULT_APP = 'xcraft-launcher';
const DEFAULT_KEY = 'XCL-4XX2-2026-INSTALL';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CURRENT = arg('current', '1.0.0');
const KEY = arg('key', DEFAULT_KEY);
// --app 可切到别的软件记录（如安装器 xcraft-launcher-setup），默认启动器
const APP = arg('app', DEFAULT_APP);
const feed = arg('feed', FEED).replace(/\/+$/, '');
console.log('# 体检目标：' + APP + ' @ ' + feed + '（current=' + CURRENT + '）');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  ' + detail : ''));
}

function isSha256(v) {
  return typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
}

async function main() {
  const url = (p, params) => {
    const u = new URL(feed + p);
    u.searchParams.set('sharecode', SHARECODE);
    for (const k of Object.keys(params || {})) {
      if (params[k] !== undefined && params[k] !== null) u.searchParams.set(k, String(params[k]));
    }
    return u.toString();
  };

  // ---- 1~4：检查更新 ----
  let latest = null;
  try {
    const r = await fetch(url('/api/v1/app/update', { app: APP, current: CURRENT }));
    const text = await r.text();
    check('update 接口返回 200', r.status === 200, 'HTTP ' + r.status);
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {
      /* 下面统一判 */
    }
    check('update 返回合法 JSON 且 ok:true', !!j && j.ok === true, text.slice(0, 160));
    latest = (j && j.latest) || null;
    check('latest.version 存在', !!(latest && latest.version), latest && latest.version);
    check(
      'latest.size > 0',
      !!(latest && Number(latest.size) > 0),
      latest ? String(latest.size) : 'null',
    );
    check(
      'latest.sha256 是 64 位十六进制',
      !!(latest && isSha256(latest.sha256)),
      latest ? JSON.stringify(latest.sha256) : 'null',
    );
    if (j && j.hasUpdate === false) console.log('       （hasUpdate:false，当前版本已是最新，属正常）');
  } catch (e) {
    check('update 接口可访问', false, e.message);
  }

  // ---- 5：安装密钥换令牌 ----
  let token = '';
  try {
    const body = JSON.stringify({ app: APP, key: KEY });
    const r = await fetch(url('/api/v1/app/verify-key'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body: body,
    });
    const j = await r.json().catch(() => ({}));
    token = (j && j.token) || '';
    check('verify-key 返回 token', r.status === 200 && !!token, 'HTTP ' + r.status + (j.error ? ' ' + j.error : ''));
  } catch (e) {
    check('verify-key 可访问', false, e.message);
  }

  // ---- 6~8：下载响应头（只读，拿到头就 abort） ----
  if (token) {
    const ac = new AbortController();
    try {
      const r = await fetch(url('/api/v1/app/package', { app: APP, token: token }), { signal: ac.signal });
      const ctype = r.headers.get('content-type') || '';
      const len = Number(r.headers.get('content-length'));
      const sum = r.headers.get('x-checksum-sha256');
      check('package 返回 200 且是 zip', r.status === 200 && /zip/i.test(ctype), 'HTTP ' + r.status + ' ' + ctype);
      check(
        'content-length 与 manifest.size 一致',
        !!latest && len === Number(latest.size),
        'header=' + len + ' manifest=' + (latest ? latest.size : 'null'),
      );
      check('x-checksum-sha256 与 manifest.sha256 一致', !!latest && sum === latest.sha256, 'header=' + sum);
      ac.abort(); // 只要响应头，不拉整包
    } catch (e) {
      if (e.name !== 'AbortError') check('package 可访问', false, e.message);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  console.log('\n===== ' + passed + '/' + results.length + ' 通过 =====');
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('体检异常：', e && e.message ? e.message : e);
  process.exitCode = 1;
});
