/* 诊断：窗口放大后，各页面内容右边缘与窗口右边缘之间的空白 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9228;
const HTML = process.env.FULL_HTML || 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-full-' + process.pid);
const OUT = path.join(__dirname, '..', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EXPR = `(function(){
  var W = innerWidth;
  var pages = document.querySelector('.pages');
  var pr = pages.getBoundingClientRect();
  var rail = document.querySelector('.rail');
  var rr = rail.getBoundingClientRect();
  var act = document.querySelector('.page.active');
  var id = act ? act.id : '(none)';
  /* 收集活动页里所有可见的直接内容块（卡片 / 分组头 / 网格） */
  var els = act ? [].slice.call(act.querySelectorAll('.glass, .sec-head, .home-grid, .res-grid, .ver-list, .empty-state, .fms-card, .fmp-panel, .tab-pane, [style*="max-width"]')) : [];
  var boxes = [];
  els.forEach(function(el){
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    if (r.width < 30 || cs.display === 'none' || cs.visibility === 'hidden') return;
    /* 只取最外层：父级也在列表里的跳过 */
    var p = el.parentElement, nested = false;
    while (p && p !== act) { if (els.indexOf(p) >= 0) { nested = true; break; } p = p.parentElement; }
    if (nested) return;
    boxes.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 45),
                 left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
                 maxW: cs.maxWidth, mLeft: cs.marginLeft, mRight: cs.marginRight });
  });
  var widest = boxes.reduce(function(a, b){ return b.right > a ? b.right : a; }, 0);
  return {
    page: id, winW: W, winH: innerHeight,
    pagesLeft: Math.round(pr.left), pagesRight: Math.round(pr.right), pagesW: Math.round(pr.width),
    railRight: Math.round(rr.right),
    contentRight: widest, rightGap: Math.round(W - widest),
    boxes: boxes.slice(0, 14),
    maxW1020Count: act ? act.querySelectorAll('[style*="1020px"]').length : 0
  };
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
    await sleep(600);

    const widths = (process.env.FULL_WIDTHS || '1280,1920').split(',').map(Number);
    const pages = (process.env.FULL_PAGES || 'home,online,install,resources,settings').split(',');
    const results = [];
    for (const W of widths) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      for (const pg of pages) {
        await ev(`(function(){
          var b = document.querySelector('.rail-btn[data-page="${pg}"]');
          if (b) b.click();
          return 1;
        })()`);
        await sleep(260);
        const d = await ev(EXPR);
        results.push({ win: W, ...d });
      }
    }
    console.log(JSON.stringify(results.map(r => ({
      win: r.win, page: r.page, winW: r.winW, railRight: r.railRight,
      pagesLeft: r.pagesLeft, pagesRight: r.pagesRight, pagesW: r.pagesW,
      contentRight: r.contentRight, rightGap: r.rightGap, maxW1020Count: r.maxW1020Count,
      boxes: r.boxes
    })), null, 2));

    /* 1920 下联机页截一张全屏图 */
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1000, deviceScaleFactor: 1, mobile: false });
    await ev(`(function(){ var b=document.querySelector('.rail-btn[data-page="${process.env.FULL_SHOT_PAGE || 'online'}"]'); if(b)b.click(); return 1; })()`);
    await sleep(700);
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.mkdirSync(OUT, { recursive: true });
    const shotPath = path.join(OUT, process.env.FULL_SHOT || 'fullwidth-before.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
    console.log('SHOT:', shotPath);
    ws.close();
  } finally {
    try { edge.kill(); } catch (_) {}
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(e => { console.error('DIAG FAILED:', e.message); process.exit(1); });
