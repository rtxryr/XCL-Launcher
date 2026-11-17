/* 成品 exe 内验证：关于页 + 真实窗口放大后右下角是否露白 */
const fs = require("fs");
const path = require("path");
const PORT = 9222;
const OUT = path.join(__dirname, "..", "shots");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const waiters = new Map();
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id); waiters.delete(m.id);
      m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; waiters.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, ready, send };
}

(async () => {
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === "page" && /^(file|https?):/i.test(t.url));
  if (!page) throw new Error("无页面 target");

  const P = cdp(page.webSocketDebuggerUrl);
  const B = cdp(version.webSocketDebuggerUrl);
  await Promise.all([P.ready, B.ready]);
  await P.send("Page.enable");
  await P.send("Runtime.enable");

  const ev = async (expression) => {
    const r = await P.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  const shot = async (name, clip) => {
    fs.mkdirSync(OUT, { recursive: true });
    const r = await P.send("Page.captureScreenshot", clip ? { format: "png", clip } : { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
    return name;
  };

  const out = {};

  /* 1) 标题栏版本标签已移除（exe 里 wb-on 生效） */
  out.topBar = await ev(`(() => ({
    wbOn: document.documentElement.classList.contains('wb-on'),
    hasSub: !!document.getElementById('wbarSub'),
    title: (document.querySelector('.wbar-title') || {}).textContent || null,
    wbarChildren: Array.from((document.querySelector('.wbar') || {}).children || []).map(e => e.className)
  }))()`);

  /* 2) 设置 → 关于 */
  await ev(`document.querySelector('.rail-btn[data-page="settings"]').click()`);
  await sleep(500);
  await ev(`document.querySelector('#setSeg button[data-tab="about"]').click()`);
  await sleep(600);
  out.about = await ev(`(() => {
    const t=document.getElementById('tab-about');
    return { visible:!t.hidden, version:(document.getElementById('aboutVer')||{}).textContent,
      checkLabel:(document.getElementById('aboutCheck')||{}).textContent.trim(),
      slots:Array.from(t.querySelectorAll('.about-slot .as-body')).map(e=>e.innerHTML.trim()==='') };
  })()`);
  out.shotAbout = await shot("exe-about.png");

  /* 3) 真实窗口放大：Electron 的 CDP 不支持 Browser.setWindowBounds，
        改点界面上的最大化按钮（这才是用户说的「放大」） */
  out.originalViewport = await ev(`[innerWidth, innerHeight]`);
  await ev(`document.querySelector('.wctl-btn[data-act="maximize"]').click()`);
  await sleep(2200);
  out.resizedViewport = await ev(`[innerWidth, innerHeight]`);
  out.wbMax = await ev(`document.documentElement.classList.contains('wb-max')`);

  out.afterResize = await ev(`(() => {
    const bg=document.querySelector('.bg'), b=bg.getBoundingClientRect();
    const corner = document.elementFromPoint(innerWidth-8, innerHeight-8);
    return { viewport:[innerWidth,innerHeight], bgRect:[Math.round(b.width),Math.round(b.height)],
      covers: b.width>=innerWidth-1 && b.height>=innerHeight-1,
      htmlBg:getComputedStyle(document.documentElement).backgroundColor,
      bgBg:getComputedStyle(bg).backgroundColor,
      cornerTag: corner ? corner.tagName+'.'+corner.className : null };
  })()`);
  out.shotResized = await shot("exe-resized-maximized.png");
  const vw = out.afterResize.viewport[0], vh = out.afterResize.viewport[1];
  out.shotBottomRight = await shot("exe-resized-bottomright.png",
    { x: Math.max(0, vw - 520), y: Math.max(0, vh - 320), width: 520, height: 320, scale: 2 });

  /* 4) 还原窗口，别改变你的使用习惯 */
  await ev(`document.querySelector('.wctl-btn[data-act="maximize"]').click()`);
  await sleep(1200);
  out.restoredViewport = await ev(`[innerWidth, innerHeight]`);

  console.log(JSON.stringify(out, null, 2));
  P.ws.close(); B.ws.close();
})().catch(e => { console.error("失败:", e.message); process.exit(1); });
