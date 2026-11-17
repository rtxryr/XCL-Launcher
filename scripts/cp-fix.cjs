// cp-fix.cjs —— 修复本机 fs.cpSync 被击杀（exit 127）的问题
// 用法：node -r ./scripts/cp-fix.cjs node_modules/electron-builder/cli.js --win --x64
//
// 根因（2026-10-31 实测诊断）：
//   - fs.cpSync / fs.promises.cp 在本机 100% 触发进程静默死亡（exit 127，无 JS 堆栈）
//   - 与 WorkBuddy 垫片无关（去掉 NODE_OPTIONS 一样崩）、与沙箱无关（关沙箱一样崩）
//   - 逐文件 copyFileSync 的 JS 循环完全正常（357MB 仅 1.1 秒）
//   - 疑似火绒 HipsDaemon 对原生批量高速写盘的拦截
// 修复：把 cpSync / cp / promises.cp 全部替换为等价的 JS 循环实现。

"use strict";

const fs = require("fs");
const path = require("path");

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isSymbolicLink()) {
      // Electron 运行时无符号链接，稳妥处理一下
      try { fs.copyFileSync(fs.realpathSync(s), d); } catch { /* 跳过坏链接 */ }
    } else if (e.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function safeCpSync(src, dst, opts = {}) {
  const st = fs.lstatSync(src);
  if (st.isDirectory()) {
    if (!opts.filter || opts.filter(src, dst)) copyDirRecursive(src, dst);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// 原生实现留个后门，方便诊断
if (!fs.__nativeCpSync) {
  fs.__nativeCpSync = fs.cpSync;
}

fs.cpSync = function patchedCpSync(src, dst, opts) {
  return safeCpSync(src, dst, opts);
};

fs.cp = function patchedCp(src, dst, opts, cb) {
  if (typeof opts === "function") { cb = opts; opts = undefined; }
  Promise.resolve().then(() => safeCpSync(src, dst, opts))
    .then(() => cb && cb(null))
    .catch((err) => { if (cb) cb(err); else throw err; });
};

fs.promises.cp = async function patchedPromisesCp(src, dst, opts) {
  return safeCpSync(src, dst, opts);
};

// 标记，便于日志确认补丁已生效
process.env.ELECTRON_BUILDER_CP_FIX = "1";
