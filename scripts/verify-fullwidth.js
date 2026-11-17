/* 验证：放大/全屏后各页面（含设置各 tab、详情页、侧栏展开/收起）内容是否铺满 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9229;
const HTML = process.env.FULL_HTML || 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-fw-' + process.pid);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 量一个容器里所有顶层可见块的右边缘，返回最大空隙 */
const MEASURE = `(function(sel){
  var root = document.querySelector(sel);
  if (!root) return { err: 'no root ' + sel };
  var rr = root.getBoundingClientRect();
  var kids = [].slice.call(root.children).filter(function(el){
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  });
  var maxRight = 0, minLeft = 1e9;
  kids.forEach(function(el){
    var r = el.getBoundingClientRect();
    if (r.width < 20) return;
    maxRight = Math.max(maxRight, r.right);
    minLeft = Math.min(minLeft, r.left);
  });
  return {
    rootLeft: Math.round(rr.left), rootRight: Math.round(rr.right), rootW: Math.round(rr.width),
    contentLeft: Math.round(minLeft), contentRight: Math.round(maxRight),
    leftGap: Math.round(minLeft - rr.left), rightGap: Math.round(rr.right - maxRight),
    kids: kids.length
  };
})`;

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

    const report = [];
    const WIDTHS = (process.env.FULL_WIDTHS || '1280,1920').split(',').map(Number);
    for (const W of WIDTHS) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1000, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      for (const pg of ['home', 'online', 'install', 'resources', 'settings']) {
        await ev(`(function(){ var b=document.querySelector('.rail-btn[data-page="${pg}"]'); if(b)b.click(); return 1; })()`);
        await sleep(220);
        const d = await ev(MEASURE + `('.page.active')`);
        report.push({ win: W, view: pg, ...d });
      }
      /* 设置里的三个 tab */
      await ev(`(function(){ var b=document.querySelector('.rail-btn[data-page="settings"]'); if(b)b.click(); return 1; })()`);
      for (const tab of ['general', 'appearance', 'about']) {
        await ev(`(function(){ var t=document.querySelector('#setSeg button[data-tab="${tab}"]'); if(t)t.click(); return 1; })()`);
        await sleep(220);
        const d = await ev(MEASURE + `('#tab-${tab}')`);
        report.push({ win: W, view: 'tab-' + tab, ...d });
      }
      /* 版本详情页：直接切到 active 量一次（不依赖真实版本数据） */
      await ev(`(function(){
        [].slice.call(document.querySelectorAll('.page')).forEach(function(p){ p.classList.remove('active'); });
        var d = document.getElementById('page-detail'); if (d) d.classList.add('active');
        return 1;
      })()`);
      await sleep(200);
      const dd = await ev(MEASURE + `('#page-detail')`);
      report.push({ win: W, view: 'detail', ...dd });

      /* 侧栏展开态再测一次主页与联机。等 .pages 宽度稳定再取样，
         否则展开动画中间态会被误读成布局差异。 */
      await ev(`(function(){ var b=document.getElementById('railToggle'); if(b && !document.querySelector('.rail.open')) b.click(); return 1; })()`);
      let last = -1, stable = 0;
      for (let i = 0; i < 40 && stable < 4; i++) {
        const w = await ev(`Math.round(document.getElementById('pages').getBoundingClientRect().width)`);
        stable = (w === last) ? stable + 1 : 0;
        last = w;
        await sleep(90);
      }
      for (const pg of ['home', 'online']) {
        await ev(`(function(){ var b=document.querySelector('.rail-btn[data-page="${pg}"]'); if(b)b.click(); return 1; })()`);
        await sleep(220);
        const d = await ev(MEASURE + `('.page.active')`);
        report.push({ win: W, view: 'pinned-' + pg, ...d });
      }
      await ev(`(function(){ var b=document.getElementById('railToggle'); if(b && document.querySelector('.rail.open')) b.click(); return 1; })()`);
      await sleep(650);
    }

    /* 兜底：全站还有没有写死 1020px 的内联样式 / CSS 规则 */
    const leftovers = await ev(`(function(){
      var inline = document.querySelectorAll('[style*="1020px"]').length;
      var css = 0;
      [].slice.call(document.styleSheets).forEach(function(ss){
        try { [].slice.call(ss.cssRules).forEach(function(r){ if (r.cssText && r.cssText.indexOf('1020px') >= 0) css++; }); } catch(e) {}
      });
      var cv = getComputedStyle(document.documentElement).getPropertyValue('--content-max').trim();
      return { inline1020: inline, cssRules1020: css, contentMax: cv };
    })()`);

    console.log(JSON.stringify({ report, leftovers }, null, 2));
    ws.close();
  } finally {
    try { edge.kill(); } catch (_) {}
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(e => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
