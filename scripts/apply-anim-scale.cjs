/* 把 CSS 中所有 transition / animation 声明里的时间字面量包成 calc(X * var(--anim-k))，
   使「全局响应速度」能统一缩放全站过渡；保留原有各元素时长比例。幂等。 */
const fs = require('fs');
const P = 'E:/任衍瑞/软件开发/XCL 前端/X Craft Launcher 前端.html';
let s = fs.readFileSync(P, 'utf8');
if (s.indexOf('var(--anim-k)') >= 0) { console.log('已处理过，跳过'); process.exit(0); }
let n = 0;
s = s.replace(/(<style>)([\s\S]*?)(<\/style>)/g, (m, a, css, c) => {
  const out = css.replace(
    /((?:transition|animation)(?:-duration|-delay)?\s*:\s*)([^;{}]+)/g,
    (full, head, val) => {
      if (val.indexOf('var(--anim-k)') >= 0) return full;
      const nv = val.replace(/(\d*\.?\d+)(ms|s)(?![\w])/g, (t, num, unit) => {
        n++;
        return 'calc(' + num + unit + ' * var(--anim-k))';
      });
      return head + nv;
    }
  );
  return a + out + c;
});
fs.writeFileSync(P, s);
console.log('包装时间字面量:', n, '处');
