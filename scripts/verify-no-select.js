/* 验证「屏蔽鼠标拖选文字」：无头 Edge 打开独立前端 HTML，
   1) 全站扫描 computed user-select；2) 输入框/日志白名单仍可选；
   3) 派发 selectstart / dragstart 看兜底拦截；4) 真实鼠标拖一段文字看是否选中。 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 9225;
const HTML = 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'xcl-select-' + process.pid);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const url = pathToFileURL(HTML).href;
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, '--window-size=1440,900', url,
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
      if (await ev(`document.readyState === 'complete' && !!document.querySelector('.rail-btn')`)) break;
      await sleep(200);
    }

    const result = {};

    /* 1) 全站扫描：白名单之外所有元素的 user-select 必须是 none */
    result.scan = await ev(`(function(){
      var white = 'input,textarea,select,[contenteditable],.allow-select,.dlg-log,.fmt-out,.fms-fb-out';
      var all = document.querySelectorAll('body *'), bad = [], n = 0;
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.closest(white)) continue;
        n++;
        var cs = getComputedStyle(el);
        var u = cs.webkitUserSelect || cs.userSelect;
        if (u !== 'none') bad.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ':' + u);
      }
      return { checked: n, leaks: bad.length, sample: bad.slice(0, 8) };
    })()`);

    /* 2) 白名单：输入框、终端输出、日志仍可选中 */
    result.whiteList = await ev(`(function(){
      function u(el){ if(!el) return 'missing'; var c=getComputedStyle(el); return c.webkitUserSelect || c.userSelect; }
      var log = document.createElement('div'); log.className='dlg-log';
      var line = document.createElement('div'); line.textContent='日志行'; log.appendChild(line);
      document.body.appendChild(log);
      var out = {
        searchInput: u(document.getElementById('searchInput')),
        upInput: u(document.getElementById('upInput')),
        setGameDir: u(document.getElementById('setGameDir')),
        logBox: u(log), logLine: u(line)
      };
      log.remove();
      return out;
    })()`);

    /* 3) 事件兜底：普通元素被拦，输入框放行 */
    result.events = await ev(`(function(){
      function fire(type, el){
        var e = new Event(type, { bubbles:true, cancelable:true });
        el.dispatchEvent(e); return e.defaultPrevented;
      }
      var btn = document.querySelector('.rail-btn');
      var inp = document.getElementById('searchInput');
      return {
        text_selectstart_blocked: fire('selectstart', btn),
        text_dragstart_blocked: fire('dragstart', btn),
        input_selectstart_allowed: !fire('selectstart', inp),
        input_dragstart_allowed: !fire('dragstart', inp)
      };
    })()`);

    /* 4) 真实鼠标拖选：用一个固定位置的探针文字，避开窗口拖动区干扰。
          探针继承全局样式（none）→ 拖选应为空；同一元素加 .allow-select 后 → 应能选中文字。
          后者是对照组，用来证明拖选事件本身确实派发成功。 */
    const rect = await ev(`(function(){
      var d = document.createElement('div');
      d.id = '__sel_probe';
      d.textContent = 'ABCDEFG 拖选测试文本';
      d.style.cssText = 'position:fixed;left:300px;top:400px;z-index:99999;font-size:22px;line-height:32px;color:#fff;background:#123;padding:8px;white-space:nowrap';
      d.setAttribute('data-no-select-test','1');
      document.body.appendChild(d);
      var r = d.getBoundingClientRect();
      return { x:r.x, y:r.y, w:r.width, h:r.height, text:d.textContent };
    })()`);
    result.dragTarget = rect;
    const drag = async () => {
      const x1 = Math.round(rect.x + 3), x2 = Math.round(rect.x + rect.w - 3), y = Math.round(rect.y + rect.h / 2);
      await ev(`window.getSelection().removeAllRanges()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y, button: 'none', buttons: 0 });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 12; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x1 + (x2 - x1) * i / 12), y, button: 'left', buttons: 1 });
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y, button: 'left', buttons: 0, clickCount: 1 });
      return ev(`String(window.getSelection().toString())`);
    };
    result.probeComputed = await ev(`(function(){var c=getComputedStyle(document.getElementById('__sel_probe'));return c.webkitUserSelect||c.userSelect})()`);
    result.dragSelection = await drag();
    await ev(`document.getElementById('__sel_probe').classList.add('allow-select')`);
    result.controlComputed = await ev(`(function(){var c=getComputedStyle(document.getElementById('__sel_probe'));return c.webkitUserSelect||c.userSelect})()`);
    result.controlSelection = await drag();
    await ev(`(function(){
      var el = document.getElementById('__sel_probe');
      if (el) el.remove();
      window.getSelection().removeAllRanges();
      return 1;
    })()`);

    console.log(JSON.stringify(result, null, 2));
    ws.close();
  } finally {
    try { edge.kill(); } catch (_) {}
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(e => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
