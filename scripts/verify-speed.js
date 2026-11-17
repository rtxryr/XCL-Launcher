/* 无头 Edge + CDP：验证「全局响应速度」6 档
   重点：calc(X * var(--anim-k)) 在 transition / animation 简写里能否被 Chromium 正确解析，
        以及无动画档侧栏是否真的「直接到位」没有任何中间帧。 */
const fs = require('fs');
const path = require('path');
const PORT = 9223;
const OUT = path.join(__dirname, '..', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let wsUrl;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && /^file:/i.test(t.url));
      if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
    } catch (_) {}
    await sleep(300);
  }
  if (!wsUrl) throw new Error('CDP 未就绪');

  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiters = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  await new Promise(res => ws.addEventListener('open', res, { once: true }));
  await send('Page.enable');
  await send('Runtime.enable');

  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('JS 异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    }
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const shot = async (name, clip) => {
    fs.mkdirSync(OUT, { recursive: true });
    const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
    if (clip) Object.assign(params, { clip });
    const r = await send('Page.captureScreenshot', params);
    if (!r.result || !r.result.data) throw new Error('截图失败: ' + JSON.stringify(r).slice(0, 200));
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    return name;
  };

  /* 干净状态：清掉持久化，硬刷新 */
  await ev(`(function(){ try{ localStorage.removeItem('mc.animSpeed'); localStorage.removeItem('mc.railSpeed'); localStorage.removeItem('mc.rail'); localStorage.removeItem('mc.railPin'); localStorage.removeItem('mc.setTab'); }catch(e){} return 1 })()`);
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 60; i++) {
    if (await ev(`!!document.getElementById('speedSeg')`)) break;
    await sleep(200);
  }
  await sleep(900);

  const out = {};

  /* 1) UI 结构 */
  out.ui = await ev(`(function(){
    var seg=document.getElementById('speedSeg');
    if(!seg) return {err:'speedSeg 不存在'};
    var btns=[].slice.call(seg.querySelectorAll('button'));
    var g=document.getElementById('tab-general'), a=document.getElementById('tab-appearance');
    return {
      count:btns.length,
      labels:btns.map(function(b){return b.textContent.trim()}),
      inGeneral:!!g&&g.contains(seg),
      inAppearance:!!a&&a.contains(seg),
      oldRailSeg:!!document.getElementById('railSeg'),
      hint:(document.getElementById('speedHint')||{}).textContent,
      defaultSpeed:document.documentElement.getAttribute('data-speed'),
      defaultOn:(seg.querySelector('button.on')||{}).textContent,
      segOverflow:seg.scrollWidth>seg.clientWidth+1,
      wrapped:btns.length>1 && btns[0].offsetTop!==btns[btns.length-1].offsetTop,
      segRect:(function(){var b=seg.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}})()
    };
  })()`);

  /* 切到设置页，截 6 档按钮 */
  await ev(`(function(){var b=document.querySelector('.rail-btn[data-page="settings"]');if(b)b.click();return 1})()`);
  await sleep(700);
  out.ui.settingsShown = await ev(`!!document.querySelector('#page-settings.active, #settings.active') || !document.getElementById('tab-general').closest('[hidden]')`);
  const r = out.ui.segRect || { x: 0, y: 0, w: 600, h: 60 };
  out.shotSettings = await shot('speed-settings.png');
  out.shotSeg = await shot('speed-seg-zoom.png', {
    x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 60),
    width: Math.min(900, r.w + 40), height: Math.max(120, r.h + 90), scale: 2
  });

  /* 2) 逐档点按钮，读真实 computed 时长 */
  const mods = ['none', 'ultra', 'fast', 'mid', 'slow', 'slowest'];
  out.modes = [];
  for (const mode of mods) {
    await ev(`(function(){var b=document.querySelector('#speedSeg button[data-speed="${mode}"]');if(b)b.click();return 1})()`);
    await sleep(80);
    out.modes.push(await ev(`(function(){
      var d=document.documentElement, cs=getComputedStyle(d);
      var rail=document.getElementById('rail'), rs=getComputedStyle(rail);
      var btn=document.querySelector('#speedSeg button'), bs=getComputedStyle(btn);
      var pg=document.querySelector('.page.active')||document.querySelector('.page');
      var ps=pg?getComputedStyle(pg):null;
      var brand=document.querySelector('.rail-brand'), br=brand?getComputedStyle(brand):null;
      var orb=document.querySelector('.bg .orb'), os=orb?getComputedStyle(orb):null;
      return {
        speed:d.getAttribute('data-speed'),
        k:cs.getPropertyValue('--anim-k').trim(),
        railVar:cs.getPropertyValue('--rail-dur').trim(),
        railDur:rs.transitionDuration,
        railDelay:rs.transitionDelay,
        btnDur:bs.transitionDuration,
        brandDur:br?br.transitionDuration:null,
        pageAnimName:ps?ps.animationName:null,
        pageAnimDur:ps?ps.animationDuration:null,
        orbAnimName:os?os.animationName:null,
        orbAnimDur:os?os.animationDuration:null,
        animMs320:window.animMs(320),
        saved:localStorage.getItem('mc.animSpeed'),
        on:(document.querySelector('#speedSeg button.on')||{}).textContent,
        hint:(document.getElementById('speedHint')||{}).textContent
      };
    })()`));
  }

  /* 3) 展开即时性：无动画应第一帧就到位；慢档应有中间帧 */
  async function expandWidth(mode) {
    await ev(`(function(){
      var b=document.querySelector('#speedSeg button[data-speed="${mode}"]');if(b)b.click();
      var rail=document.getElementById('rail');
      if(rail.classList.contains('open')) document.getElementById('railToggle').click();
      return 1;
    })()`);
    await sleep(750);
    const before = await ev(`Math.round(document.getElementById('rail').getBoundingClientRect().width)`);
    await ev(`(function(){document.getElementById('railToggle').click();return 1})()`);
    await sleep(35);
    const w35 = await ev(`Math.round(document.getElementById('rail').getBoundingClientRect().width)`);
    await sleep(1000);
    const wEnd = await ev(`Math.round(document.getElementById('rail').getBoundingClientRect().width)`);
    return { before: before, at35ms: w35, atEnd: wEnd };
  }
  out.expandNone = await expandWidth('none');
  out.expandSlow = await expandWidth('slow');
  out.expandSlowest = await expandWidth('slowest');

  /* 4) 旧键迁移 */
  out.migration = await ev(`(function(){
    try{ localStorage.setItem('mc.railSpeed','fast'); localStorage.removeItem('mc.animSpeed'); }catch(e){}
    return 1;
  })()`);
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 60; i++) {
    if (await ev(`!!document.getElementById('speedSeg')`)) break;
    await sleep(200);
  }
  await sleep(700);
  out.migrated = await ev(`(function(){
    return { speed:document.documentElement.getAttribute('data-speed'),
             on:(document.querySelector('#speedSeg button.on')||{}).textContent,
             saved:localStorage.getItem('mc.animSpeed') };
  })()`);

  /* 还原干净状态，别把测试档位留在页面里 */
  await ev(`(function(){try{localStorage.removeItem('mc.railSpeed');localStorage.removeItem('mc.animSpeed');}catch(e){}return 1})()`);

  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch(e => { console.error('验证失败:', e.message); process.exit(1); });
