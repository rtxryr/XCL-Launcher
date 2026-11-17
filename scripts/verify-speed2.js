/* 补充验证：干净 reload 后逐档测展开（排除点击副作用）、无动画档全站零过渡扫描、设置页放大截图 */
const fs = require('fs');
const path = require('path');
const PORT = 9223;
const OUT = path.join(__dirname, '..', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let wsUrl;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && /^file:/i.test(t.url));
      if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
    } catch (_) {}
    await sleep(300);
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
  await new Promise(res => ws.addEventListener('open', res, { once: true }));
  await send('Page.enable'); await send('Runtime.enable');
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const shot = async (name, clip) => {
    fs.mkdirSync(OUT, { recursive: true });
    const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
    if (clip) Object.assign(params, { clip });
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    return name;
  };
  const ready = async () => {
    for (let i = 0; i < 60; i++) { if (await ev(`!!document.getElementById('speedSeg')`)) return; await sleep(200); }
    throw new Error('页面未就绪');
  };

  const out = {};

  /* 1) 干净状态 + 切到设置页 + 重取 segRect 截图 */
  await ev(`(function(){try{['mc.animSpeed','mc.railSpeed','mc.rail','mc.railPin','mc.setTab'].forEach(function(k){localStorage.removeItem(k)})}catch(e){}return 1})()`);
  await send('Page.reload', { ignoreCache: true });
  await ready(); await sleep(800);
  await ev(`(function(){var b=document.querySelector('.rail-btn[data-page="settings"]');if(b)b.click();return 1})()`);
  await sleep(700);
  const rect = await ev(`(function(){var s=document.getElementById('speedSeg'),b=s.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}})()`);
  out.segRect = rect;
  out.shotSettings = await shot('speed-settings2.png');
  out.shotSeg = await shot('speed-seg-zoom2.png', {
    x: Math.max(0, rect.x - 20), y: Math.max(0, rect.y - 70),
    width: Math.min(1000, rect.w + 40), height: Math.max(150, rect.h + 105), scale: 2
  });

  /* 2) 无动画档：全站扫描是否还有非零的过渡 / 动画 / 延迟 */
  await ev(`(function(){localStorage.setItem('mc.animSpeed','none');return 1})()`);
  await send('Page.reload', { ignoreCache: true });
  await ready(); await sleep(700);
  out.noneScan = await ev(`(function(){
    var nz=function(s){return /(^|[,\\s])(0?\\.[1-9]|[1-9])/.test(s||'')};
    var bad=[],checked=0;
    var els=document.querySelectorAll('body *');
    for(var i=0;i<els.length;i++){
      var e=els[i],cs=getComputedStyle(e);checked++;
      if(nz(cs.transitionDuration)||nz(cs.animationDuration)||nz(cs.transitionDelay)||nz(cs.animationDelay)){
        if(bad.length<8) bad.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,60),
          td:cs.transitionDuration,ad:cs.animationDuration,dl:cs.transitionDelay});
      }
    }
    return {checked:checked,badCount:bad.length,samples:bad,k:getComputedStyle(document.documentElement).getPropertyValue('--anim-k').trim()};
  })()`);

  /* 3) 干净 reload 逐档测展开：避免任何按钮点击带来的 document click 副作用 */
  async function cleanExpand(mode) {
    await ev(`(function(){localStorage.setItem('mc.animSpeed','${mode}');return 1})()`);
    await send('Page.reload', { ignoreCache: true });
    await ready(); await sleep(900);
    const before = await ev(`Math.round(document.getElementById('rail').getBoundingClientRect().width)`);
    await ev(`(function(){document.getElementById('railToggle').click();return 1})()`);
    await sleep(35);
    const at35 = await ev(`Math.round(document.getElementById('rail').getBoundingClientRect().width)`);
    await sleep(1500);
    const atEnd = await ev(`Math.round(document.getElementById('rail').getBoundingClientRect().width)`);
    return { mode: mode, speed: await ev(`document.documentElement.getAttribute('data-speed')`), before: before, at35ms: at35, atEnd: atEnd };
  }
  out.expands = [];
  for (const m of ['none', 'ultra', 'fast', 'mid', 'slow', 'slowest']) out.expands.push(await cleanExpand(m));

  /* 4) 无动画档展开态截图 */
  await shot('speed-none-expanded.png');
  await ev(`(function(){try{localStorage.removeItem('mc.animSpeed')}catch(e){}return 1})()`);

  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch(e => { console.error('验证失败:', e.message); process.exit(1); });
