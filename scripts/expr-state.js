(function () {
  function t(sel) { var e = document.querySelector(sel); return e ? (e.textContent || '').trim() : null; }
  return JSON.stringify({
    stage: t('#taskStage'),
    sub: t('#taskSub'),
    pct: t('#taskPct'),
    taskHidden: (document.querySelector('#taskCard') || {}).hidden,
    launchText: t('#launchText'),
    btnRunning: (document.querySelector('#launchBtn') || {}).className
  });
})()
