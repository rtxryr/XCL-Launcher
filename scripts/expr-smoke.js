/**
 * 冒烟测试表达式（electron-builder 出包后的成品 exe 用）。
 *
 * 目的：确认「界面渲染 → preload 桥 → 主进程 game:* 通道 → 磁盘路径」整条链路都活着，
 * 而不是"文件打进去了但运行时崩掉"。返回 JSON 供 cdp-eval.js 打印。
 */
(async function () {
  var q = function (s) { return document.querySelector(s); };
  var out = {
    bridge: !!(window.FMBridge && window.FMBridge.available),
    title: document.title,
    cards: document.querySelectorAll('#verList .vcard').length,
    rows: document.querySelectorAll('#verList .ver').length,
    viewSeg: !!q('#viewSeg'),
    pageDetail: !!q('#page-detail'),
    setGameDir: !!q('#setGameDir'),
    bgSwitch: !!q('#swBgDl'),
    dlChip: !!q('#dlChip')
  };

  // 主进程直处理通道：路径解析（这是"默认装到 exe 同级 Game"的依据）
  try {
    var p = await window.FMBridge.invoke('app:paths', {});
    out.pathsOk = !!(p && p.ok);
    out.exeDir = p && p.data ? p.data.exeDir : null;
    out.defaultGameDir = p && p.data ? p.data.defaultGameDir : null;
  } catch (e) {
    out.pathsOk = false;
    out.pathsErr = String(e && e.message ? e.message : e);
  }

  // 主进程游戏通道：读取已安装版本（证明 game 状态机 + 磁盘扫描在成品包里能跑）
  try {
    var v = await window.FMBridge.invoke('game:installed', {});
    out.installedOk = !!(v && v.ok);
    out.installedCount = v && v.data && v.data.versions ? v.data.versions.length : 0;
    out.installedIds = v && v.data && v.data.versions
      ? v.data.versions.map(function (x) { return x.id || x.versionId; }).slice(0, 5)
      : [];
    if (v && !v.ok) out.installedErr = v.error;
  } catch (e) {
    out.installedOk = false;
    out.installedErr = String(e && e.message ? e.message : e);
  }

  return JSON.stringify(out);
})()
