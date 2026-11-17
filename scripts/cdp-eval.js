/** 通过 CDP 在运行中的启动器里执行 JS（验证 UI 与 IPC 链路）。 */
const fs = require('fs');
let expr = process.argv[2];
if (expr === '--file') expr = fs.readFileSync(process.argv[3], 'utf8');
if (!expr) {
  console.error('用法: node cdp-eval.js "<js表达式>" | --file <路径>');
  process.exit(1);
}

(async () => {
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有找到页面目标');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  const id = 1;
  ws.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise: true, returnByValue: true },
    }),
  );

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== id) return;
    if (m.result && m.result.exceptionDetails) {
      console.log('EXCEPTION', JSON.stringify(m.result.exceptionDetails).slice(0, 400));
    } else {
      const v = m.result && m.result.result ? m.result.result.value : undefined;
      console.log(typeof v === 'string' ? v : JSON.stringify(v));
    }
    ws.close();
    process.exit(0);
  });

  setTimeout(() => {
    console.log('TIMEOUT');
    process.exit(1);
  }, 60000);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
