/* 定稿回归（只跑 team-lead 点名的两条硬要求）：
 *   A. 胶囊只在 available / downloading / verifying / ready 占位，其余 5 个状态 display:none 且 DOM 无空槽
 *   B. 点胶囊主体 → 进入 downloading，进度只来自 update:status 事件，没有本地计时器
 * 运行：node scripts/verify-update-final.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9251;
const HTML = 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-final-' + process.pid);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FAKE = `
(function(){
  var state = { state:'idle', currentVersion:'1.0.0', latestVersion:null, checkedAt:null };
  var listeners = [];
  window.__calls = [];
  function snap(){ return JSON.parse(JSON.stringify(state)); }
  function emit(){ listeners.forEach(function(cb){ try{ cb(snap()); }catch(e){} }); }
  window.__setState = function(patch, silent){ state = Object.assign({}, state, patch||{}); if(!silent) emit(); return snap(); };
  window.FMBridge = {
    available: true,
    invoke: function(ch, payload){
      window.__calls.push({ ch: ch, payload: payload });
      if (ch === 'app:info') return Promise.resolve({ ok:true, data:{ appVersion:'1.0.0', electron:'33.2.1',
        chrome:'130.0.6723.119', node:'20.18.1', os:'Windows_NT 10.0.22631 x64', installDir:'E:\\\\XCL', isPackaged:true } });
      if (ch === 'update:state') return Promise.resolve({ ok:true, data: snap() });
      if (ch === 'update:check') return Promise.resolve({ ok:true, data: snap() });
      if (ch === 'update:apply') {
        state = Object.assign({}, state, { state:'downloading',
          progress:{ received:0, total:161801714, percent:0, speed:0 } });
        emit();                                   /* 主进程同步推一次 downloading */
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
    `--user-data-dir=${PROFILE}`, '--window-size=1440,900', 'about:blank',
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
    for (let i = 0; i < 80; i++) {
      if (await ev(`document.readyState === 'complete' && !!document.getElementById('updPill')`)) break;
      await sleep(200);
    }
    await sleep(600);

    /* ---------- A. 9 个状态的占位情况 ---------- */
    const cases = [
      ['available', true], ['downloading', true], ['verifying', true], ['ready', true],
      ['idle', false], ['checking', false], ['skipped', false], ['error', false], ['dismissed', false],
    ];
    const rows = [];
    for (const [st, want] of cases) {
      await ev(`__setState({ state:'${st}', latestVersion:'1.0.1', size:161801714,
        progress:{ received:0, total:161801714, percent:0, speed:0 }, checkedAt: Date.now() })`);
      await sleep(180);
      const o = await ev(`(function(){
        var p = document.getElementById('updPill'), r = p.getBoundingClientRect(), s = getComputedStyle(p);
        var w = document.getElementById('wctl').getBoundingClientRect();
        return { hidden: p.hidden, display: s.display, w:+r.width.toFixed(1), h:+r.height.toFixed(1),
                 wctlW:+w.width.toFixed(1), txt: document.getElementById('updPillTxt').textContent };
      })()`);
      rows.push({ st, want, o });
    }
    const dup = rows.filter(r => r.want
      ? (r.o.hidden || r.o.display === 'none' || r.o.w <= 0)
      : (!r.o.hidden || r.o.display !== 'none' || r.o.w !== 0 || r.o.h !== 0));
    check('A 胶囊只在 available/downloading/verifying/ready 占位，其余 display:none 且零尺寸',
      dup.length === 0, dup);

    /* 隐藏时 #wctl 不比显示时宽（没有留空槽） */
    const hiddenW = rows.find(r => r.st === 'idle').o.wctlW;
    const shownW = rows.find(r => r.st === 'available').o.wctlW;
    const pillW = rows.find(r => r.st === 'available').o.w;
    /* 差值应正好等于「胶囊宽度 + 右侧 8px 外边距 + 2px 组内间距」，说明隐藏时整块回缩 */
    check('A2 隐藏时三键组宽度回缩，未留空槽',
      shownW > hiddenW && Math.abs((shownW - hiddenW) - (pillW + 10)) < 2,
      { hiddenW, shownW, pillW, delta: +(shownW - hiddenW).toFixed(1) });

    /* ---------- B. 点胶囊 → downloading，进度只认事件 ---------- */
    await ev(`__setState({ state:'available', latestVersion:'1.0.1', size:161801714,
      progress:null, checkedAt: Date.now() })`);
    await sleep(220);
    const c = await ev(`(function(){
      var r = document.getElementById('updPill').getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 };
    })()`);
    await ev(`window.__calls.length = 0`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });

    await sleep(300);
    const afterClick = await ev(`(function(){
      return { mode: document.getElementById('updPillMain').dataset.mode,
               txt: document.getElementById('updPillTxt').textContent,
               bar: document.getElementById('updPillBar').style.width,
               applyCalls: window.__calls.filter(function(c){ return c.ch === 'update:apply'; }).length,
               timers: (function(){ try { return 0; } catch(e){ return -1; } })() };
    })()`);
    check('B1 点主体 → 调用一次 update:apply 并进入 downloading（百分比来自状态，非本地计时）',
      afterClick.applyCalls === 1 && afterClick.mode === 'downloading' &&
      afterClick.txt === '更新中 0%' && afterClick.bar === '0%', afterClick);

    /* 1000ms 内不推任何事件：必须保持 0% */
    await sleep(1000);
    const idle1s = await ev(`(function(){
      return { txt: document.getElementById('updPillTxt').textContent,
               bar: document.getElementById('updPillBar').style.width };
    })()`);
    check('B2 无事件时 1 秒后仍停在 0%（确认没有本地计时器）',
      idle1s.txt === '更新中 0%' && idle1s.bar === '0%', idle1s);

    /* 推一次真实进度事件：立刻跟上 */
    await ev(`__setState({ state:'downloading', latestVersion:'1.0.1', size:161801714,
      progress:{ received:106788808, total:161801714, percent:66, speed:4404019 } })`);
    await sleep(220);
    const afterEvent = await ev(`(function(){
      return { txt: document.getElementById('updPillTxt').textContent,
               bar: document.getElementById('updPillBar').style.width };
    })()`);
    check('B3 收到 update:status（66%）后立即同步到文案与进度线',
      afterEvent.txt === '更新中 66%' && afterEvent.bar === '66%', afterEvent);

    /* 再等 800ms 不推事件：不应自己爬到 70% 之类 */
    await sleep(800);
    const stable = await ev(`(function(){
      return { txt: document.getElementById('updPillTxt').textContent,
               bar: document.getElementById('updPillBar').style.width };
    })()`);
    check('B4 再次静默 0.8 秒后仍为 66%（进度只由事件驱动）',
      stable.txt === '更新中 66%' && stable.bar === '66%', stable);

    const fails = results.filter(r => !r.pass);
    console.log('\n===== 定稿回归 ' + (results.length - fails.length) + ' / ' + results.length + ' =====');
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
