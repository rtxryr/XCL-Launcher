/* 用 CDP 驱动 Edge 无头渲染前端，验证侧栏图钉的位置与三种状态 */
const fs = require("fs");
const path = require("path");

const PORT = process.env.CDP_PORT || 9223;
const OUT = path.join(__dirname, "..", "shots");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      /* 只看真实网页；Edge 的同步确认页也是 type=page，会抢在前面 */
      const page = list.find(t => t.type === "page" && /^(file|https?):/i.test(t.url));
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error("CDP 端口未就绪");
}

async function main() {
  const url = await connect();
  const ws = new WebSocket(url);
  let id = 0;
  const waiters = new Map();

  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiters.has(msg.id)) {
      const { res, rej } = waiters.get(msg.id);
      waiters.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  });

  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    waiters.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  await send("Page.enable");
  await send("Runtime.enable");

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " | " + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  const shot = async (name) => {
    fs.mkdirSync(OUT, { recursive: true });
    const r = await send("Page.captureScreenshot", { format: "png" });
    const p = path.join(OUT, name);
    fs.writeFileSync(p, Buffer.from(r.data, "base64"));
    return p;
  };

  /* 局部放大截图，用来判断 16px 图标在真实尺寸下是否够清楚 */
  const shotClip = async (name, clip) => {
    fs.mkdirSync(OUT, { recursive: true });
    const r = await send("Page.captureScreenshot", { format: "png", clip });
    const p = path.join(OUT, name);
    fs.writeFileSync(p, Buffer.from(r.data, "base64"));
    return p;
  };

  await sleep(1200);

  /* 每次都从干净状态开始：清掉上次的钉住/展开持久化，再硬刷新 */
  await evalJs(`localStorage.removeItem('mc.railPin'); localStorage.removeItem('mc.rail'); true`);
  await send("Page.reload", { ignoreCache: true });

  /* 等脚本真正跑完（图钉已绑定事件），别用固定 sleep 赌 */
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      ready = await evalJs(`!!(document.getElementById('railPin') && document.getElementById('railToggle'))`);
      if (ready) break;
    } catch (_) { /* 刷新期间 context 会短暂失效 */ }
  }
  if (!ready) throw new Error("页面刷新后元素未就绪");
  await sleep(500);

  const out = {};

  /* 1) 收起态：图钉应不可见且不可点 */
  out.collapsed = await evalJs(`(() => {
    const pin = document.getElementById('railPin');
    const cs = getComputedStyle(pin);
    return { open: document.getElementById('rail').classList.contains('open'),
      pinOpacity: cs.opacity, pinEvents: cs.pointerEvents };
  })()`);
  out.shotCollapsed = await shot("rail-1-collapsed.png");

  /* 2) 展开：点三条杠 */
  await evalJs(`document.getElementById('railToggle').click()`);
  await sleep(700);
  out.expanded = await evalJs(`(() => {
    const rail = document.getElementById('rail');
    const pin = document.getElementById('railPin');
    const cs = getComputedStyle(pin);
    const rb = rail.getBoundingClientRect();
    const pb = pin.getBoundingClientRect();
    const hb = document.querySelector('.rail-head').getBoundingClientRect();
    return {
      open: rail.classList.contains('open'),
      railWidth: Math.round(rb.width),
      pinOpacity: cs.opacity,
      pinEvents: cs.pointerEvents,
      pinIconRotate: getComputedStyle(pin.querySelector('svg')).transform,
      pinRect: { x: Math.round(pb.x), y: Math.round(pb.y), w: Math.round(pb.width), h: Math.round(pb.height) },
      headRect: { x: Math.round(hb.x), right: Math.round(hb.right) },
      /* 图钉右缘是否落在 head 内、且贴着右边距 */
      insideHead: pb.right <= hb.right + 0.5,
      gapToRight: Math.round(hb.right - pb.right),
      pinned: rail.classList.contains('pinned'),
    };
  })()`);
  out.shotExpanded = await shot("rail-2-expanded.png");

  /* 3) 点图钉固定 */
  await evalJs(`document.getElementById('railPin').click()`);
  await sleep(600);
  out.pinned = await evalJs(`(() => {
    const rail = document.getElementById('rail');
    const pin = document.getElementById('railPin');
    const cs = getComputedStyle(pin);
    return {
      pinned: rail.classList.contains('pinned'),
      pinOn: pin.classList.contains('on'),
      ariaPressed: pin.getAttribute('aria-pressed'),
      title: pin.title,
      bg: cs.backgroundColor, border: cs.borderTopColor,
      iconRotate: getComputedStyle(pin.querySelector('svg')).transform,
      stored: localStorage.getItem('mc.railPin'),
    };
  })()`);
  out.shotPinned = await shot("rail-3-pinned.png");
  out.shotZoomPinned = await shotClip("rail-5-zoom-pinned.png",
    { x: 0, y: 10, width: 258, height: 68, scale: 4 });

  /* 4) 点内容区（外部）——钉住后不该收起 */
  await evalJs(`document.querySelector('.stage').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await sleep(600);
  out.afterOutsideClick = await evalJs(`(() => {
    const rail = document.getElementById('rail');
    return { stillOpen: rail.classList.contains('open'), stillPinned: rail.classList.contains('pinned') };
  })()`);

  /* 5) Esc —— 钉住后也不该收起 */
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(400);
  out.afterEsc = await evalJs(`document.getElementById('rail').classList.contains('open')`);

  /* 6) 再点图钉取消固定 → 点外面应收起 */
  await evalJs(`document.getElementById('railPin').click()`);
  await sleep(400);
  out.unpinned = await evalJs(`(() => {
    const rail = document.getElementById('rail');
    return { pinned: rail.classList.contains('pinned'), open: rail.classList.contains('open'),
      stored: localStorage.getItem('mc.railPin') };
  })()`);
  await evalJs(`document.querySelector('.stage').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await sleep(700);
  out.afterOutsideClickUnpinned = await evalJs(`(() => {
    const rail = document.getElementById('rail');
    return { open: rail.classList.contains('open') };
  })()`);
  out.shotFinal = await shot("rail-4-unpinned-collapsed.png");

  console.log(JSON.stringify(out, null, 2));
  ws.close();
}

main().catch(e => { console.error("失败:", e.message); process.exit(1); });
