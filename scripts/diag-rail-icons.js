/* 诊断侧栏图标线条的明暗一致性：截图 → 浏览器 canvas 取样 → 每个图标算背景亮度/线条亮度/对比度 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9227;
const HTML = process.env.RAIL_HTML || 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-rail-' + process.pid);
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
      if (await ev(`document.readyState === 'complete' && !!document.querySelector('.rb-ico')`)) break;
      await sleep(200);
    }
    await ev(`(function(){
      var d = document.documentElement;
      d.setAttribute('data-glow','off');
      var r = document.querySelector('.rail'); if (r) r.classList.add('open');
      var g = document.getElementById('glow'); if (g) g.style.display = 'none';
      return 1;
    })()`);
    await sleep(1000);
    /* 等侧栏展开动画彻底停下，否则 meta 的坐标和随后截图的坐标会错位 */
    let lastX = null;
    for (let i = 0; i < 25; i++) {
      const x = await ev(`(function(){var e=document.querySelector('.rb-ico');return e?+e.getBoundingClientRect().x.toFixed(2):null})()`);
      if (x !== null && lastX !== null && Math.abs(x - lastX) < 0.05) break;
      lastX = x; await sleep(160);
    }

    const meta = await ev(`(function(){
      var btns = [].slice.call(document.querySelectorAll('.rail-btn[data-page]'));
      return btns.map(function(b){
        var ico = b.querySelector('.rb-ico'), svg = ico.querySelector('svg');
        var r = ico.getBoundingClientRect(), c = getComputedStyle(svg);
        var shape = svg.querySelector('path') || svg.querySelector('circle');
        var cs = shape ? getComputedStyle(shape) : null;
        return {
          page: b.getAttribute('data-page'),
          x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
          color: getComputedStyle(b).color,
          strokeWidth: c.strokeWidth,
          shapeStrokeWidth: cs ? cs.strokeWidth : null,
          vectorEffect: cs ? cs.vectorEffect : null,
          svgSize: +r.width.toFixed(1),
          active: b.classList.contains('active')
        };
      });
    })()`);

    /* 截图标列，再用页面里的 canvas 解码 PNG 取样，避免额外图像库 */
    const clip = {
      x: Math.max(0, Math.round(Math.min.apply(null, meta.map(m => m.x)) - 8)),
      y: Math.max(0, Math.round(Math.min.apply(null, meta.map(m => m.y)) - 8)),
      width: Math.round(Math.max.apply(null, meta.map(m => m.w)) + 16),
      height: Math.round(Math.max.apply(null, meta.map(m => m.y + m.h)) - Math.min.apply(null, meta.map(m => m.y)) + 16),
    };
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { ...clip, scale: 2 } });
    fs.mkdirSync(OUT, { recursive: true });
    const shotPath = path.join(OUT, process.env.RAIL_SHOT || 'rail-icons-before.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
    const b64 = shot.result.data;

    const expr = `(async function(){
      var img = new Image();
      img.src = 'data:image/png;base64,${b64}';
      await img.decode();
      var c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      var d = ctx.getImageData(0,0,c.width,c.height).data, W = c.width;
      var meta = ${JSON.stringify(meta)};
      var clip = ${JSON.stringify(clip)};
      var S = 2; /* deviceScaleFactor */
      function lum(x,y){ var i=(y*W+x)*4; return .299*d[i] + .587*d[i+1] + .114*d[i+2]; }
      return meta.map(function(m){
        var x0 = Math.round((m.x - clip.x) * S), y0 = Math.round((m.y - clip.y) * S);
        var w = Math.round(m.w * S), h = Math.round(m.h * S), vals = [];
        for (var y=y0; y<y0+h; y++) for (var x=x0; x<x0+w; x++) vals.push(lum(x,y));
        var sorted = vals.slice().sort(function(a,b){return a-b});
        var bg = sorted[Math.floor(sorted.length * .45)];
        var top = sorted.slice(-Math.max(12, Math.floor(sorted.length * .07)));
        var line = top.reduce(function(a,b){return a+b},0) / top.length;
        var peakN = Math.max(4, Math.floor(sorted.length * .01));
        var peak = sorted.slice(-peakN).reduce(function(a,b){return a+b},0) / peakN;
        var lit = vals.filter(function(v){return v > bg + 12});
        var lineMean = lit.reduce(function(a,b){return a+b},0) / Math.max(1, lit.length);
        return { page:m.page, active:m.active, color:m.color, strokeWidth:m.strokeWidth,
                 bg:+bg.toFixed(1), line:+line.toFixed(1), peak:+peak.toFixed(1),
                 max:+sorted[sorted.length-1].toFixed(1), lineMean:+lineMean.toFixed(1),
                 contrast:+(line-bg).toFixed(1), linePx:lit.length,
                 coverage:+(lit.length/vals.length).toFixed(3) };
      });
    })()`;
    const pixels = await ev(expr);
    /* 顺带确认 7 套主题下 color-mix 都能解析成实色，且亮度不会跑偏 */
    const themes = await ev(`(function(){
      var d = document.documentElement, old = d.getAttribute('data-theme'), out = {};
      /* 关掉过渡再切主题，否则 getComputedStyle 读到的是 oklab 插值中间色 */
      var st = document.createElement('style');
      st.textContent = '*{transition:none !important;animation:none !important}';
      document.head.appendChild(st);
      ['green','azure','white','sky','dark','amber','lavender'].forEach(function(t){
        d.setAttribute('data-theme', t);
        var c = getComputedStyle(document.querySelector('.rail-btn[data-page="install"]')).color;
        var m = c.match(/[\\d.]+/g) || [];
        var a = m.slice(0,3).map(Number);
        var lum = a.length === 3 ? Math.round(.299*a[0] + .587*a[1] + .114*a[2]) : null;
        /* color(srgb ...) 是 0~1，需要乘 255 */
        if (a.length === 3 && a[0] <= 1 && a[1] <= 1 && a[2] <= 1) lum = Math.round((.299*a[0] + .587*a[1] + .114*a[2]) * 255);
        out[t] = { color:c, lum:lum };
      });
      d.setAttribute('data-theme', old);
      st.remove();
      return out;
    })()`);
    console.log(JSON.stringify({ clip, shotPath, icons: pixels, themes }, null, 2));
    ws.close();
  } finally {
    try { edge.kill(); } catch (_) {}
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(e => { console.error('DIAG FAILED:', e.message); process.exit(1); });
