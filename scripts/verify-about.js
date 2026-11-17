/* 浏览器内验证：顶部版本已移除、设置里的关于页、放大后背景是否铺满 */
const fs = require("fs");
const path = require("path");
const PORT = 9224;
const PAGE_URL = "file:///E:/%E4%BB%BB%E8%A1%8D%E7%91%9E/%E8%BD%AF%E4%BB%B6%E5%BC%80%E5%8F%91/XCL%20%E5%89%8D%E7%AB%AF/X%20Craft%20Launcher%20%E5%89%8D%E7%AB%AF.html";
const OUT = path.join(__dirname, "..", "shots");
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === "page" && /^file:/i.test(t.url));
  if (!page) throw new Error("无页面");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const waiters = new Map();
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id); waiters.delete(m.id);
      m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; waiters.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await new Promise(res => ws.addEventListener("open", res, { once: true }));
  await send("Page.enable");
  await send("Runtime.enable");

  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ""));
    return r.result && r.result.value;
  };
  const shot = async (name) => {
    fs.mkdirSync(OUT, { recursive: true });
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
    return name;
  };

  await send("Page.navigate", { url: PAGE_URL });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(250);
    try { ready = await ev("!!(document.getElementById('setSeg') && document.getElementById('tab-about'))"); } catch (_) {}
    if (ready) break;
  }
  if (!ready) throw new Error("前端页面未就绪");
  await sleep(900);

  const out = {};

  /* 需求 1：顶部栏版本标签已移除 */
  out.topVersionRemoved = await ev(`(() => ({
    subEl: !!document.getElementById('wbarSub'),
    subCss: !!document.querySelector('.wbar-sub'),
    title: (document.querySelector('.wbar-title') || {}).textContent || null
  }))()`);

  /* 需求 2：切到设置 → 关于 */
  await ev(`document.querySelector('.rail-btn[data-page="settings"]').click()`);
  await sleep(600);
  await ev(`document.querySelector('#setSeg button[data-tab="about"]').click()`);
  await sleep(700);

  out.about = await ev(`(() => {
    const t = document.getElementById('tab-about');
    const btn = document.getElementById('aboutCheck');
    const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}; };
    return {
      visible: !t.hidden,
      generalHidden: document.getElementById('tab-general').hidden,
      appearanceHidden: document.getElementById('tab-appearance').hidden,
      activeTab: (document.querySelector('#setSeg button.on') || {}).textContent,
      version: (document.getElementById('aboutVer') || {}).textContent,
      checkBtn: rect(btn),
      checkLabel: btn && btn.textContent.trim(),
      cardRect: rect(document.querySelector('.about-card')),
      slots: Array.from(document.querySelectorAll('#tab-about .about-slot')).map(s => ({
        head: s.querySelector('.as-head').textContent.trim(),
        bodyEmpty: s.querySelector('.as-body').innerHTML.trim() === '',
        note: s.querySelector('.as-note').textContent.trim()
      }))
    };
  })()`);
  out.shotAbout = await shot("about-page.png");

  /* 检查更新按钮：纯前端占位反馈 */
  await ev(`document.getElementById('aboutCheck').click()`);
  await sleep(200);
  out.checkFeedback = await ev(`(() => { const b=document.getElementById('aboutCheck'); return {text:b.textContent.trim(),disabled:b.disabled}; })()`);
  await sleep(1600);
  out.checkRestored = await ev(`(() => { const b=document.getElementById('aboutCheck'); return {text:b.textContent.trim(),disabled:b.disabled}; })()`);

  /* 需求 4：放大视口，检查背景层是否铺满 */
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  out.enlarged = await ev(`(() => {
    const bg = document.querySelector('.bg');
    const b = bg.getBoundingClientRect();
    const cs = getComputedStyle(bg);
    const hs = getComputedStyle(document.documentElement);
    const bs = getComputedStyle(document.body);
    return {
      viewport: [innerWidth, innerHeight],
      bgRect: {w:Math.round(b.width),h:Math.round(b.height)},
      coversViewport: b.width >= innerWidth - 1 && b.height >= innerHeight - 1,
      htmlBg: hs.backgroundColor, bodyBg: bs.backgroundColor, bgColor: cs.backgroundColor
    };
  })()`);
  out.shotEnlarged = await shot("about-enlarged-1920.png");

  /* 右下角局部放大截图，肉眼确认没有浅色 L 形区 */
  const clip = await send("Page.captureScreenshot", { format: "png", clip: { x: 1400, y: 780, width: 520, height: 300, scale: 2 } });
  fs.writeFileSync(path.join(OUT, "about-enlarged-bottomright.png"), Buffer.from(clip.data, "base64"));

  await send("Emulation.clearDeviceMetricsOverride");
  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch(e => { console.error("失败:", e.message); process.exit(1); });
