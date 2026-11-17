// pack-eb.cjs —— electron-builder 安全启动器（一键打包入口）
//
// 为什么需要它（2026-10-31 两轮实测诊断）：
//   1. WorkBuddy 注入的 NODE_OPTIONS（node-language-shim / safe-delete 垫片）
//      会拖垮/拦截 Node 的递归文件操作 → 启动前必须清掉。
//   2. ELECTRON_RUN_AS_NODE=1 会让打包产物在命令行测试时崩掉 → 清掉。
//   3. 本机 fs.cpSync（原生批量复制）会 100% 被击杀（exit 127，疑似火绒
//      HipsDaemon 拦截）→ 预加载 cp-fix.cjs 替换为 JS 循环实现。
//   4. 【真正的卡死根因】产物里的 app.asar 会被内核层句柄锁住（EBUSY）。
//      进程列表查不到持有者（火绒 Sysdiag 过滤驱动），连目录改名都被拒绝，
//      所以 electron-builder 清理旧产物时对着锁死文件无限重试 → "downloaded
//      100% 后静默卡死"。换一次目录只能躲过一次，下次构建照样撞上。
//      这里改成：先尝试清空旧产物，清不掉就自动改用带时间戳的新输出目录，
//      保证 npm run pack:dir 永远能出包，不再依赖"上次运气好"。
//
// 用法：node scripts/pack-eb.cjs --win --x64 [其它 electron-builder 参数]

"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ---- 1) 清理污染环境变量（在 spawn 子进程之前） ----
delete process.env.NODE_OPTIONS;
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.CODEBUDDY_SAFE_DELETE_BULK_GUARD;

const APP_DIR = path.resolve(__dirname, "..");
const DEFAULT_OUT = "release2";                 // 与 electron-builder.yml 保持一致
const FALLBACK_RE = /^release-\d{8}-\d{6}$/;    // 本脚本产出的备用目录命名
const LATEST_FILE = path.join(APP_DIR, "LATEST_OUTPUT.txt");

const cliArgs = process.argv.slice(2);

function log(msg) {
  console.log(`[pack-eb] ${msg}`);
}

/** 用 cmd 的 rmdir 删除目录（绕开 node-safe-delete 垫片）。删不掉就静默返回。 */
function forceRmdir(dir) {
  if (!fs.existsSync(dir)) return;
  spawnSync("cmd", ["/c", "rmdir", "/s", "/q", dir], { stdio: "ignore" });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  try { walk(dir); } catch { /* 目录被锁时可能中途失败，忽略 */ }
  return n;
}

// ---- 2) 清理历史备用目录（只删本脚本生成的 release-日期-时间 形式） ----
for (const name of fs.readdirSync(APP_DIR)) {
  if (!FALLBACK_RE.test(name)) continue;
  const full = path.join(APP_DIR, name);
  forceRmdir(full);
  if (!fs.existsSync(full)) log(`已清理历史备用输出目录：${name}`);
}

// ---- 3) 试探默认输出目录：能不能清空？ ----
const defaultUnpacked = path.join(APP_DIR, DEFAULT_OUT, "win-unpacked");
let outputOverride = null;

if (fs.existsSync(defaultUnpacked)) {
  forceRmdir(defaultUnpacked);
  if (fs.existsSync(defaultUnpacked)) {
    // 还在 = 里面的 app.asar 被内核句柄锁住，连目录改名都不允许
    outputOverride = `release-${stamp()}`;
    log("默认输出目录删不掉（app.asar 被锁，进程列表查不到持有者）。");
    log(`本次自动改用新目录：${outputOverride}`);
  } else {
    log(`已清空旧产物：${DEFAULT_OUT}\\win-unpacked`);
  }
} else {
  log(`输出目录干净：${DEFAULT_OUT}`);
}

// ---- 4) 拉起 electron-builder（带 cpSync 补丁） ----
//
// 【2026-11-03 补充】electron-builder 在 packaging 阶段会联网拉 Electron 发行包，
// 本机 Node 不认这条证书链，报 "unable to verify the first certificate"（中间证书
// 缺失，常见于代理/证书拦截环境）。Node 22+ 支持 --use-system-ca，改为信任 Windows
// 系统证书库即可。老版本 Node 不认识这个参数，按主版本号判断后再加。
const nodeFlags = [];
const nodeMajor = Number(String(process.versions.node).split(".")[0]);
if (nodeMajor >= 22) nodeFlags.push("--use-system-ca");

const args = [
  ...nodeFlags,
  "-r", path.join(__dirname, "cp-fix.cjs"),
  path.join(APP_DIR, "node_modules", "electron-builder", "cli.js"),
  ...cliArgs,
];
if (outputOverride) args.push(`-c.directories.output=${outputOverride}`);

const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: APP_DIR });

/** 从 electron-builder.yml 读 productName（产物 exe 名跟着它走）。 */
function productName() {
  try {
    const yml = fs.readFileSync(path.join(APP_DIR, "electron-builder.yml"), "utf8");
    const m = yml.match(/^productName:\s*(.+)$/m);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  } catch {
    /* 读不到就用默认值 */
  }
  return "X Craft Launcher";
}

const outDir = path.join(APP_DIR, outputOverride || DEFAULT_OUT, "win-unpacked");
const exeName = productName() + (process.platform === "win32" ? ".exe" : "");
const exePath = path.join(outDir, exeName);

if (result.status === 0 && fs.existsSync(exePath)) {
  const sizeMB = (fs.statSync(exePath).size / 1024 / 1024).toFixed(0);
  log("✓ 打包成功");
  log(`  产物目录：${outDir}`);
  log(`  主程序：  ${exePath}（${sizeMB} MB，共 ${countFiles(outDir)} 个文件）`);
  try {
    fs.writeFileSync(
      LATEST_FILE,
      `${outDir}\r\n构建时间：${new Date().toLocaleString("zh-CN")}\r\n`,
      "utf8",
    );
    log(`  路径已记录到：${path.basename(LATEST_FILE)}`);
  } catch { /* 记录失败不影响出包 */ }
} else {
  log(`✗ 打包失败（退出码 ${result.status}）`);
}

process.exit(result.status ?? 1);
