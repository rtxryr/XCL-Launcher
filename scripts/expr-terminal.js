/**
 * 走真实界面输入路径验证控制台命令（配合 cdp-eval.js --file）。
 * 直接在终端输入框里敲命令并派发 Enter，覆盖「前端字段名 → 桥接 → 服务端 stdin」全链。
 */
(async function () {
  var termEl = document.getElementById('fmsTerm');
  var input = termEl ? termEl.querySelector('input') : null;
  var out = { foundInput: !!input, steps: [] };
  if (!input) return JSON.stringify(out);

  var type = async function (line) {
    input.focus();
    input.value = line;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await new Promise(function (r) { setTimeout(r, 2500); });
  };

  await type('list');
  out.steps.push({ cmd: 'list', tail: (termEl.innerText || '').slice(-300) });

  await type('say 一键开服自检');
  out.steps.push({ cmd: 'say', tail: (termEl.innerText || '').slice(-300) });

  var txt = termEl.innerText || '';
  out.checks = {
    cmdAccepted: /There are 0 of a max|players online/.test(txt),
    sayDelivered: /一键开服自检/.test(txt),
    noParamError: !/参数 cmd 不能为空/.test(txt)
  };
  return JSON.stringify(out);
})()
