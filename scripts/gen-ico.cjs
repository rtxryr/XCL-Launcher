/**
 * 用 Electron 的 nativeImage 把源图转成多尺寸 PNG 并拼成 Windows .ico。
 *
 * 为什么要用 Electron：本机没有 Pillow / ImageMagick，而 Electron 自带
 * Chromium 的图片解码（支持 jpg/png），nativeImage.resize 能做高质量缩放。
 *
 * 用法（必须在项目目录、且清掉 ELECTRON_RUN_AS_NODE 后运行）：
 *   unset ELECTRON_RUN_AS_NODE
 *   ./node_modules/electron/dist/electron.exe scripts/gen-ico.cjs <源图> <输出.ico>
 */
const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2];
const DST = process.argv[3] || path.join(__dirname, "..", "build", "icon.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.disableHardwareAcceleration();

/** 把若干 PNG 缓冲拼成 ICO（Vista+ 支持内嵌 PNG，无需 BMP 编码） */
function buildIco(pngs, sizes) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + 16 * count;
  for (let i = 0; i < count; i++) {
    const png = pngs[i];
    const sz = sizes[i];
    const e = Buffer.alloc(16);
    e[0] = sz >= 256 ? 0 : sz; // 0 表示 256
    e[1] = sz >= 256 ? 0 : sz;
    e[2] = 0; // 调色板
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

app.whenReady().then(() => {
  try {
    if (!SRC) throw new Error("缺少源图参数");
    const img = nativeImage.createFromPath(SRC);
    if (img.isEmpty()) throw new Error("源图无法解码：" + SRC);
    const { width, height } = img.getSize();
    console.log(`源图: ${width}x${height}`);

    const pngs = [];
    for (const sz of SIZES) {
      const scaled = img.resize({ width: sz, height: sz, quality: "best" });
      pngs.push(scaled.toPNG());
    }
    const ico = buildIco(pngs, SIZES);
    fs.mkdirSync(path.dirname(DST), { recursive: true });
    fs.writeFileSync(DST, ico);
    console.log(`已写出 ICO: ${DST} (${SIZES.join("/")}，${ico.length} 字节)`);
  } catch (e) {
    console.error("生成 ICO 失败:", e && e.message ? e.message : e);
    app.exit(1);
    return;
  }
  app.quit();
});
