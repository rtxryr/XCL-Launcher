/** 验证服务端控制台命令链路：server:command → stdin（配合 cdp-eval.js --file）。 */
(async function () {
  var list = await window.FMBridge.invoke('server:list', {});
  var arr = Array.isArray(list.data) ? list.data : (list.data && list.data.servers) || [];
  var s = arr.filter(function (x) { return x.state === 'running'; })[0];
  if (!s) return JSON.stringify({ error: '没有运行中的服务器', arr: arr });

  var r1 = await window.FMBridge.invoke('server:command', { id: s.id, command: 'list' });
  await new Promise(function (res) { setTimeout(res, 1500); });
  var r2 = await window.FMBridge.invoke('server:command', { id: s.id, command: 'say 一键开服自检' });
  await new Promise(function (res) { setTimeout(res, 1200); });

  var term = (document.getElementById('fmsTerm') || {}).innerText || '';
  return JSON.stringify({
    server: s.id,
    listCmd: r1,
    sayCmd: r2,
    termTail: term.slice(-400),
    sawListOutput: /There are 0 of a max|players online/.test(term),
    sawSay: /一键开服自检/.test(term)
  });
})()
