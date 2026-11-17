// shot-9270.cjs —— 在运行中的启动器（CDP 9270）里执行 JS 并截图
// 用法：node scripts/shot-9270.cjs "<js 表达式>" <输出png路径>
"use strict";
const fs = require("fs");

const expr = process.argv[2] || "1";
const out = process.argv[3] || "shots/release-home.png";

(async () => {
  const list = await fetch("http://127.0.0.1:9270/json/list").then((r) => r.json());
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("没有找到页面目标");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await send("Page.enable");
  const r = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result && r.result.exceptionDetails) {
    console.log("EXCEPTION", JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  } else {
    const v = r.result && r.result.result ? r.result.result.value : undefined;
    console.log("EVAL:", typeof v === "string" ? v : JSON.stringify(v));
  }

  // 等动画/渲染稳定
  await new Promise((res) => setTimeout(res, 1200));

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const b64 = shot.result && shot.result.data;
  if (!b64) throw new Error("截图失败：" + JSON.stringify(shot).slice(0, 300));
  fs.mkdirSync(require("path").dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, "base64"));
  console.log("SAVED", out, fs.statSync(out).size, "bytes");
  ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
