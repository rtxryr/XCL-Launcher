/* 成品 exe 内验证侧栏图钉：展开 → 固定 → 点外部不收 → 取消固定 → 点外部收起 */
(async () => {
  const out = {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rail = document.getElementById('rail');
  const toggle = document.getElementById('railToggle');
  const pin = document.getElementById('railPin');

  out.exists = !!pin;
  if (!pin) return JSON.stringify(out);

  /* 归一化到"收起且未固定" */
  if (rail.classList.contains('open')) { toggle.click(); await sleep(600); }

  out.init = {
    open: rail.classList.contains('open'),
    pinned: rail.classList.contains('pinned'),
    pinOpacity: getComputedStyle(pin).opacity,
    pinEvents: getComputedStyle(pin).pointerEvents,
  };

  /* 展开 */
  toggle.click();
  await sleep(700);
  const pb = pin.getBoundingClientRect();
  const hb = document.querySelector('.rail-head').getBoundingClientRect();
  out.expanded = {
    open: rail.classList.contains('open'),
    pinVisible: getComputedStyle(pin).opacity === '1',
    pinClickable: getComputedStyle(pin).pointerEvents === 'auto',
    pinPos: { x: Math.round(pb.x), y: Math.round(pb.y), w: Math.round(pb.width) },
    insideHead: pb.right <= hb.right + 0.5,
    gapToRight: Math.round(hb.right - pb.right),
    iconRotated: getComputedStyle(pin.querySelector('svg')).transform !== 'none',
    title: pin.title,
  };

  /* 点图钉 → 固定 */
  pin.click();
  await sleep(700);
  out.pinned = {
    pinned: rail.classList.contains('pinned'),
    pinOn: pin.classList.contains('on'),
    ariaPressed: pin.getAttribute('aria-pressed'),
    title: pin.title,
    bg: getComputedStyle(pin).backgroundColor,
    stored: localStorage.getItem('mc.railPin'),
    iconTransform: getComputedStyle(pin.querySelector('svg')).transform,
  };

  /* 点内容区 / 按 Esc —— 都不该收起 */
  document.querySelector('.stage').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(600);
  out.afterOutsideClick = rail.classList.contains('open');

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(400);
  out.afterEsc = rail.classList.contains('open');

  /* 再点一次 → 取消固定 */
  pin.click();
  await sleep(500);
  out.unpinned = {
    pinned: rail.classList.contains('pinned'),
    open: rail.classList.contains('open'),
    title: pin.title,
    stored: localStorage.getItem('mc.railPin'),
  };

  /* 取消固定后，点外部应收起 */
  document.querySelector('.stage').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(700);
  out.afterOutsideClickUnpinned = rail.classList.contains('open');

  /* 手动收起时是否自动解钉 */
  toggle.click(); await sleep(600);
  pin.click(); await sleep(400);          /* 展开 + 钉住 */
  const st1 = rail.classList.contains('pinned');
  toggle.click(); await sleep(600);        /* 手动收起 */
  out.manualCollapse = {
    wasPinned: st1,
    nowOpen: rail.classList.contains('open'),
    stillPinned: rail.classList.contains('pinned'),
    pinVisible: getComputedStyle(pin).opacity,
  };

  out.finalState = { open: rail.classList.contains('open'), pinned: rail.classList.contains('pinned') };
  return JSON.stringify(out);
})()
