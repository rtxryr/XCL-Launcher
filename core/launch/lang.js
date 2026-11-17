'use strict';

/**
 * 「启动语言」写入器。
 *
 * Minecraft（Java 版）没有命令行参数能指定界面语言，语言只认游戏目录下
 * options.txt 里的 `lang:<code>` 行。所以启动前把这一行对齐到设置项：
 *   - 只改 lang 这一行，其余内容（按键绑定、音量、资源包…）原样保留，
 *     绝不重建整个文件，避免把玩家的其它设置冲掉；
 *   - 文件不存在（全新安装）时只写这一行，其余键由游戏自己补默认值；
 *   - 已经是目标语言就不写盘，减少无意义的文件改动。
 *
 * code 采用游戏内部格式：简体中文 zh_cn、英语 en_us。
 */

const fs = require('fs');
const path = require('path');

// 形如 zh_cn / en_us / es_mx 这类合法语言码，挡掉奇怪输入
const LANG_RE = /^[a-z]{2,3}(?:_[a-z]{2,4})?$/i;
const LANG_LINE = /^\s*lang\s*:/i;

/**
 * @param {string} gameDir 游戏目录（options.txt 所在目录）
 * @param {string} code    语言码，如 zh_cn / en_us
 * @returns {{ok:boolean, changed:boolean, lang?:string, file?:string, reason?:string}}
 */
function applyGameLanguage(gameDir, code) {
  const lang = String(code == null ? '' : code).trim().toLowerCase();
  if (!lang || !LANG_RE.test(lang)) return { ok: false, changed: false, reason: 'invalid-lang' };
  if (!gameDir || !fs.existsSync(gameDir)) return { ok: false, changed: false, reason: 'no-dir' };

  const file = path.join(gameDir, 'options.txt');
  try {
    let raw = '';
    if (fs.existsSync(file)) raw = fs.readFileSync(file, 'utf8');

    // 保留原文件的换行风格，Linux/mac 上用 \n，Windows 上通常是 \r\n
    const eol = raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    const lines = raw ? raw.split(/\r?\n/) : [];
    const hit = lines.some((line) => LANG_LINE.test(line));

    const next = hit
      ? lines.map((line) => (LANG_LINE.test(line) ? 'lang:' + lang : line))
      : lines.concat('lang:' + lang);

    let out = next.join(eol);
    if (!raw) out += eol; // 新建文件补一个换行，别让最后一行没有行尾

    if (out === raw) return { ok: true, changed: false, lang, file };

    fs.writeFileSync(file, out, 'utf8');
    return { ok: true, changed: true, lang, file };
  } catch (err) {
    return { ok: false, changed: false, lang, file, reason: String((err && err.message) || err) };
  }
}

/** 只读查询当前游戏目录里的语言（给 UI/诊断用，不做修改） */
function readGameLanguage(gameDir) {
  try {
    const file = path.join(gameDir || '', 'options.txt');
    if (!gameDir || !fs.existsSync(file)) return '';
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (LANG_LINE.test(line)) return line.slice(line.indexOf(':') + 1).trim();
    }
  } catch {
    /* 读不到就当没设置 */
  }
  return '';
}

module.exports = { applyGameLanguage, readGameLanguage, LANG_RE };
