const fs = require('fs');
const P = 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
const html = fs.readFileSync(P, 'utf8');

const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, err = 0;
while ((m = re.exec(html))) {
  i++;
  const c = m[1];
  if (!c.trim()) continue;
  try { new Function(c); } catch (e) { err++; console.log('✗ script#' + i + ' 语法错误: ' + e.message); }
}
console.log('script 块 ' + i + ' 个，语法错误 ' + err + ' 个');

console.log('--- 旧实现残留 ---');
['data-rail', 'railSeg', 'railSpeedHint', 'RAIL_SPEED', 'setRailSpeed', 'mc.railSpeed']
  .forEach(k => console.log('  ' + k + ': ' + (html.split(k).length - 1)));

console.log('--- 新实现 ---');
['data-speed=', 'speedSeg', 'speedHint', 'setSpeed', 'mc.animSpeed', 'window.animMs', '--anim-k', 'seg-speed']
  .forEach(k => console.log('  ' + k + ': ' + (html.split(k).length - 1)));

console.log('6 档按钮: ' + (html.match(/data-speed="(none|ultra|fast|mid|slow|slowest)"/g) || []).length);
console.log('CSS 变量档位规则: ' + (html.match(/html\[data-speed="[a-z]+"\]\{--anim-k/g) || []).length);

console.log('--- 倍率包装统计 ---');
console.log('calc( 总数: ' + (html.match(/calc\(/g) || []).length);
console.log('var(--anim-k) 总数: ' + (html.match(/var\(--anim-k\)/g) || []).length);
console.log('双重 calc(calc(: ' + (html.match(/calc\(calc\(/g) || []).length);

console.log('--- 标签配平 ---');
console.log('div 开/闭: ' + (html.match(/<div\b/g) || []).length + '/' + (html.match(/<\/div>/g) || []).length);
console.log('button 开/闭: ' + (html.match(/<button\b/g) || []).length + '/' + (html.match(/<\/button>/g) || []).length);

console.log('--- 未被包装的 transition/animation 时间字面量 ---');
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const bad = [];
for (const d of css.split(';')) {
  const t = d.trim().replace(/[\n\r]+/g, ' ');
  if (!/^(transition|animation|-\w+-transition)/.test(t)) continue;
  const mt = t.match(/(?<![\w-])\d*\.?\d+(ms|s)(?![\w])/g);
  if (mt && t.indexOf('var(--anim-k)') < 0) bad.push(t.slice(0, 120));
}
console.log(bad.length ? bad.join('\n') : '  (无)');

console.log('--- 档位表数值 ---');
css.split('\n').filter(l => /html\[data-speed="/.test(l)).forEach(l => console.log('  ' + l.trim()));
