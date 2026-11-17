/* 诊断：设置 → 外观设置，「视觉效果」卡与动态追加的「性能与资源」卡交界处重叠 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9226;
const HTML = 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-overlap-' + process.pid);
const OUT = path.join(__dirname, '..', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const url = pathToFileURL(HTML).href;
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, '--window-size=1000,760', url,
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
      if (await ev(`document.readyState === 'complete' && !!document.getElementById('setSeg')`)) break;
      await sleep(200);
    }
    await ev(`(function(){
      var b = document.querySelector('.rail-btn[data-page="settings"]'); if (b) b.click();
      var t = document.querySelector('#setSeg button[data-tab="appearance"]'); if (t) t.click();
      return 1;
    })()`);
    await sleep(1200);

    const data = await ev(`(function(){
      var tab = document.getElementById('tab-appearance');
      var cards = [].slice.call(tab.querySelectorAll('.list-card'));
      function info(el){
        var r = el.getBoundingClientRect(), c = getComputedStyle(el);
        return {
          title: (el.querySelector('.group-title') || {}).textContent || '(无标题)',
          top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), height: +r.height.toFixed(1),
          marginTop: c.marginTop, marginBottom: c.marginBottom, paddingTop: c.paddingTop, paddingBottom: c.paddingBottom,
          position: c.position, zIndex: c.zIndex, overflow: c.overflow, transform: c.transform,
          backdrop: c.backdropFilter || c.webkitBackdropFilter, boxShadow: c.boxShadow.slice(0, 80)
        };
      }
      var pages = document.querySelector('.pages');
      return {
        cards: cards.map(info),
        gaps: cards.slice(1).map(function(c, i){
          return +(c.getBoundingClientRect().top - cards[i].getBoundingClientRect().bottom).toFixed(1);
        }),
        pagesScrollTop: pages ? pages.scrollTop : null,
        pagesScrollHeight: pages ? pages.scrollHeight : null,
        pagesClientHeight: pages ? pages.clientHeight : null,
        lastRow: (function(){
          var rows = cards[cards.length - 2].querySelectorAll('.opt-row');
          var el = rows[rows.length - 1]; var r = el.getBoundingClientRect();
          return { top:+r.top.toFixed(1), bottom:+r.bottom.toFixed(1), text:el.textContent.trim().slice(0,40) };
        })()
      };
    })()`);

    /* 把交界处滚到视口中部，再截一张图 */
    /* 把视口拉高，让最后两张卡片整块都在视口里，避免滚动 + clip 坐标错位 */
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1400, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const clip = await ev(`(function(){
      var cards = document.querySelectorAll('#tab-appearance .list-card');
      var prev = cards[cards.length - 2].getBoundingClientRect();
      var r = cards[cards.length - 1].getBoundingClientRect();
      return { x: Math.max(0, Math.round(r.left - 10)), y: Math.max(0, Math.round(prev.bottom - 90)),
               w: Math.min(960, Math.round(r.width + 20)), h: 200 };
    })()`);
    fs.mkdirSync(OUT, { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 } });
    const shotPath = path.join(OUT, process.env.OVERLAP_SHOT || 'overlap-before.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));

    console.log(JSON.stringify({ ...data, clip, shotPath }, null, 2));
    ws.close();
  } finally {
    try { edge.kill(); } catch (_) {}
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(e => { console.error('DIAG FAILED:', e.message); process.exit(1); });
