/* 扫描用户截图里的亮度网格，定位放大后右下角的浅色块 */
const PORT = 9224;

const expression = `(() => {
  const img = document.querySelector('img');
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width;
  const L = (a, b) => { const i = (b * W + a) * 4; return Math.round(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]); };
  const cols = [];
  for (let a = 200; a <= 1760; a += 100) cols.push(a);
  let out = '列: ' + cols.join(' ') + String.fromCharCode(10);
  for (let b = 120; b <= 1100; b += 70) {
    out += String(b).padStart(4) + ': ' + cols.map(a => String(L(a, b)).padStart(3)).join(' ') + String.fromCharCode(10);
  }
  return out;
})()`;

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const p = list.find(t => t.type === 'page' && /^file:/i.test(t.url));
  if (!p) throw new Error('无图片页');
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  let id = 0; const waiters = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(res => ws.addEventListener('open', res, { once: true }));
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.result && r.result.exceptionDetails) {
    console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception || {}).slice(0, 400));
  } else {
    console.log(r.result && r.result.result && r.result.result.value);
  }
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
