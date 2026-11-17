/**
 * 验证启动器「重启并更新」胶囊：出现位置、hover 小叉、点击小叉关闭。
 * 用法：node scripts/verify-upd-ui.cjs [端口]
 */
const fs = require('fs');
const path = require('path');
const PORT = process.argv[2] || 9260;
const SHOTS = path.resolve(__dirname, '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url));
    } catch (_) {}
    if (!page) await sleep(500);
  }
  if (!page) { console.error('找不到页面'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0;
  const send = (method, params) => new Promise((res) => {
    const my = ++id;
    const f = (ev) => { const m = JSON.parse(ev.data); if (m.id === my) { ws.removeEventListener('message', f); res(m.result); } };
    ws.addEventListener('message', f);
    ws.send(JSON.stringify({ id: my, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) return { __error: r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (n, clip) => {
    const p = { format: 'png', fromSurface: true };
    if (clip) p.clip = Object.assign({ scale: 1 }, clip);
    const r = await send('Page.captureScreenshot', p);
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, n), Buffer.from(r.data, 'base64'));
    console.log('  截图 ' + n);
  };

  console.log('页面:', page.url);
  await sleep(1500);

  console.log('1) 触发检查更新');
  console.log('   ', JSON.stringify(await ev(`window.FMBridge.invoke('update:check', {force:true})`)));
  await sleep(1200);

  const st = await ev(`(function(){
    var pill = document.getElementById('updPill');
    if (!pill) return { missing: true };
    var r = pill.getBoundingClientRect();
    var cs = getComputedStyle(pill);
    var btns = document.querySelectorAll('.win-btn, .wbtn, .win-controls button');
    var closeBtn = null;
    btns.forEach(function(b){ var t=(b.getAttribute('title')||'') + (b.className||''); if (/关闭|close/i.test(t)) closeBtn = b; });
    var cr = closeBtn ? closeBtn.getBoundingClientRect() : null;
    return {
      display: cs.display, opacity: cs.opacity, visibility: cs.visibility,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      text: (pill.innerText || '').replace(/\\s+/g, ' ').trim(),
      closeBtn: cr ? { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width) } : null,
      closeLeftOfPill: cr ? (r.right <= cr.x + 1) : null
    };
  })()`);
  console.log('2) 胶囊状态:', JSON.stringify(st, null, 0));
  await shot('upd-pill.png', { x: 0, y: 0, width: 1400, height: 120 });

  // hover 到胶囊上，看小叉
  if (st && st.rect) {
    const cx = st.rect.x + st.rect.w / 2;
    const cy = st.rect.y + st.rect.h / 2;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, buttons: 0 });
    await sleep(500);
    const x = await ev(`(function(){ var e=document.getElementById('updPillX'); if(!e) return {missing:true};
      var r=e.getBoundingClientRect(); var cs=getComputedStyle(e);
      return { opacity: cs.opacity, visibility: cs.visibility, w: Math.round(r.width), h: Math.round(r.height),
               x: Math.round(r.x), y: Math.round(r.y) }; })()`);
    console.log('3) hover 后小叉:', JSON.stringify(x));
    await shot('upd-pill-hover.png', { x: Math.max(0, st.rect.x - 60), y: 0, width: 520, height: 120 });

    // 点小叉
    console.log('4) 点击小叉:', JSON.stringify(await ev(`(function(){ document.getElementById('updPillX').click(); return 1; })()`)));
    await sleep(900);
    const after = await ev(`(function(){ var p=document.getElementById('updPill');
      return { display: getComputedStyle(p).display, vis: getComputedStyle(p).visibility, text: (p.innerText||'').trim().slice(0,20) }; })()`);
    console.log('   关闭后:', JSON.stringify(after));
    await shot('upd-pill-closed.png', { x: 0, y: 0, width: 1400, height: 120 });
  }

  ws.close();
  process.exit(0);
})();
