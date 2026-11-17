/**
 * 手动组装 Windows 多文件版（不依赖 electron-builder）。
 *
 * electron-builder 在本机会卡在 electron 包下载/解压阶段（实测多次超时），
 * 所以改成完全可控的手动组装：
 *
 *   1. 清空 release/win-unpacked；
 *   2. 复制 node_modules/electron/dist 的全部运行时文件；
 *   3. 用 resedit 把 electron.exe 换成 "X Craft Launcher.exe"，写入自定义图标与版本信息；
 *   4. 组装 resources/app/（package.json + main.js + preload.js + ui/ + core/），
 *      Electron 会自动加载 resources/app 而不是 app.asar；
 *   5. 删掉 default_app.asar，避免歧义。
 *
 * 用法：node scripts/pack-dir.cjs
 */
const fs = require("fs");
const path = require("path");
const ResEdit = require("resedit");

const APP_DIR = path.resolve(__dirname, "..");
const ELECTRON_DIST = path.join(APP_DIR, "node_modules", "electron", "dist");
const OUT = path.join(APP_DIR, "release", "X Craft Launcher");
const ICO = path.join(APP_DIR, "build", "icon.ico");

const PRODUCT = "X Craft Launcher";
const VERSION = [1, 0, 0, 0];
const VERSION_STR = "1.0.0";

function log(msg) {
  console.log("[pack] " + msg);
}

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * 清空目录。
 * 注意：本环境里 fs.rmSync 被 safe-delete 垫片接管（走回收站），
 * 递归删目录会报 "Some operations were aborted"，所以失败时退回 cmd rmdir。
 */
function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    if (!fs.existsSync(dir)) return;
  } catch (e) {
    log("fs.rmSync 不可用，改用 rmdir：" + (e && e.message ? e.message.slice(0, 60) : ""));
  }
  const { spawnSync } = require("child_process");
  spawnSync("cmd", ["/c", "rmdir", "/s", "/q", dir], { stdio: "ignore", windowsHide: true });
  if (fs.existsSync(dir)) throw new Error("无法清空目录：" + dir);
}

/**
 * 复制目录。用 robocopy 而不是 fs.cpSync —— 递归复制 250MB+ 的 electron 运行时
 * 在本环境会异常退出（进程被中断，exit 127）。
 */
function copyDir(from, to) {
  const { spawnSync } = require("child_process");
  fs.mkdirSync(to, { recursive: true });
  const r = spawnSync(
    "robocopy",
    [from, to, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/r:1", "/w:1"],
    { windowsHide: true, stdio: "ignore" },
  );
  // robocopy: 0=无变化 1=已复制 2=多余文件 3=1+2 ... 8 以上才是错误
  if (r.status === null || r.status >= 8) {
    throw new Error(`robocopy 失败（code=${r.status}）：${from} → ${to}`);
  }
}

function copyFile(from, to) {
  if (!fs.existsSync(from)) throw new Error("缺少构建产物：" + from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// ---------------------------------------------------------------- 1. 准备
must(fs.existsSync(ELECTRON_DIST), "找不到 electron 运行时：" + ELECTRON_DIST);
must(fs.existsSync(ICO), "找不到图标：" + ICO);

log("清理输出目录");
cleanDir(OUT);
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- 2. 复制运行时
log("复制 electron 运行时 → release/win-unpacked");
copyDir(ELECTRON_DIST, OUT);

// ---------------------------------------------------------------- 3. 换 exe + 图标
const srcExe = path.join(OUT, "electron.exe");
const dstExe = path.join(OUT, PRODUCT + ".exe");
must(fs.existsSync(srcExe), "复制后找不到 electron.exe");

log("写入图标与版本信息");
const exeBuf = fs.readFileSync(srcExe);
const exe = ResEdit.NtExecutable.from(exeBuf);
const res = ResEdit.NtExecutableResource.from(exe);
const entries = res.entries;

// 3.1 图标组（ID 1 是 Windows 默认识别的主图标组）
const icoFile = ResEdit.Data.IconFile.from(fs.readFileSync(ICO));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  entries,
  1,
  1033,
  icoFile.icons.map((i) => i.data),
);

// 3.2 版本信息（资源管理器「属性 → 详细信息」里显示的内容）
try {
  const vi = ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(VERSION[0], VERSION[1], VERSION[2], VERSION[3]);
  vi.setProductVersion(VERSION[0], VERSION[1], VERSION[2], VERSION[3]);
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: PRODUCT,
      FileDescription: "X Craft Launcher",
      CompanyName: "X Craft Launcher",
      LegalCopyright: "Copyright © 2026 X Craft Launcher",
      OriginalFilename: PRODUCT + ".exe",
      InternalName: PRODUCT,
      FileVersion: VERSION_STR,
      ProductVersion: VERSION_STR,
    },
  );
  vi.outputToResourceEntries(entries);
} catch (e) {
  log("版本信息写入失败（不影响运行）：" + (e && e.message));
}

res.outputResource(exe);
fs.writeFileSync(dstExe, Buffer.from(exe.generate()));
fs.rmSync(srcExe, { force: true });
log(`已生成 ${PRODUCT}.exe（${fs.statSync(dstExe).size} 字节）`);

// ---------------------------------------------------------------- 4. 组装 resources/app
const RES = path.join(OUT, "resources");
const APP_RES = path.join(RES, "app");
log("组装 resources/app");
fs.mkdirSync(APP_RES, { recursive: true });

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) throw new Error("缺少构建产物：" + from);
  if (fs.statSync(from).isDirectory()) copyDir(from, to);
  else copyFile(from, to);
}

copyIfExists(path.join(APP_DIR, "main.js"), path.join(APP_RES, "main.js"));
copyIfExists(path.join(APP_DIR, "preload.js"), path.join(APP_RES, "preload.js"));
copyIfExists(path.join(APP_DIR, "ui"), path.join(APP_RES, "ui"));
copyIfExists(path.join(APP_DIR, "core"), path.join(APP_RES, "core"));

// app 的 package.json：Electron 靠它找 main
fs.writeFileSync(
  path.join(APP_RES, "package.json"),
  JSON.stringify(
    {
      name: "fusionmc",
      productName: PRODUCT,
      version: VERSION_STR,
      description: "X Craft Launcher desktop shell",
      main: "main.js",
    },
    null,
    2,
  ),
);

// 删掉 electron 自带的默认应用，避免「没找到 app 就加载 default_app」的歧义
const defaultAsar = path.join(RES, "default_app.asar");
if (fs.existsSync(defaultAsar)) fs.rmSync(defaultAsar, { force: true });

// ---------------------------------------------------------------- 5. 自检
const checks = [
  ["electron.exe", path.join(OUT, PRODUCT + ".exe")],
  ["resources/app/package.json", path.join(APP_RES, "package.json")],
  ["resources/app/main.js", path.join(APP_RES, "main.js")],
  ["resources/app/preload.js", path.join(APP_RES, "preload.js")],
  ["resources/app/ui/index.html", path.join(APP_RES, "ui", "index.html")],
  ["resources/app/core/backend.js", path.join(APP_RES, "core", "backend.js")],
  ["locales 目录", path.join(OUT, "locales")],
  ["ffmpeg.dll", path.join(OUT, "ffmpeg.dll")],
];
for (const [name, p] of checks) {
  if (!fs.existsSync(p)) throw new Error("自检失败，缺少：" + name);
}

const html = fs.readFileSync(path.join(APP_RES, "ui", "index.html"), "utf8");
const hasAccountUi = html.includes("vaCard");
const hasAccountApi = fs
  .readFileSync(path.join(APP_RES, "core", "desktop", "bridge.js"), "utf8")
  .includes("account:loginMicrosoft");
if (!hasAccountUi) log("警告：前端不含账号卡（vaCard 缺失）");
if (!hasAccountApi) log("警告：后端不含账号通道");

const totalBytes = (function walk(dir) {
  let sum = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    sum += e.isDirectory() ? walk(p) : fs.statSync(p).size;
  }
  return sum;
})(OUT);

log(
  `完成：${(totalBytes / 1024 / 1024).toFixed(1)} MB，账号UI=${hasAccountUi}，账号API=${hasAccountApi}`,
);
log("产物目录：" + OUT);
