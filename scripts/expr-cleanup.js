/** 收尾：验证停止命令 + 删除本次测试创建的服务端（配合 cdp-eval.js --file）。 */
(async function () {
  var termEl = document.getElementById('fmsTerm');
  var input = termEl.querySelector('input');
  var type = async function (line, waitMs) {
    input.focus();
    input.value = line;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await new Promise(function (r) { setTimeout(r, waitMs || 3000); });
  };
  var states = async function () {
    var r = await window.FMBridge.invoke('server:list', {});
    var arr = Array.isArray(r.data) ? r.data : (r.data && r.data.servers) || [];
    return arr.map(function (s) { return s.name + ':' + s.state; });
  };

  var out = { before: await states() };

  // 1) 停止运行中的服
  await type('stop e2e-test', 6000);
  out.afterStop = await states();

  // 2) 删除本次测试创建的临时服（不是用户原有的 e2e-test）
  var rm = await window.FMBridge.invoke('server:remove', { id: 'srv_mw0rak8r_45sf6' });
  out.removeResult = { ok: rm.ok, error: rm.error };
  await new Promise(function (r) { setTimeout(r, 1500); });
  out.afterRemove = await states();
  out.termTail = (termEl.innerText || '').slice(-400);
  return JSON.stringify(out);
})()
