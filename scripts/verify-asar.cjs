// verify-asar.cjs —— 校验打包产物（asar 内容 / 前端哈希 / 运行时文件数）
// 用法：node scripts/verify-asar.cjs <win-unpacked 目录>
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const asar = require("@electron/asar");

const FRONT = "E:\\任衍瑞\\软件开发\\XCL 前端\\X Craft Launcher 前端.html";

const dir = process.argv[2];
if (!dir) {
  console.error("用法: node scripts/verify-asar.cjs <win-unpacked 目录>");
  process.exit(1);
}

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

let fail = 0;
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fail++;
};

const asarPath = path.join(dir, "resources", "app.asar");
const exePath = path.join(dir, "X Craft Launcher.exe");

ok(fs.existsSync(exePath), "exe 存在");
ok(fs.existsSync(asarPath), "resources/app.asar 存在");

// 运行时文件数
let n = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name));
    else n++;
  }
};
walk(dir);
ok(n >= 70 && n <= 78, "运行时文件数约 72", `实际 ${n}`);

// asar 内 index.html 与前端主文件哈希一致
const raw = asar.extractFile(asarPath, "ui/index.html");
const asarHash = crypto.createHash("sha256").update(raw).digest("hex");
const frontHash = sha(FRONT);
ok(asarHash === frontHash, "asar 内 ui/index.html 与前端主文件哈希一致", `${asarHash.slice(0, 16)}… / ${frontHash.slice(0, 16)}…`);

// 也校验打包源 ui/index.html
const srcHash = sha(path.join(__dirname, "..", "ui", "index.html"));
ok(srcHash === frontHash, "打包源 ui/index.html 与前端主文件哈希一致");

// 必需模块
const list = asar.listPackage(asarPath);
const has = (name) => list.some((f) => f.replace(/\\/g, "/") === "/" + name);
for (const m of ["main.js", "preload.js", "update-service.js", "package.json", "ui/index.html"]) {
  ok(has(m), `asar 含 ${m}`);
}

// preload / main 里的关键通道
const pre = asar.extractFile(asarPath, "preload.js").toString("utf8");
ok(pre.includes("fmbridge"), "preload 暴露 fmbridge");

const us = asar.extractFile(asarPath, "update-service.js").toString("utf8");
// 2026-11-05：旧版按「只有一个子目录」下钻，会把 resources/* 摊到安装根目录并漏掉 exe，
// 导致更新「假装成功」。这条断言防止退回旧逻辑。
ok(
  us.includes("$items.Count -eq 1 -and $items[0].PSIsContainer"),
  "update-service.js 含 strip 下钻判定修复（PSIsContainer）",
);
// 暂存目录 + robocopy 覆盖（不要退回直解到安装目录）
ok(us.includes("robocopy"), "update-service.js 使用 robocopy 合并覆盖");
ok(us.includes("xcl-upd-stage-"), "update-service.js 使用独立暂存目录");
for (const ch of ["app:info", "update:check", "update:apply", "update:dismiss"]) {
  ok(us.includes(ch) || pre.includes(ch) || asar.extractFile(asarPath, "ui/index.html").toString("utf8").includes(ch), `通道 ${ch} 可用`);
}

console.log(fail === 0 ? "\n全部通过" : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
