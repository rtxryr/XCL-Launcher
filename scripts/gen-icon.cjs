/**
 * gen-icon.cjs —— 把带背景的图标（jpg/png）抠成透明 PNG。
 *
 * 为什么要自己写：本机没有 Pillow / ImageMagick，但 Electron 自带 Chromium
 * 解码器。nativeImage 只能解码和缩放，不能抠图，所以这里：
 *   1. 用 nativeImage 把源图解码成 BGRA 位图；
 *   2. 自己做背景分割（边界洪水填充 + 亮色兜底 + 边缘反预乘去白边）；
 *   3. 自己写 PNG 编码（zlib 内置），保证是直通 alpha，避免 Electron
 *      createFromBitmap 预乘语义带来的争议。
 *
 * 分割策略（针对"深色徽标 + 浅灰背景"这类图）：
 *   - 背景色取四角/四边采样；
 *   - 从边框做洪水填充，容差内视为背景（能吃下渐变，不会吃掉主体）；
 *   - 兜底：低饱和 + 高亮度的像素一律算背景（清掉水印、光晕、浅灰阴影）；
 *   - 边缘 1~2px 用"到背景色的距离"算软 alpha，并做反预乘，去掉白边。
 *
 * 用法（必须在 desktop-app 目录、且清掉 ELECTRON_RUN_AS_NODE）：
 *   ./node_modules/electron/dist/electron.exe scripts/gen-icon.cjs <源图> <输出.png>
 */
const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = process.argv[2];
const DST = process.argv[3] || path.join(__dirname, "..", "build", "icon.png");

app.disableHardwareAcceleration();

/* ------------------------------------------------------------------ PNG 编码 */
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA 缓冲 → PNG（filter 0，无损） */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- 抠图主逻辑 */
function cutout(bgra, W, H) {
  const N = W * H;
  const R = new Uint8Array(N);
  const G = new Uint8Array(N);
  const B = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    B[i] = bgra[i * 4];
    G[i] = bgra[i * 4 + 1];
    R[i] = bgra[i * 4 + 2];
  }

  // 1) 背景色：取四条边（不含最外 2px，避开可能的边框线）的中位数采样
  const samples = [];
  const push = (x, y) => {
    const i = y * W + x;
    samples.push([R[i], G[i], B[i]]);
  };
  for (let x = 4; x < W - 4; x += 17) { push(x, 2); push(x, H - 3); }
  for (let y = 4; y < H - 4; y += 17) { push(2, y); push(W - 3, y); }
  const med = (k) => {
    const v = samples.map((s) => s[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const bg = [med(0), med(1), med(2)];

  const dist = (i) => {
    const dr = R[i] - bg[0];
    const dg = G[i] - bg[1];
    const db = B[i] - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  // 2) 洪水填充：从四边出发，容差内的浅色连通区域算背景
  const FILL_TOL = 52;
  const isBg = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const seed = (i) => {
    if (isBg[i]) return;
    if (dist(i) > FILL_TOL) return;
    isBg[i] = 1;
    stack[sp++] = i;
  };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }

  while (sp > 0) {
    const i = stack[--sp];
    const x = i % W;
    const y = (i / W) | 0;
    if (x > 0) { const j = i - 1; if (!isBg[j] && dist(j) <= FILL_TOL) { isBg[j] = 1; stack[sp++] = j; } }
    if (x < W - 1) { const j = i + 1; if (!isBg[j] && dist(j) <= FILL_TOL) { isBg[j] = 1; stack[sp++] = j; } }
    if (y > 0) { const j = i - W; if (!isBg[j] && dist(j) <= FILL_TOL) { isBg[j] = 1; stack[sp++] = j; } }
    if (y < H - 1) { const j = i + W; if (!isBg[j] && dist(j) <= FILL_TOL) { isBg[j] = 1; stack[sp++] = j; } }
  }

  // 3) 兜底：低饱和 + 高亮度 → 也算背景（水印、浅灰阴影、溢出的光晕）
  let extra = 0;
  for (let i = 0; i < N; i++) {
    if (isBg[i]) continue;
    const r = R[i], g = G[i], b = B[i];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum >= 198 && mx - mn <= 26) { isBg[i] = 1; extra++; }
  }

  // 4) 软 alpha：到背景色的距离决定过渡，并做反预乘去掉白边
  const rgba = Buffer.alloc(N * 4);
  const SOFT_MIN = 46; // 小于它完全是背景
  const SOFT_MAX = 132; // 大于它完全是主体
  let softCount = 0;

  const isEdge = (i) => {
    const x = i % W;
    const y = (i / W) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (isBg[ny * W + nx]) return true;
      }
    }
    return false;
  };

  for (let i = 0; i < N; i++) {
    const o = i * 4;
    if (isBg[i]) {
      rgba[o] = 0; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = 0;
      continue;
    }
    let a = 255;
    let r = R[i], g = G[i], b = B[i];
    if (isEdge(i)) {
      const d = dist(i);
      const t = Math.max(0, Math.min(1, (d - SOFT_MIN) / (SOFT_MAX - SOFT_MIN)));
      a = Math.round(t * 255);
      softCount++;
      if (a > 0 && a < 255) {
        // 原图 = a*主体 + (1-a)*背景  →  反解主体颜色，避免半透明像素发白
        const k = a / 255;
        const fix = (c, bc) => Math.max(0, Math.min(255, Math.round((c - bc * (1 - k)) / k)));
        r = fix(r, bg[0]);
        g = fix(g, bg[1]);
        b = fix(b, bg[2]);
      }
    }
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
  }

  // 统计
  let opaque = 0;
  for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] === 255) opaque++;
  return { rgba, bg, extra, softCount, opaque };
}

/* ----------------------------------------------------------------- 预览拼图 */
function makePreview(rgba, W, H) {
  // 上：深色底，下：浅色底，左：棋盘格 —— 一眼看出透明是否干净
  const PW = W;
  const PH = H * 2;
  const out = Buffer.alloc(PW * PH * 4);
  const put = (x, y, r, g, b, a) => {
    const o = (y * PW + x) * 4;
    const k = a / 255;
    out[o] = Math.round(r * k + out[o] * (1 - k));
    out[o + 1] = Math.round(g * k + out[o + 1] * (1 - k));
    out[o + 2] = Math.round(b * k + out[o + 2] * (1 - k));
    out[o + 3] = 255;
  };
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      let r, g, b;
      if (y < H) { r = 18; g = 22; b = 20; }               // 深色主题底
      else {
        const cell = ((x / 64) | 0) + ((y / 64) | 0);
        r = g = b = cell % 2 === 0 ? 240 : 208;            // 棋盘格
      }
      const o = (y * PW + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = rgba[i + 3];
      if (!a) continue;
      put(x, y, rgba[i], rgba[i + 1], rgba[i + 2], a);
      put(x, y + H, rgba[i], rgba[i + 1], rgba[i + 2], a);
    }
  }
  return encodePng(out, PW, PH);
}

/* -------------------------------------------------------------------- 主流程 */
app.whenReady().then(() => {
  try {
    if (!SRC) throw new Error("缺少源图参数");
    const img = nativeImage.createFromPath(SRC);
    if (img.isEmpty()) throw new Error("源图无法解码：" + SRC);
    const { width: W, height: H } = img.getSize();
    console.log(`源图：${W}x${H}`);

    const bmp = img.toBitmap();
    if (bmp.length !== W * H * 4) throw new Error(`位图长度异常：${bmp.length} != ${W * H * 4}`);

    const t0 = Date.now();
    const { rgba, bg, extra, softCount, opaque } = cutout(bmp, W, H);
    const total = W * H;
    console.log(`背景色采样：rgb(${bg.join(",")})`);
    console.log(`洪水填充 + 亮色兜底：额外清除 ${extra} px`);
    console.log(`保留像素 ${opaque}（${((opaque / total) * 100).toFixed(1)}%），软边 ${softCount} px，耗时 ${Date.now() - t0}ms`);

    fs.mkdirSync(path.dirname(DST), { recursive: true });
    fs.writeFileSync(DST, encodePng(rgba, W, H));
    console.log(`已写出透明 PNG：${DST}（${(fs.statSync(DST).size / 1024).toFixed(0)} KB）`);

    const prev = path.join(path.dirname(DST), "_icon_preview.png");
    fs.writeFileSync(prev, makePreview(rgba, W, H));
    console.log(`预览（上深色 / 下棋盘）：${prev}`);
  } catch (e) {
    console.error("抠图失败：", e && e.message ? e.message : e);
    app.exit(1);
    return;
  }
  app.quit();
});
