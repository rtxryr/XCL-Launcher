(function () {
  var heroVer = (document.querySelector('#heroVer') || {}).textContent;
  var btn = document.querySelector('#launchBtn');
  if (!btn) return JSON.stringify({ error: 'no launch button' });
  btn.click();
  return JSON.stringify({ heroVer: heroVer, clicked: true });
})()
