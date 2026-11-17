/* 取消下载分支验证（只读前端，不改文件）：
 * 场景 A：主进程把 update:cancel 落点改成 available（有 latestVersion+sha256）
 *         → 前端能否从「下载中」干净回退成「发现新版本 + 立即更新」
 * 场景 B：落点改成纯 idle（checkedAt/latestVersion 清空）
 *         → 前端回到「还没有检查过更新」
 * 运行：node scripts/verify-cancel-branch.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9253;
const HTML = 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-cancel-' + process.pid);
const OUT = path.join(__dirname, '..', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* cancel 的行为可切换，模拟两种落点 */
const FAKE = `
(function(){
  var state = { state:'available', currentVersion:'1.0.0', latestVersion:'1.2.0',
                notes:'1. 新增「重启并更新」入口\\n2. 修复若干问题', size:205576,
                sha256:'abc123', checkedAt: Date.now() };
  var listeners = [];
  window.__calls = [];
  window.__cancelMode = 'available';   /* 'available' | 'idle' */
  function snap(){ return JSON.parse(JSON.stringify(state)); }
  function emit(){ listeners.forEach(function(cb){ try{ cb(snap()); }catch(e){} }); }
  function set(patch){ state = Object.assign({}, state, patch||{}); emit(); }
  window.__setState = function(patch){ set(patch); return snap(); };
  window.FMBridge = {
    available: true,
    invoke: function(ch, payload){
      window.__calls.push({ ch: ch, payload: payload });
      if (ch === 'app:info') return Promise.resolve({ ok:true, data:{ appVersion:'1.0.0', electron:'33.2.1',
        chrome:'130', node:'20.18.1', os:'Windows_NT 10.0.22631 x64', installDir:'E:\\\\XCL', isPackaged:true } });
      if (ch === 'update:state') return Promise.resolve({ ok:true, data: snap() });
      if (ch === 'update:apply') {
        set({ state:'downloading', progress:{ received:0, total:205576, percent:0, speed:0 } });
        return Promise.resolve({ ok:true, data: snap() });
      }
      if (ch === 'update:cancel') {
        if (window.__cancelMode === 'current') {
          /* 方案 C：现状——只重置 state/message/progress，保留 latestVersion+checkedAt */
          set({ state:'idle', progress:null, message:'已取消本次更新下载' });
        } else if (window.__cancelMode === 'idle') {
          /* 方案 B：清干净回初始态 */
          set({ state:'idle', latestVersion:null, notes:null, size:null, sha256:null,
                checkedAt:null, progress:null, message:'已取消本次更新下载' });
        } else {
          /* 方案 A：仍算「有可用更新、未下载」 */
          set({ state:'available', progress:null, message:'已取消本次更新下载' });
        }
        return Promise.resolve({ ok:true, data: snap() });
      }
      return Promise.resolve({ ok:true, data: snap() });
    },
    on: function(name, cb){ listeners.push(cb); return function(){}; }
  };
  window.FMWindow = { available:true, minimize:function(){}, toggleMaximize:function(){}, close:function(){},
    onState:function(cb){ try{ cb({maximized:false,fullscreen:false}); }catch(e){} return function(){}; } };
})();
`;

const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + '  ' + JSON.stringify(extra));
}

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  try {
    let wsUrl;
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const p = list.find(t => t.type === 'page');
        if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
      } catch (_) {}
      await sleep(250);
    }
    if (!wsUrl) throw new Error('CDP 未就绪');

    const ws = new WebSocket(wsUrl);
    let id = 0; const waiters = new Map();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise(res => {
      const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    });
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
    await send('Page.navigate', { url: pathToFileURL(HTML).href });

    const ev = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : null;
    };
    const shot = async (name) => {
      fs.mkdirSync(OUT, { recursive: true });
      const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    };

    for (let i = 0; i < 80; i++) {
      if (await ev(`document.readyState === 'complete' && !!document.getElementById('setSeg')`)) break;
      await sleep(200);
    }
    await sleep(500);
    await ev(`(function(){
      document.querySelector('.rail-btn[data-page="settings"]').click();
      document.querySelector('#setSeg button[data-tab="update"]').click();
      return 1; })()`);
    await sleep(500);

    /* ---------- 场景 A：cancel 落 available ---------- */
    await ev(`window.__cancelMode = 'available'; 1`);
    await ev(`document.querySelector('#updOut [data-upd-act="apply"]').click(); 1`);
    await sleep(400);
    const mid = await ev(`(function(){
      var b = document.querySelector('#updOut .upd-box');
      return { head: b ? b.textContent.replace(/\\s+/g,' ').slice(0, 40) : '',
               hasCancel: !!document.querySelector('#updOut [data-upd-act="cancel"]'),
               pill: document.getElementById('updPillTxt').textContent,
               pillHidden: document.getElementById('updPill').hidden };
    })()`);
    check('A1 点「立即更新」后进入下载态（有取消按钮）',
      mid.hasCancel && /正在下载更新包/.test(mid.head) && !mid.pillHidden, mid);

    await ev(`document.querySelector('#updOut [data-upd-act="cancel"]').click(); 1`);
    await sleep(500);
    const afterA = await ev(`(function(){
      var b = document.querySelector('#updOut .upd-box');
      var tag = document.querySelector('#updOut .upd-ver-tag');
      var btn = document.querySelector('#updOut [data-upd-act="apply"]');
      var prog = document.querySelector('#updOut .upd-prog');
      var note = document.querySelector('#updOut .upd-note');
      var pill = document.getElementById('updPill');
      return { head: b ? b.textContent.replace(/\\s+/g,' ').slice(0, 40) : '',
               tag: tag ? tag.textContent : '', hasApply: !!btn, label: btn ? btn.textContent.trim() : '',
               hasProgress: !!prog, hasNote: !!note,
               pillHidden: pill.hidden, pillTxt: document.getElementById('updPillTxt').textContent,
               pillMode: document.getElementById('updPillMain').dataset.mode };
    })()`);
    check('A2 取消后回退成「发现新版本 + 立即更新」，进度条与下载态消失',
      /发现新版本/.test(afterA.head) && afterA.tag === 'v1.2.0' && afterA.hasApply &&
      afterA.label === '立即更新' && !afterA.hasProgress, afterA);
    check('A3 取消后顶部胶囊重新出现为「重启并更新」',
      !afterA.pillHidden && afterA.pillTxt === '重启并更新' && afterA.pillMode === 'available', afterA);
    check('A4 取消后说明条仍在（available 状态下应显示）', afterA.hasNote === true, afterA);
    await shot('upd-cancel-available.png');

    /* 取消后还能再点一次立即更新（可重来） */
    await ev(`document.querySelector('#updOut [data-upd-act="apply"]').click(); 1`);
    await sleep(400);
    const again = await ev(`(function(){
      var c = window.__calls.filter(function(x){ return x.ch === 'update:apply'; }).length;
      return { applyCalls: c, hasCancel: !!document.querySelector('#updOut [data-upd-act="cancel"]') };
    })()`);
    check('A5 取消后可一键重来（再次调用 apply 并回到下载态）',
      again.applyCalls === 2 && again.hasCancel, again);

    /* ---------- 场景 B：cancel 落纯 idle ---------- */
    await ev(`window.__cancelMode = 'idle';
              window.__setState({ state:'available', latestVersion:'1.2.0', size:205576,
                sha256:'abc123', checkedAt:Date.now(), progress:null }); 1`);
    await sleep(300);
    await ev(`document.querySelector('#updOut [data-upd-act="apply"]').click(); 1`);
    await sleep(350);
    await ev(`document.querySelector('#updOut [data-upd-act="cancel"]').click(); 1`);
    await sleep(500);
    const afterB = await ev(`(function(){
      var b = document.querySelector('#updOut .upd-box');
      return { head: b ? b.textContent.replace(/\\s+/g,' ').slice(0, 30) : '',
               hasApply: !!document.querySelector('#updOut [data-upd-act="apply"]'),
               hasRetry: !!document.querySelector('#updOut [data-upd-act="check"]'),
               checked: document.getElementById('updChecked').textContent,
               pillHidden: document.getElementById('updPill').hidden };
    })()`);
    check('B 落点改成纯 idle 时回退到「还没有检查过更新」（无版本徽标/无立即更新）',
      /还没有检查过更新/.test(afterB.head) && !afterB.hasApply && afterB.pillHidden, afterB);
    await shot('upd-cancel-idle.png');

    /* ---------- 场景 C：现状（idle 但保留 latestVersion/checkedAt）---------- */
    await ev(`window.__cancelMode = 'current';
              window.__setState({ state:'available', latestVersion:'1.2.0', size:205576,
                sha256:'abc123', checkedAt:Date.now(), progress:null }); 1`);
    await sleep(300);
    await ev(`document.querySelector('#updOut [data-upd-act="apply"]').click(); 1`);
    await sleep(350);
    await ev(`document.querySelector('#updOut [data-upd-act="cancel"]').click(); 1`);
    await sleep(500);
    const afterC = await ev(`(function(){
      var b = document.querySelector('#updOut .upd-box');
      return { cls: b ? b.className : '', head: b ? b.textContent.replace(/\s+/g,' ').slice(0, 30) : '',
               hasApply: !!document.querySelector('#updOut [data-upd-act="apply"]'),
               tag: (document.querySelector('#updOut .upd-ver-tag')||{}).textContent || '',
               latest: (window.__lastState||{}).latestVersion };
    })()`);
    console.log('现状（方案 C）取消后的实际渲染：' + JSON.stringify(afterC));
    check('C 现状会显示绿色「已是最新版本」而版本 1.2.0 仍在（确认这是缺陷）',
      /upd-box ok/.test(afterC.cls) && /已是最新版本/.test(afterC.head) && !afterC.hasApply, afterC);
    await shot('upd-cancel-current-bug.png');

    const fails = results.filter(r => !r.pass);
    console.log('\n===== 取消分支 ' + (results.length - fails.length) + ' / ' + results.length + ' =====');
    ws.close();
    process.exit(fails.length ? 1 : 0);
  } catch (e) {
    console.error('TEST ERROR:', e && e.stack || e);
    process.exit(2);
  } finally {
    try { edge.kill(); } catch (_) {}
    await sleep(300);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
})();
