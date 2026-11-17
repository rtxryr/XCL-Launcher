/* 严格 A/B：同一会话里把 --content-max 在 1020px（旧）与 100%（新）之间切换，
   排除侧栏状态 / 动画时序 / localStorage 差异，只比较内容宽度。 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9230;
const HTML = 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-ab-' + process.pid);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MEASURE = `(function(){
  var W = innerWidth;
  var act = document.querySelector('.page.active');
  var out = [];
  [].slice.call(act.children).forEach(function(el){
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    var r = el.getBoundingClientRect();
    if (r.width < 20) return;
    out.push({ tag:(el.className||el.id||'').toString().slice(0,28),
               left:Math.round(r.left), right:Math.round(r.right), w:Math.round(r.width),
               maxW:cs.maxWidth });
  });
  var pages = document.getElementById('pages').getBoundingClientRect();
  var widest = out.reduce(function(a,b){ return b.right > a ? b.right : a; }, 0);
  return { winW:W, pagesLeft:Math.round(pages.left), pagesRight:Math.round(pages.right),
           contentRight:widest, rightGap:Math.round(W - widest),
           blocks:out };
})()`;

(async () => {
  const url = pathToFileURL(HTML).href;
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, '--window-size=1920,1080', url,
  ], { stdio: 'ignore', windowsHide: true });

  try {
    let wsUrl;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const p = list.find(t => t.type === 'page' && /^file:/i.test(t.url) && /X%20Craft/i.test(t.url));
        if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
      } catch (_) {}
      await sleep(250);
    }
    if (!wsUrl) throw new Error('CDP 页面未就绪');

    const ws = new WebSocket(wsUrl);
    let id = 0; const waiters = new Map();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise(res => {
      const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    });
    await new Promise(res => ws.addEventListener('open', res, { once: true }));
    await send('Page.enable'); await send('Runtime.enable');
    const ev = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result && r.result.result ? r.result.result.value : null;
    };
    for (let i = 0; i < 60; i++) {
      if (await ev(`document.readyState === 'complete' && !!document.getElementById('pages')`)) break;
      await sleep(200);
    }
    await sleep(500);

    const results = [];
    for (const W of [1080, 1920]) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1000, deviceScaleFactor: 1, mobile: false });
      await sleep(280);
      for (const mode of ['old', 'new']) {
        await ev(`document.documentElement.style.setProperty('--content-max', '${mode === 'old' ? '1020px' : '100%'}')`);
        for (const pg of ['home', 'online', 'install', 'resources', 'settings']) {
          await ev(`(function(){ var b=document.querySelector('.rail-btn[data-page="${pg}"]'); if(b)b.click(); return 1; })()`);
          await sleep(160);
          const d = await ev(MEASURE);
          results.push({ win: W, mode, view: pg, rightGap: d.rightGap,
                         contentRight: d.contentRight, pagesRight: d.pagesRight,
                         maxW: d.blocks.map(b => b.maxW).slice(0, 3) });
        }
      }
    }
    console.log(JSON.stringify(results, null, 2));
    ws.close();
  } finally {
    try { edge.kill(); } catch (_) {}
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(e => { console.error('AB FAILED:', e.message); process.exit(1); });
