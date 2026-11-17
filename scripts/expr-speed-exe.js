/* 成品 exe 验证：走真实按钮点击，验 6 档 + 无动画展开；测完恢复用户原有设置 */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = {};
  const d = document.documentElement;
  const seg = document.getElementById('speedSeg');
  if (!seg) return JSON.stringify({ err: 'speedSeg 不存在' });
  const btns = [].slice.call(seg.querySelectorAll('button'));
  const rail = document.getElementById('rail');

  const snap = {
    s: localStorage.getItem('mc.animSpeed'),
    r: localStorage.getItem('mc.railSpeed'),
    rail: localStorage.getItem('mc.rail'),
    pin: localStorage.getItem('mc.railPin'),
    speed: d.getAttribute('data-speed'),
    open: rail.classList.contains('open')
  };
  out.before = snap;

  out.buttons = btns.map(b => b.textContent.trim());
  out.inGeneral = document.getElementById('tab-general').contains(seg);
  out.oldGone = !document.getElementById('railSeg');

  const read = () => {
    const cs = getComputedStyle(d);
    const pg = document.querySelector('.page.active') || document.querySelector('.page');
    return {
      k: cs.getPropertyValue('--anim-k').trim(),
      railDur: getComputedStyle(rail).transitionDuration,
      btnDur: getComputedStyle(btns[0]).transitionDuration,
      pageAnimDur: pg ? getComputedStyle(pg).animationDuration : null,
      ms320: window.animMs(320),
      on: (seg.querySelector('button.on') || {}).textContent,
      saved: localStorage.getItem('mc.animSpeed')
    };
  };

  out.modes = {};
  for (const m of ['none', 'ultra', 'fast', 'mid', 'slow', 'slowest']) {
    seg.querySelector('button[data-speed="' + m + '"]').click();
    await sleep(70);
    out.modes[m] = read();
  }

  /* 无动画档：点三条杠后第一帧就应该到位 */
  seg.querySelector('button[data-speed="none"]').click();
  if (rail.classList.contains('open')) document.getElementById('railToggle').click();
  await sleep(250);
  out.widthBefore = Math.round(rail.getBoundingClientRect().width);
  document.getElementById('railToggle').click();
  await sleep(35);
  out.widthAt35ms = Math.round(rail.getBoundingClientRect().width);
  await sleep(450);
  out.widthAtEnd = Math.round(rail.getBoundingClientRect().width);

  /* 全站零过渡扫描 */
  out.noneScan = (function () {
    const nz = s => /(^|[,\s])(0?\.[1-9]|[1-9])/.test(s || '');
    let bad = 0, checked = 0;
    const els = document.querySelectorAll('body *');
    for (let i = 0; i < els.length; i++) {
      const cs = getComputedStyle(els[i]); checked++;
      if (nz(cs.transitionDuration) || nz(cs.animationDuration) || nz(cs.transitionDelay) || nz(cs.animationDelay)) bad++;
    }
    return { checked: checked, nonZero: bad };
  })();

  /* 恢复用户设置 */
  const restore = (k, v) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); };
  restore('mc.animSpeed', snap.s);
  restore('mc.railSpeed', snap.r);
  restore('mc.rail', snap.rail);
  restore('mc.railPin', snap.pin);
  const back = snap.speed || 'slow';
  d.setAttribute('data-speed', back);
  btns.forEach(b => b.classList.toggle('on', b.dataset.speed === back));
  const DUR = { none: '0s', ultra: '0.12s', fast: '0.18s', mid: '0.30s', slow: '0.42s', slowest: '0.80s' };
  const hint = document.getElementById('speedHint');
  if (hint) hint.textContent = '当前 ' + (DUR[back] || '0.42s') + ' · 全站生效';
  if (rail.classList.contains('open') !== snap.open) document.getElementById('railToggle').click();
  out.restored = { speed: d.getAttribute('data-speed'), saved: localStorage.getItem('mc.animSpeed'), open: rail.classList.contains('open') };

  return JSON.stringify(out);
})()
