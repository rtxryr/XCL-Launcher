(function () {
  var cards = document.querySelectorAll('#verList .vcard').length;
  var rows = document.querySelectorAll('#verList .ver').length;
  var badges = Array.prototype.map.call(document.querySelectorAll('.vc-badge'), function (x) { return x.textContent; }).slice(0, 5);
  var launchText = (document.querySelector('#launchText') || {}).textContent;
  var chip = !!document.querySelector('#dlChip');
  var bgSwitch = !!document.querySelector('#swBgDl');
  var inst = null;
  try { inst = Array.from(document.querySelectorAll('#verList .ver[data-ver="1.21.4"] .vc-badge')).map(function (x) { return x.textContent; }); } catch (e) {}
  return JSON.stringify({
    bridge: !!(window.FMBridge && window.FMBridge.available),
    cards: cards,
    rows: rows,
    badges: badges,
    launchText: launchText,
    chipMounted: chip,
    bgSwitch: bgSwitch,
    ver1214badge: inst
  });
})()
