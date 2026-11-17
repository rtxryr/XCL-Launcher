(async function () {
  var r = await window.FMBridge.invoke('game:stop', {});
  return JSON.stringify({ stop: r, launchText: (document.querySelector('#launchText') || {}).textContent });
})()
