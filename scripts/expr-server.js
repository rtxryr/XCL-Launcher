/**
 * 驱动「一键开服」并跟踪到真正 running（配合 cdp-eval.js --file）。
 * 返回：终端首尾文本、按钮文案、服务器状态变化、最终列表。
 */
(async function () {
  var termEl = document.getElementById('fmsTerm');
  var btnTxt = document.getElementById('fmsAutoTxt');
  var out = { timeline: [] };

  var termText = function () { return termEl ? termEl.innerText : ''; };
  var stateOf = async function () {
    try {
      var r = await window.FMBridge.invoke('server:list', {});
      var arr = Array.isArray(r.data) ? r.data : (r.data && r.data.servers) || [];
      return arr.map(function (s) { return { id: s.id, name: s.name, state: s.state, port: s.port }; });
    } catch (e) { return [{ err: String(e && e.message) }]; }
  };

  out.before = { btn: btnTxt && btnTxt.textContent, servers: await stateOf(), term: termText().slice(-300) };

  if (!window.FMServerPanel || !window.FMServerPanel.autoStart) {
    out.error = 'FMServerPanel.autoStart 不存在';
    return JSON.stringify(out);
  }
  window.FMServerPanel.autoStart();

  var lastSig = '';
  for (var i = 1; i <= 40; i++) {          // 最多 120 秒
    await new Promise(function (r) { setTimeout(r, 3000); });
    var st = await stateOf();
    var sig = JSON.stringify(st.map(function (s) { return s.state; }));
    if (sig !== lastSig) {
      lastSig = sig;
      out.timeline.push({ t: i * 3 + 's', btn: btnTxt && btnTxt.textContent, states: sig });
    }
    var anyRunning = st.some(function (s) { return s.state === 'running'; });
    var bad = /开服失败|创建失败|启动失败/.test(termText());
    if (anyRunning || bad) break;
  }

  out.after = { btn: btnTxt && btnTxt.textContent, servers: await stateOf(), term: termText().slice(-900) };
  out.checks = {
    hasStatusEvent: /状态 → running/.test(termText()),
    hasServerLog: /Starting minecraft server|Preparing level|Done \(/.test(termText()),
    hasStartHint: /已启动 · 端口/.test(termText()),
    liveNum: (document.getElementById('fmsLiveNum') || {}).textContent
  };
  return JSON.stringify(out);
})()
