/* 自测：标题栏「重启并更新」胶囊 + 设置页「更新」「关于」
 *
 * 做法：无头 Edge + CDP，用 Page.addScriptToEvaluateOnNewDocument 在页面脚本
 *       之前注入假的 FMBridge / FMWindow，模拟各种 UpdateState 并主动推事件。
 * 产出：shots/upd-*.png
 *
 * 运行：node scripts/verify-update-ui.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9231;
const HTML = 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-upd-' + process.pid);
const OUT = path.join(__dirname, '..', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 注入脚本：假桥 + 可控状态 */
const FAKE = `
(function(){
  var state = { state:'idle', currentVersion:'1.0.0', latestVersion:null, checkedAt:null };
  var listeners = [];
  window.__calls = [];
  window.__checkResult = { state:'available', latestVersion:'1.0.1', size:161801714,
    notes:'1. 新增「重启并更新」入口\\n2. 设置页新增「更新」与重做的「关于」\\n3. 修复窗口放大后右侧留白' };
  function snap(){ return JSON.parse(JSON.stringify(state)); }
  function emit(){ listeners.forEach(function(cb){ try{ cb(snap()); }catch(e){} }); }
  window.__setState = function(patch, silent){
    state = Object.assign({}, state, patch || {});
    if (!silent) emit();
    return snap();
  };
  window.__reset = function(patch){ state = Object.assign({ state:'idle', currentVersion:'1.0.0',
    latestVersion:null, checkedAt:null, notes:null, size:null, progress:null, message:null }, patch||{}); };
  window.FMBridge = {
    available: true,
    invoke: function(ch, payload){
      window.__calls.push({ ch: ch, payload: payload });
      if (ch === 'app:info') return Promise.resolve({ ok:true, data:{
        appVersion:'1.0.0', electron:'33.2.1', chrome:'130.0.6723.119', node:'20.18.1',
        os:'Windows_NT 10.0.22631 x64', installDir:'E:\\\\任衍瑞\\\\软件开发\\\\XCL', isPackaged:true } });
      if (ch === 'update:state') return Promise.resolve({ ok:true, data: snap() });
      if (ch === 'update:check') return new Promise(function(res){
        setTimeout(function(){
          var next = Object.assign({}, state, window.__checkResult, { checkedAt: Date.now() });
          state = next;
          res({ ok:true, data: snap() });
        }, 900);
      });
      if (ch === 'update:apply') {
        state = Object.assign({}, state, { state:'downloading', progress:{ received:0, total:161801714, percent:0, speed:0 } });
        emit();
        return Promise.resolve({ ok:true, data: snap() });
      }
      if (ch === 'update:dismiss') {
        state = Object.assign({}, state, { state:'dismissed' });
        emit();
        return Promise.resolve({ ok:true, data: snap() });
      }
      if (ch === 'update:cancel') {
        state = Object.assign({}, state, { state:'idle', progress:null });
        emit();
        return Promise.resolve({ ok:true, data: snap() });
      }
      return Promise.resolve({ ok:true, data: snap() });
    },
    on: function(name, cb){ listeners.push(cb); return function(){}; }
  };
  window.FMWindow = {
    available: true,
    minimize: function(){}, toggleMaximize: function(){}, close: function(){},
    onState: function(cb){ try{ cb({ maximized:false, fullscreen:false }); }catch(e){} return function(){}; }
  };
})();
`;

const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra === undefined ? '' : extra });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
}

(async () => {
  const url = pathToFileURL(HTML).href;
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
    const inj = await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
    const INJ_ID = inj.result && inj.result.identifier;
    const pageErrors = [];
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') {
        pageErrors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        pageErrors.push('console.error: ' + m.params.args.map(a => a.value || a.description || '').join(' '));
      }
    });
    await send('Page.navigate', { url });

    const ev = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result && r.result.result ? r.result.result.value : null;
    };
    const shot = async (name, clip, keepHover) => {
      /* 截图前把鼠标挪开，避免悬停态（小叉）污染画面 */
      if (!keepHover) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1, button: 'none' });
        await sleep(260);
      }
      fs.mkdirSync(OUT, { recursive: true });
      const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
      if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 };
      const r = await send('Page.captureScreenshot', params);
      const p = path.join(OUT, name);
      fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
      return p;
    };
    const mouse = (type, x, y, extra) => send('Input.dispatchMouseEvent',
      Object.assign({ type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }, extra || {}));

    for (let i = 0; i < 80; i++) {
      if (await ev(`document.readyState === 'complete' && !!document.getElementById('setSeg')`)) break;
      await sleep(200);
    }
    await sleep(500);

    /* ---------------- 1. idle：胶囊不存在 ---------------- */
    const idle = await ev(`(function(){
      var p = document.getElementById('updPill');
      var r = p.getBoundingClientRect();
      return { hidden: p.hidden, w: r.width, h: r.height, display: getComputedStyle(p).display,
               inDom: !!p, wctl: document.getElementById('wctl').getBoundingClientRect().width };
    })()`);
    check('1a idle 时顶部胶囊 hidden 且零尺寸（不占位）',
      idle.hidden && idle.w === 0 && idle.h === 0 && idle.display === 'none', idle);

    /* ---------------- 2. available：出现、在三键左侧、不重叠 ---------------- */
    await ev(`__setState({ state:'available', latestVersion:'1.0.1', size:161801714,
      notes:'1. 新增「重启并更新」入口\\n2. 设置页新增「更新」与重做的「关于」\\n3. 修复窗口放大后右侧留白',
      checkedAt: Date.now() })`);
    await sleep(300);

    const avail = await ev(`(function(){
      var p = document.getElementById('updPill'), m = document.getElementById('updPillMain');
      var r = p.getBoundingClientRect();
      var bar = document.getElementById('wbar').getBoundingClientRect();
      var btns = [].slice.call(document.querySelectorAll('.wctl-btn')).map(function(b){ return b.getBoundingClientRect(); });
      var minLeft = Math.min.apply(null, btns.map(function(b){ return b.left; }));
      var mid = (r.top + r.bottom) / 2, bmid = (btns[0].top + btns[0].bottom) / 2;
      return { hidden:p.hidden, w:+r.width.toFixed(1), h:+r.height.toFixed(1),
               right:+r.right.toFixed(1), minLeft:+minLeft.toFixed(1), gap:+(minLeft - r.right).toFixed(1),
               sameRow: Math.abs(mid - bmid) < 4, insideBar: r.top >= bar.top - 1 && r.bottom <= bar.bottom + 1,
               txt: document.getElementById('updPillTxt').textContent,
               mode: m.dataset.mode };
    })()`);
    check('2a available 时胶囊出现且文案为「重启并更新」',
      !avail.hidden && avail.txt === '重启并更新' && avail.mode === 'available', avail);
    check('2b 胶囊在三键左侧且留出间距、同一行、不超出标题栏',
      avail.gap > 0 && avail.sameRow && avail.insideBar, avail);

    const clipA = await ev(`(function(){
      var r = document.getElementById('updPill').getBoundingClientRect();
      return { x: Math.max(0, Math.round(r.left - 60)), y: 0, w: Math.min(420, Math.round(innerWidth - r.left + 60)), h: 46 };
    })()`);
    const shotAvail = await shot('upd-pill-available.png', clipA);

    /* ---------------- 3. hover 出小叉，点小叉 → dismiss ---------------- */
    const c = await ev(`(function(){
      var p = document.getElementById('updPill').getBoundingClientRect();
      var x = document.getElementById('updPillX').getBoundingClientRect();
      return { px: p.left + p.width/2, py: p.top + p.height/2, xx: x.left + x.width/2, xy: x.top + x.height/2 };
    })()`);
    /* 无头模式过渡被节流，临时把 --anim-k 归零让 hover 立即到位 */
    await ev(`document.documentElement.style.setProperty('--anim-k','0'); 1`);
    await mouse('mouseMoved', c.px, c.py);
    await sleep(350);
    const hover = await ev(`(function(){
      var x = document.getElementById('updPillX'), r = x.getBoundingClientRect(), s = getComputedStyle(x);
      return { opacity: +s.opacity, pe: s.pointerEvents, w:+r.width.toFixed(1), h:+r.height.toFixed(1),
               borderRadius: s.borderRadius };
    })()`);
    check('3a 悬停后小叉出现（16px 圆形、可点击）',
      hover.opacity > 0.9 && hover.pe === 'auto' && Math.round(hover.w) === 16 && Math.round(hover.h) === 16, hover);
    await shot('upd-pill-hover-x.png', clipA, true);

    /* 先确认小叉不挡住按钮主体：点按钮中心应触发 apply 而不是 dismiss */
    await ev(`window.__calls.length = 0`);
    await mouse('mousePressed', c.px, c.py); await mouse('mouseReleased', c.px, c.py);
    await sleep(250);
    const bodyClick = await ev(`window.__calls.map(function(c){ return c.ch; })`);
    check('3b 点按钮主体触发 update:apply（小叉未挡住主体）', bodyClick.indexOf('update:apply') >= 0, bodyClick);

    /* 回到 available 再点小叉 */
    await ev(`__setState({ state:'available', latestVersion:'1.0.1', checkedAt: Date.now() })`);
    await sleep(250);
    await mouse('mouseMoved', c.px, c.py);
    await sleep(300);
    await ev(`window.__calls.length = 0`);
    await mouse('mousePressed', c.xx, c.xy); await mouse('mouseReleased', c.xx, c.xy);
    await sleep(350);
    const dismiss = await ev(`(function(){
      var p = document.getElementById('updPill');
      return { calls: window.__calls.filter(function(c){ return c.ch === 'update:dismiss'; }),
               hidden: p.hidden, w: p.getBoundingClientRect().width };
    })()`);
    check('3c 点小叉调用 update:dismiss 且胶囊收起',
      dismiss.calls.length === 1 && dismiss.calls[0].payload.version === '1.0.1' && dismiss.hidden && dismiss.w === 0, dismiss);
    await ev(`document.documentElement.style.removeProperty('--anim-k'); 1`);

    /* ---------------- 4. downloading：百分比文案 + 底部进度线 ---------------- */
    await ev(`__setState({ state:'downloading', latestVersion:'1.0.1', size:161801714,
      progress:{ received:67956720, total:161801714, percent:42, speed:4404019 } })`);
    await sleep(300);
    const dl = await ev(`(function(){
      var m = document.getElementById('updPillMain');
      var bar = m.querySelector('.upd-bar'), i = document.getElementById('updPillBar');
      var mr = m.getBoundingClientRect(), br = bar.getBoundingClientRect(), ir = i.getBoundingClientRect();
      return { txt: document.getElementById('updPillTxt').textContent, mode: m.dataset.mode,
               barOpacity: +getComputedStyle(bar).opacity, barH: +br.height.toFixed(1),
               barInside: br.bottom <= mr.bottom - 1 && br.top > mr.top,
               fillPct: +(ir.width / br.width * 100).toFixed(0), radius: getComputedStyle(bar).borderRadius };
    })()`);
    check('4a downloading 文案带百分比', dl.txt === '更新中 42%', dl.txt);
    check('4b 底部 2px 进度线可见且宽度跟随 42%',
      dl.barOpacity === 1 && Math.round(dl.barH) === 2 && dl.barInside && Math.abs(dl.fillPct - 42) <= 2, dl);
    const clipDl = await ev(`(function(){
      var r = document.getElementById('updPill').getBoundingClientRect();
      return { x: Math.max(0, Math.round(r.left - 60)), y: 0, w: Math.min(420, Math.round(innerWidth - r.left + 60)), h: 46 };
    })()`);
    await shot('upd-pill-downloading.png', clipDl);

    /* 4c 其余状态：verifying / ready 出文案，checking / error / skipped 收起 */
    const stateCases = [
      ['verifying', true, '正在校验'],
      ['ready', true, '即将重启'],
      ['checking', false, ''],
      ['error', false, ''],
      ['skipped', false, ''],
    ];
    const stateOut = [];
    for (const [st, wantShow, wantTxt] of stateCases) {
      await ev(`__setState({ state:'${st}', latestVersion:'1.0.1' })`);
      await sleep(220);
      const o = await ev(`(function(){
        var p = document.getElementById('updPill');
        return { hidden:p.hidden, w:+p.getBoundingClientRect().width.toFixed(1),
                 txt: document.getElementById('updPillTxt').textContent,
                 mode: document.getElementById('updPillMain').dataset.mode };
      })()`);
      stateOut.push({ st, wantShow, wantTxt, o });
    }
    const stateBad = stateOut.filter(r => r.wantShow
      ? (r.o.hidden || r.o.txt !== r.wantTxt || r.o.mode !== r.st)
      : (!r.o.hidden || r.o.w !== 0));
    check('4c verifying/ready 显示对应文案；checking/error/skipped 收起且不占位',
      stateBad.length === 0, stateBad);

    /* 4d 服务端没给 Content-Length 时 percent=0，用 received/total 兜底 */
    await ev(`__setState({ state:'downloading', latestVersion:'1.0.1', size:161801714,
      progress:{ received:40450428, total:161801714, percent:0, speed:0 } })`);
    await sleep(250);
    const fallback = await ev(`(function(){
      var pill = document.getElementById('updPillTxt').textContent;
      var bar = document.querySelector('#updOut .upd-prog i');
      return { pill: pill, bar: bar ? bar.style.width : '', head: (document.querySelector('#updOut .upd-box-h')||{}).textContent };
    })()`);
    check('4d percent=0 时用 received/total 兜底成 25%',
      fallback.pill === '更新中 25%' && fallback.bar === '25%' && /25%/.test(fallback.head || ''), fallback);

    await ev(`__setState({ state:'available', latestVersion:'1.0.1', size:161801714, checkedAt: Date.now() })`);
    await sleep(200);

    /* ---------------- 5. 更新页：进入 / 检查 / 四种结果 ---------------- */
    await ev(`(function(){
      window.__calls.length = 0;
      var b = document.querySelector('.rail-btn[data-page="settings"]'); if (b) b.click();
      var t = document.querySelector('#setSeg button[data-tab="update"]'); if (t) t.click();
      return 1;
    })()`);
    await sleep(500);
    const tab = await ev(`(function(){
      var el = document.getElementById('tab-update');
      return { visible: !el.hidden, cur: document.getElementById('updCurVer').textContent,
               checked: document.getElementById('updChecked').textContent,
               calledState: window.__calls.some(function(c){ return c.ch === 'update:state'; }),
               boxes: document.querySelectorAll('#updOut .upd-box').length };
    })()`);
    check('5a 进入「更新」页调用 update:state 并渲染当前版本', tab.visible && tab.calledState && tab.cur === 'v1.0.0', tab);

    await ev(`window.__checkResult = { state:'available', latestVersion:'1.0.1', size:161801714,
      notes:'1. 新增「重启并更新」入口\\n2. 设置页新增「更新」与重做的「关于」\\n3. 修复窗口放大后右侧留白' };
      window.__calls.length = 0;
      document.getElementById('updCheckBtn').click(); 1`);
    await sleep(120);
    const busy = await ev(`(function(){
      var b = document.getElementById('updCheckBtn');
      return { disabled: b.disabled, txt: document.getElementById('updCheckTxt').textContent,
               boxes: document.querySelectorAll('#updOut .upd-box').length,
               skel: document.querySelectorAll('#updOut .upd-skel i').length };
    })()`);
    check('5b 点「检查更新」→ update:check(force) 且进入 loading/骨架',
      busy.disabled && busy.txt === '正在检查…' && busy.skel === 3, busy);
    const shotCheck = await shot('upd-tab-checking.png');

    await sleep(700);
    const availTab = await ev(`(function(){
      var box = document.querySelector('#updOut .upd-box');
      var tag = document.querySelector('#updOut .upd-ver-tag');
      var notes = document.querySelector('#updOut .upd-notes');
      var meta = document.querySelector('#updOut .upd-meta');
      var btn = document.querySelector('#updOut [data-upd-act="apply"]');
      var calls = window.__calls.filter(function(c){ return c.ch === 'update:check'; });
      return { force: !!(calls[0] && calls[0].payload && calls[0].payload.force),
               tag: tag ? tag.textContent : '', meta: meta ? meta.textContent.replace(/\\s+/g,' ').trim() : '',
               notesLines: notes ? notes.textContent.split('\\n').length : 0,
               hasBtn: !!btn, disabled: document.getElementById('updCheckBtn').disabled,
               rightAligned: btn ? (function(){
                 var br = btn.getBoundingClientRect(), pr = btn.parentElement.getBoundingClientRect();
                 return pr.right - br.right < 8 && br.bottom <= pr.bottom + 1;
               })() : false };
    })()`);
    check('5c 有更新：v1.0.1 徽标 + MB 体积 + 多行说明 + 立即更新按钮',
      availTab.tag === 'v1.0.1' && /154\.3 MB/.test(availTab.meta) && availTab.notesLines === 3 &&
      availTab.hasBtn && availTab.rightAligned && availTab.force, availTab);
    const shotAvailTab = await shot('upd-tab-available.png');

    await ev(`document.querySelector('#updOut [data-upd-act="apply"]').click(); 1`);
    await sleep(350);
    await ev(`__setState({ state:'downloading', latestVersion:'1.0.1', size:161801714,
      progress:{ received:67956720, total:161801714, percent:42, speed:4404019 } })`);
    await sleep(300);
    const dlTab = await ev(`(function(){
      var p = document.querySelector('#updOut .upd-prog i');
      var h = document.querySelector('#updOut .upd-box-h');
      return { pct: p ? p.style.width : '', head: h ? h.textContent.trim() : '',
               meta: (document.querySelector('#updOut .upd-meta')||{}).textContent,
               radius: p ? getComputedStyle(p).borderRadius : '' };
    })()`);
    check('5d 下载中：渐变进度条 + 百分比 + 速度 + 已下载/总量',
      dlTab.pct === '42%' && /42%/.test(dlTab.head) && /MB\/s/.test(dlTab.meta) && /154\.3 MB/.test(dlTab.meta), dlTab);
    const shotDlTab = await shot('upd-tab-downloading.png');

    /* 5e 检查阶段失败（没有版本信息）→ 「重试」重新检查 */
    await ev(`__setState({ state:'error', latestVersion:null, sha256:null,
      message:'连接更新服务器超时，请检查网络后重试' })`);
    await sleep(300);
    const errTab = await ev(`(function(){
      var b = document.querySelector('#updOut .upd-box.bad');
      var btn = b ? b.querySelector('button[data-upd-act]') : null;
      return { bad: !!b, msg: b ? (b.querySelector('[data-msg]')||{}).textContent : '',
               act: btn ? btn.dataset.updAct : '', label: btn ? btn.textContent.trim() : '' };
    })()`);
    check('5e 检查失败：红色提示 + message + 「重试」走 update:check',
      errTab.bad && /超时/.test(errTab.msg) && errTab.act === 'check' && errTab.label === '重试', errTab);
    const shotErr = await shot('upd-tab-error.png');

    /* 5e2 下载/校验失败（主进程仍保留 latestVersion+sha256）→ 「重试下载」直接 apply */
    await ev(`__setState({ state:'error', latestVersion:'1.0.1', sha256:'abc123',
      message:'下载中断：连接被重置' })`);
    await sleep(300);
    await ev(`window.__calls.length = 0`);
    const errTab2 = await ev(`(function(){
      var b = document.querySelector('#updOut .upd-box.bad');
      var btn = b ? b.querySelector('button[data-upd-act]') : null;
      return { act: btn ? btn.dataset.updAct : '', label: btn ? btn.textContent.trim() : '' };
    })()`);
    await ev(`document.querySelector('#updOut button[data-upd-act]').click(); 1`);
    await sleep(300);
    const reapplied = await ev(`window.__calls.filter(function(c){ return c.ch === 'update:apply'; }).length`);
    check('5e2 下载失败：按钮变「重试下载」并直接调用 update:apply（免一次检查往返）',
      errTab2.act === 'apply' && errTab2.label === '重试下载' && reapplied === 1, { errTab2, reapplied });

    await ev(`__setState({ state:'idle', latestVersion:null, checkedAt: Date.now(), message:'当前已是最新版本（1.0.0）' })`);
    await sleep(300);
    const okTab = await ev(`(function(){
      var b = document.querySelector('#updOut .upd-box.ok');
      return { ok: !!b, txt: b ? b.textContent.replace(/\\s+/g,' ').trim() : '',
               checked: document.getElementById('updChecked').textContent };
    })()`);
    check('5f 无更新：绿色「已是最新版本 · v1.0.0」+ 上次检查时间',
      okTab.ok && /已是最新版本 · v1\.0\.0/.test(okTab.txt) && /上次检查/.test(okTab.checked), okTab);
    const shotOk = await shot('upd-tab-latest.png');

    /* 5g 覆盖安装说明条：只在 有更新 / 下载中 / 校验中 出现 */
    const noteCases = [
      ['available', true], ['downloading', true], ['verifying', true],
      ['checking', false], ['idle', false], ['error', false], ['skipped', false], ['dismissed', false],
    ];
    const noteOut = [];
    for (const [nst, want] of noteCases) {
      await ev(`__setState({ state:'${nst}', latestVersion:'1.0.1', sha256:'abc123',
        checkedAt: Date.now(), message:'x',
        progress:{ received:100, total:1000, percent:10, speed:1000 } })`);
      await sleep(190);
      const o = await ev(`(function(){
        var n = document.querySelector('#updOut .upd-note');
        return { has: !!n, txt: n ? n.textContent.replace(/\s+/g,' ').trim() : '',
                 fs: n ? getComputedStyle(n).fontSize : '', radius: n ? getComputedStyle(n).borderRadius : '' };
      })()`);
      noteOut.push({ st: nst, want, o });
    }
    const noteBad = noteOut.filter(r => r.want
      ? (!r.o.has || r.o.fs !== '12px' || !/Game 存档与个人数据/.test(r.o.txt) || parseFloat(r.o.radius) < 12)
      : r.o.has);
    check('5g 说明条只在 有更新/下载中/校验中 出现（12px、圆角容器）', noteBad.length === 0, noteBad);

    /* 5h 1080 宽下说明条单行不折行、不越界，并出图 */
    await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    await ev(`__setState({ state:'available', latestVersion:'1.0.1', size:161801714, sha256:'abc123',
      notes:'覆盖安装说明条渲染测试',
      checkedAt: Date.now() })`);
    await sleep(350);
    const noteLine = await ev(`(function(){
      var n = document.querySelector('#updOut .upd-note');
      var out = document.getElementById('updOut');
      var r = n.getBoundingClientRect(), or = out.getBoundingClientRect();
      var lh = parseFloat(getComputedStyle(n).lineHeight);
      var span = n.querySelector('span').getBoundingClientRect();
      return { textH:+span.height.toFixed(1), lh:+lh.toFixed(1), h:+r.height.toFixed(1),
               right:+r.right.toFixed(1), outRight:+or.right.toFixed(1),
               fs:getComputedStyle(n).fontSize, color:getComputedStyle(n).color };
    })()`);
    check('5h 1080 宽下说明条单行不折行、不越界',
      noteLine.textH <= noteLine.lh + 1 && noteLine.right <= noteLine.outRight + 1, noteLine);
    const clipNote = await ev(`(function(){
      var out = document.getElementById('updOut'), r = out.getBoundingClientRect();
      return { x: Math.max(0, Math.round(r.left - 14)), y: Math.max(0, Math.round(r.top - 14)),
               w: Math.min(1080, Math.round(r.width + 28)), h: Math.round(r.height + 28) };
    })()`);
    await shot('upd-notes-line.png', clipNote);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);

    /* ---------------- 6. 关于页 ---------------- */
    await ev(`(function(){
      document.querySelector('#setSeg button[data-tab="about"]').click(); return 1;
    })()`);
    await sleep(500);
    const about = await ev(`(function(){
      var credits = [].slice.call(document.querySelectorAll('#tab-about .credit'));
      var pages = document.querySelector('.pages');
      var pr = pages.getBoundingClientRect();
      var over = credits.filter(function(c){ var r = c.getBoundingClientRect(); return r.right > pr.right + 1 || r.left < pr.left - 1; });
      /* 两两不重叠：按行分组后检测 */
      var rects = credits.map(function(c){ return c.getBoundingClientRect(); });
      var overlap = 0;
      for (var i=0;i<rects.length;i++) for (var j=i+1;j<rects.length;j++){
        var a=rects[i], b=rects[j];
        if (a.left < b.right-1 && b.left < a.right-1 && a.top < b.bottom-1 && b.top < a.bottom-1) overlap++;
      }
      var rows = {};
      rects.forEach(function(r){ rows[Math.round(r.top)] = 1; });
      return { n: credits.length, names: credits.map(function(c){ return c.querySelector('b').textContent; }),
               overlap: overlap, outOfView: over.length, rowCount: Object.keys(rows).length,
               hOverflow: pages.scrollWidth - pages.clientWidth,
               ver: document.getElementById('aboutVer').textContent,
               electron: document.getElementById('abElectron').textContent,
               install: document.getElementById('abInstallDir').textContent,
               selectable: getComputedStyle(document.getElementById('abInstallDir')).userSelect,
               foot: (document.querySelector('.credit-foot')||{}).textContent };
    })()`);
    check('6a 鸣谢 9 条全部渲染且无重叠/无横向溢出',
      about.n === 9 && about.overlap === 0 && about.outOfView === 0 && about.hOverflow <= 0, about);
    check('6b 关于页版本与运行环境来自 app:info，安装目录可选中',
      about.ver === 'v1.0.0' && about.electron === '33.2.1' && /XCL/.test(about.install) &&
      about.selectable === 'text', about);
    const shotAbout = await shot('upd-about.png');

    /* ---------------- 7. 主题：dark / sky（按 --bg0 做混色对比度） ---------------- */
    const CONTRAST_FN = `
      function parse(s){ var m = String(s).match(/[\\d.]+/g); return m ? m.map(Number) : [0,0,0]; }
      function hex2(h){ h = String(h).trim().replace('#','');
        if (h.length === 3) h = h.split('').map(function(c){ return c + c; }).join('');
        var n = parseInt(h, 16); return [(n>>16)&255, (n>>8)&255, n&255]; }
      function lum(c){ var a = c.slice(0,3).map(function(v){ v/=255; return v<=.03928? v/12.92 : Math.pow((v+.055)/1.055,2.4); });
        return .2126*a[0]+.7152*a[1]+.0722*a[2]; }
      function over(fg,bg){ var a = fg.length > 3 ? fg[3] : 1;
        return [0,1,2].map(function(i){ return fg[i]*a + bg[i]*(1-a); }); }
      function ratio(fg,bg){ var f = over(fg,bg), L1 = lum(f), L2 = lum(bg);
        var hi = Math.max(L1,L2), lo = Math.min(L1,L2); return +((hi+.05)/(lo+.05)).toFixed(2); }
      function probe(items){
        var bg = hex2(getComputedStyle(document.documentElement).getPropertyValue('--bg0'));
        return items.map(function(it){
          var el = document.querySelector(it[0]);
          if (!el) return { sel: it[0], miss: true };
          return { sel: it[0], need: it[1], color: getComputedStyle(el).color,
                   ratio: ratio(parse(getComputedStyle(el).color), bg) };
        });
      }
    `;

    /* 无头模式下 CSS 过渡进度被节流，读到的会是过渡中间色。
       这里临时把 --anim-k 归零（行内覆盖），让颜色立刻到位，再还原。 */
    await ev(`document.documentElement.style.setProperty('--anim-k','0');
              document.documentElement.setAttribute('data-theme','dark'); 1`);
    await sleep(250);
    const dark = await ev(`(function(){
      ${CONTRAST_FN}
      return probe([
        ['#tab-about .ab-id b', 4.5],
        ['#tab-about .credit-m b', 4.5],
        ['#tab-about .credit-m span', 3],
        ['#tab-about .credit-foot', 2.2],
        ['#tab-update .upd-box-h', 4.5],
        ['#tab-update .upd-p', 3],
        ['#updOut .upd-note', 2.2],
        ['#updPillTxt', 2.5]
      ]);
    })()`);
    const lowDark = (dark || []).filter(o => !o.miss && o.ratio < o.need);
    check('7a 暗黑主题下新元素文字对比度达标（正文≥4.5 / 次级≥3 / 注释≥2.2 / 强调胶囊≥2.5）',
      lowDark.length === 0, { low: lowDark, all: dark });
    await shot('upd-about-dark.png');

    await ev(`(function(){
      document.querySelector('#setSeg button[data-tab="update"]').click(); return 1; })()`);
    await sleep(350);
    await shot('upd-tab-dark.png');

    await ev(`document.documentElement.style.setProperty('--anim-k','0');
              document.documentElement.setAttribute('data-theme','sky'); 1`);
    await sleep(250);
    const skyOut = await ev(`(function(){
      ${CONTRAST_FN}
      return probe([
        ['#tab-about .ab-id b', 4.5],
        ['#tab-about .credit-m b', 4.5],
        ['#tab-about .credit-m span', 3],
        ['#tab-about .credit-foot', 2.2],
        ['#tab-update .upd-box-h', 4.5],
        ['#tab-update .upd-p', 3],
        ['#updOut .upd-note', 2.2],
        ['#updPillTxt', 2.5]
      ]);
    })()`);
    const lowSky = (skyOut || []).filter(o => !o.miss && o.ratio < o.need);
    check('7b 浅蓝主题下新元素文字对比度达标（同上阈值）', lowSky.length === 0, { low: lowSky, all: skyOut });

    await ev(`document.documentElement.style.removeProperty('--anim-k'); 1`);

    /* 两套主题下颜色必须变化，证明用的是主题变量而不是写死色值 */
    const pairs = (skyOut || []).map((o, i) => ({ sky: o, dark: dark[i] }))
      .filter(x => x.dark && !x.sky.miss && !x.dark.miss);
    const changed = pairs.length >= 5 && pairs.every(x => x.sky.color !== x.dark.color);
    check('7c 两套主题下新元素颜色随主题变化（未写死色值）', changed, {
      compared: pairs.length,
      sky: pairs.map(x => x.sky.color), dark: pairs.map(x => x.dark.color)
    });

    /* ---------------- 8. 无动画档：无残余过渡 ---------------- */
    await ev(`document.documentElement.setAttribute('data-speed','none'); 1`);
    await sleep(300);
    const noAnim = await ev(`(function(){
      var sels = ['#updPillMain','#updPillX','#updOut .upd-btn','#tab-about .credit','#updOut .upd-prog i','#setSeg button','#updOut .upd-note'];
      return sels.map(function(sel){
        var el = document.querySelector(sel); if (!el) return { sel:sel, miss:true };
        var s = getComputedStyle(el);
        return { sel:sel, td: s.transitionDuration, ad: s.animationDuration };
      });
    })()`);
    const bad = (noAnim || []).filter(o => !o.miss && (o.td.split(',').some(v => parseFloat(v) > 0) || parseFloat(o.ad) > 0));
    check('8a 无动画档下新元素过渡/动画时长为 0', bad.length === 0, bad);

    await ev(`document.documentElement.setAttribute('data-speed','slow'); 1`);

    /* ---------------- 9. 宽度自适应 ---------------- */
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    const w1920 = await ev(`(function(){
      var pages = document.querySelector('.pages'), pr = pages.getBoundingClientRect();
      var el = document.getElementById('tab-update');
      var card = el.querySelector('.upd-card').getBoundingClientRect();
      var out = document.getElementById('updOut').getBoundingClientRect();
      return { pageW:+pr.width.toFixed(1), cardW:+card.width.toFixed(1), outW:+out.width.toFixed(1),
               gapRight: +(pr.right - card.right).toFixed(1), hOverflow: pages.scrollWidth - pages.clientWidth };
    })()`);
    check('9a 1920 宽：卡片铺满内容区（右侧无大片空白）',
      w1920.gapRight !== undefined && w1920.cardW > w1920.pageW - 80 && w1920.hOverflow <= 0, w1920);
    const shot1920 = await shot('upd-tab-1920.png');

    await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    const w1080 = await ev(`(function(){
      var pages = document.querySelector('.pages'), pr = pages.getBoundingClientRect();
      var seg = document.getElementById('setSeg').getBoundingClientRect();
      var btns = [].slice.call(document.querySelectorAll('#setSeg button'));
      var wrapped = btns.some(function(b){ return Math.abs(b.getBoundingClientRect().top - btns[0].getBoundingClientRect().top) > 2; });
      var overlap = 0;
      for (var i=1;i<btns.length;i++){
        if (btns[i].getBoundingClientRect().left < btns[i-1].getBoundingClientRect().right - 1) overlap++;
      }
      var card = document.querySelector('#tab-update .upd-card').getBoundingClientRect();
      return { segW:+seg.width.toFixed(1), segRight:+seg.right.toFixed(1), pagesRight:+pr.right.toFixed(1),
               wrapped: wrapped, overlap: overlap, hOverflow: pages.scrollWidth - pages.clientWidth,
               cardRight:+card.right.toFixed(1) };
    })()`);
    check('9b 1080 宽：分页条不换行不重叠、页面无横向溢出',
      !w1080.wrapped && w1080.overlap === 0 && w1080.hOverflow <= 0 && w1080.segRight <= w1080.pagesRight + 1, w1080);
    const shot1080 = await shot('upd-tab-1080.png');

    await ev(`(function(){ document.querySelector('#setSeg button[data-tab="about"]').click(); return 1; })()`);
    await sleep(300);
    await shot('upd-about-1080.png');

    /* ---------------- 10. 纯浏览器（无 FMBridge / FMWindow） ---------------- */
    if (INJ_ID) {
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: INJ_ID });
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 860, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    for (let i = 0; i < 80; i++) {
      if (await ev(`document.readyState === 'complete' && !!document.getElementById('setSeg')`)) break;
      await sleep(200);
    }
    await sleep(600);
    await ev(`(function(){
      var b = document.querySelector('.rail-btn[data-page="settings"]'); if (b) b.click();
      var t = document.querySelector('#setSeg button[data-tab="update"]'); if (t) t.click();
      return 1; })()`);
    await sleep(400);
    const bare = await ev(`(function(){
      var pill = document.getElementById('updPill');
      var wbar = document.getElementById('wbar');
      var out = document.getElementById('updOut');
      return { bridge: !!(window.FMBridge && window.FMBridge.available),
               wbOn: document.documentElement.classList.contains('wb-on'),
               pillHidden: pill.hidden, pillW: pill.getBoundingClientRect().width,
               wbarDisplay: getComputedStyle(wbar).display,
               outText: out.textContent.replace(/\s+/g,' ').trim(),
               boxCount: out.querySelectorAll('.upd-box').length,
               checkDisabled: document.getElementById('updCheckBtn').disabled };
    })()`);
    check('10a 纯浏览器：无桥时胶囊不渲染、标题栏隐藏、检查按钮置灰',
      bare.bridge === false && bare.pillHidden && bare.pillW === 0 &&
      bare.wbarDisplay === 'none' && bare.checkDisabled === true, bare);
    check('10b 纯浏览器：「更新」页显示「仅在桌面客户端可用」占位',
      /仅在桌面客户端可用/.test(bare.outText) && bare.boxCount === 1, bare);
    check('10c 纯浏览器：页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 5));
    await shot('upd-tab-browser.png');

    /* ---------------- 汇总 ---------------- */
    const fails = results.filter(r => !r.pass);
    console.log('\n===== 汇总 =====');
    console.log('通过 ' + (results.length - fails.length) + ' / ' + results.length);
    if (fails.length) fails.forEach(f => console.log('FAILED: ' + f.name + ' ' + JSON.stringify(f.extra)));
    console.log(JSON.stringify({
      shots: { shotAvail, shotDl: shotDlTab, shotAvailTab, shotErr, shotOk, shotAbout, shotCheck, shot1920, shot1080 }
    }, null, 2));

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
