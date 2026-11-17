/* 把本地 jpg 用无头 Edge 重新渲染成新 PNG（绕开图片去重），并单独放大右下角 */
const fs = require("fs");
const path = require("path");
const PORT = 9224;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let url;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === "page" && /^(file|https?):/i.test(t.url));
      if (p) { url = p.webSocketDebuggerUrl; break; }
    } catch (_) {}
    await sleep(300);
  }
  if (!url) throw new Error("CDP 未就绪");
  const ws = new WebSocket(url);
  let id = 0; const w = new Map();
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(res => ws.addEventListener("open", res, { once: true }));
  await send("Page.enable");
  await sleep(1200);
  const outDir = path.join(__dirname, "..", "shots");
  fs.mkdirSync(outDir, { recursive: true });
  const full = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(outDir, "user-shot-full.png"), Buffer.from(full.result.data, "base64"));
  console.log("已生成 user-shot-full.png");
  ws.close();
})().catch(e => { console.error("失败:", e.message); process.exit(1); });
