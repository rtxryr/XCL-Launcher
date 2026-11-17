/* 验证：默认配色=浅蓝、自定义调色盘交互、刷新后恢复、取消不落盘 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9231;
const HTML = process.env.CP_HTML || 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-cp-' + process.pid);
const OUT = path.join(__dirname, '..', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STATE = `(function(){
  var d = document.documentElement, cs = getComputedStyle(d);
  var on = document.querySelector('.sw.on');
  var cp = document.getElementById('cpWrap');
  return {
    theme: d.getAttribute('data-theme'),
    custom: d.getAttribute('data-custom'),
    accent: cs.getPropertyValue('--accent').trim(),
    bg0: cs.getPropertyValue('--bg0').trim(),
    lsTheme: localStorage.getItem('mc.theme'),
    lsColor: localStorage.getItem('mc.customColor'),
    lsBase: localStorage.getItem('mc.customBase'),
    lsDefSky: localStorage.getItem('mc.themeDefSky'),
    activeSwatch: on ? on.dataset.theme : null,
    popTheme: (document.getElementById('popTheme') || {}).textContent,
    swatches: document.querySelectorAll('.sw').length,
    presets: document.querySelectorAll('#cpPresets button').length,
    cpOpen: cp ? !cp.hidden : false,
    cpOn: cp ? cp.classList.contains('on') : false,
    cpHex: (document.getElementById('cpHex') || {}).value,
    cpPrevHex: (document.getElementById('cpPrevHex') || {}).textContent,
    inlineVars: d.style.length
  };
})()`;

(async () => {
  const url = pathToFileURL(HTML).href;
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, '--window-size=1280,900', url,
  ], { stdio: 'ignore', windowsHide: true });

  let ws;
  try {
    let wsUrl;
    for (let i = 0; i < 70; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const p = list.find(t => t.type === 'page' && /^file:/i.test(t.url) && /X%20Craft/i.test(t.url));
        if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
      } catch (_) {}
      await sleep(250);
    }
    if (!wsUrl) throw new Error('CDP 页面未就绪');

    ws = new WebSocket(wsUrl);
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
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result && r.result.result ? r.result.result.value : null;
    };
    const ready = async () => {
      for (let i = 0; i < 70; i++) {
        try { if (await ev(`document.readyState === 'complete' && !!document.getElementById('cpWrap')`)) break; } catch (_) {}
        await sleep(200);
      }
      await sleep(450);
    };
    const shot = async name => {
      const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      if (!r.result || !r.result.data) return null;
      const f = path.join(OUT, name);
      fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
      return f;
    };
    const gotoAppearance = () => ev(`(function(){
      var r = document.querySelector('.rail-btn[data-page="settings"]'); if (r) r.click();
      var b = document.querySelector('#setSeg button[data-tab="appearance"]'); if (b) b.click();
      return 1;
    })()`);

    await ready();
    const R = {};
    R['1_全新默认'] = await ev(STATE);
    await gotoAppearance(); await sleep(350);
    R['1_默认截图'] = await shot('theme-default-sky.png');

    /* 旧默认 green 一次性迁移 */
    await ev(`localStorage.setItem('mc.theme','green'); localStorage.removeItem('mc.themeDefSky'); location.reload(); 1`);
    await ready();
    R['2_旧默认green迁移后'] = await ev(STATE);

    /* 用户主动选过 lavender 要保留 */
    await ev(`localStorage.setItem('mc.themeDefSky','1'); localStorage.setItem('mc.theme','lavender'); location.reload(); 1`);
    await ready();
    R['3_用户选择lavender保留'] = await ev(STATE);

    /* 清干净，回到默认浅蓝，进外观设置 */
    await ev(`localStorage.clear(); location.reload(); 1`);
    await ready();
    await gotoAppearance(); await sleep(300);

    /* 打开调色盘 */
    await ev(`document.getElementById('cpSwatch').click()`);
    await sleep(400);
    R['4_打开调色盘'] = await ev(STATE);
    R['4_调色盘截图'] = await shot('theme-picker-open.png');

    /* HEX 输入 */
    await ev(`(function(){var i=document.getElementById('cpHex');i.value='#FF6B8A';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
    await sleep(180);
    R['5_HEX输入珊瑚色'] = await ev(STATE);

    /* 深色底 */
    await ev(`document.querySelector('#cpBase button[data-base="dark"]').click()`);
    await sleep(180);
    R['6_切换深色底'] = await ev(STATE);

    /* 真实鼠标拖动色相条 + SV 面板 */
    const rects = await ev(`(function(){
      var a=document.getElementById('cpHue').getBoundingClientRect();
      var b=document.getElementById('cpSV').getBoundingClientRect();
      return {hue:{x:a.x,y:a.y,w:a.width,h:a.height}, sv:{x:b.x,y:b.y,w:b.width,h:b.height}};
    })()`);
    const drag = async (r, fx, fy) => {
      const x1 = Math.round(r.x + r.w * fx), y = Math.round(r.y + r.h * fy);
      await send('Input.dispatchMouseEvent', { type:'mousePressed', x:x1, y, button:'left', buttons:1, clickCount:1 });
      await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:x1 + 12, y, button:'left', buttons:1 });
      await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:x1 + 12, y, button:'left', buttons:0, clickCount:1 });
      await sleep(160);
    };
    await drag(rects.hue, 0.32, 0.5);
    R['7_拖动色相条'] = await ev(STATE);
    await drag(rects.sv, 0.35, 0.4);
    R['8_拖动SV面板'] = await ev(STATE);
    R['8_深色底预览截图'] = await shot('theme-picker-dark.png');

    /* 取消：应恢复浅蓝，且不写 localStorage */
    await ev(`document.getElementById('cpCancel').click()`);
    await sleep(400);
    R['9_取消后'] = await ev(STATE);

    /* 重新打开，选预设「薄荷」+ 浅色底，应用 */
    await ev(`document.getElementById('cpSwatch').click()`);
    await sleep(350);
    await ev(`document.querySelector('#cpPresets button[data-color="#38C6A0"]').click()`);
    await sleep(160);
    R['10_预设薄荷预览'] = await ev(STATE);
    await ev(`document.getElementById('cpApply').click()`);
    await sleep(400);
    R['11_应用自定义'] = await ev(STATE);
    R['11_应用后截图'] = await shot('theme-custom-applied.png');
    await ev(`document.querySelector('.rail-btn[data-page="home"]').click()`);
    await sleep(320);
    R['11b_自定义色主页截图'] = await shot('theme-custom-home.png');

    /* 刷新：首屏恢复自定义（不闪烁） */
    await ev(`location.reload(); 1`);
    await ready();
    R['12_刷新后恢复自定义'] = await ev(STATE);
    await gotoAppearance(); await sleep(300);
    R['12_刷新后外观页截图'] = await shot('theme-custom-after-reload.png');

    /* 自定义 → 切回预设：行内变量应清干净 */
    await ev(`document.querySelector('.sw[data-theme="sky"]').click()`);
    await sleep(250);
    R['13_切回浅蓝'] = await ev(STATE);

    /* 前几轮改动仍在 */
    R['14_前几轮改动'] = await ev(`(function(){
      var s = document.documentElement.outerHTML;
      return {
        拖选屏蔽: document.querySelector('style') ? true : false,
        卡片间距: !!document.querySelector('.glass.list-card[style*="margin-bottom:16px"]'),
        图标实色: getComputedStyle(document.querySelector('.rail-btn') || document.body).color,
        内容铺满: getComputedStyle(document.documentElement).getPropertyValue('--content-max').trim(),
        自定义色卡: document.querySelectorAll('.sw').length
      };
    })()`);

    /* 各种颜色下，强调色上的文字用深色还是白色 */
    await gotoAppearance(); await sleep(250);
    await ev(`document.getElementById('cpSwatch').click()`);
    await sleep(300);
    const inks = [];
    for (const hex of ['#0F9FCD','#6FE08A','#F2C94C','#FF6B8A','#38C6A0','#101317','#5FB2F5']) {
      await ev(`(function(){var i=document.getElementById('cpHex');i.value='${hex}';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
      await sleep(90);
      const v = await ev(`(function(){var cs=getComputedStyle(document.documentElement);return {
        accent:cs.getPropertyValue('--accent').trim(),
        ink:cs.getPropertyValue('--accent-ink').trim(),
        bg0:cs.getPropertyValue('--bg0').trim()
      };})()`);
      inks.push(Object.assign({ hex }, v));
    }
    R['15_各色按钮文字色'] = inks;
    await ev(`document.getElementById('cpCancel').click()`);

    /* 无动画档下弹窗开合 */
    await ev(`document.documentElement.setAttribute('data-speed','none')`);
    await ev(`document.getElementById('cpSwatch').click()`);
    await sleep(120);
    const openNone = await ev(`!document.getElementById('cpWrap').hidden`);
    await ev(`document.getElementById('cpCancel').click()`);
    await sleep(120);
    const closedNone = await ev(`document.getElementById('cpWrap').hidden`);
    R['16_无动画档弹窗'] = { open: openNone, closed: closedNone };
    await ev(`document.documentElement.setAttribute('data-speed','slow')`);

    console.log(JSON.stringify(R, null, 2));
  } finally {
    try { if (ws) ws.close(); } catch (_) {}
    edge.kill();
  }
})().catch(e => { console.error('FAIL', e); process.exitCode = 1; });
