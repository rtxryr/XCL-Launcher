/* ------------------------------------------------------------------
 * patch/100-magnetic.js — Magnetic Button（磁吸主按钮）
 *                       + Card 3D Tilt（玻璃卡微倾斜）
 * 参考：uimotion.fyi / Magnetic Button
 * 作用域：只碰 .btn-primary（主启动按钮）与 .page.active 内的 .glass 卡，
 *         全部通过变量 / 追加类驱动，不覆盖按钮与卡片的既有规则。
 * 动效开关：html[data-motion="off"] 与 prefers-reduced-motion 全部禁用。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch100) return;
  window.__xclPatch100 = true;

  var doc = document;
  var root = doc.documentElement;

  var STYLE_ID = 'patch-100-style';
  var FIELD = 90;        /* 磁场半径 px */
  var INNER = 45;        /* 满强度半径，45 -> 90 之间 smoothstep 衰减 */
  var MAXX = 14;         /* 位移硬上限 */
  var MAXY = 14;
  var KX = 0.28;
  var KY = 0.32;
  var MAX_CARDS = 8;
  var MIN_W = 200;
  var MIN_H = 120;

  /* ---------------------------- CSS ---------------------------- */
  var CSS = `
/* ==================================================================
 * 100-magnetic — 磁吸主按钮
 * 位移走 CSS 变量，绝不直接覆写 .btn-primary 的 transform 声明链：
 * .btn-primary:hover 的 -2px 抬升被折算进 --m100-lift，
 * :active 的 scale(.985) 折算进 --m100-s，互不打架。
 * 过渡时长除以 --m-speed（95 号滑杆「响应速度」）。
 * ================================================================== */
.m100-field .btn-primary{
  --m100-x:0px; --m100-y:0px; --m100-lift:0px; --m100-s:1;
  transform: translate3d(var(--m100-x), calc(var(--m100-y) + var(--m100-lift)), 0) scale(var(--m100-s));
  transition: transform calc(.36s / var(--m-speed,1)) cubic-bezier(.2,1.4,.4,1),
              box-shadow calc(.28s * var(--anim-k)) var(--ease);
  will-change: transform;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
}
/* 跟随时用短缓动，离开时切回上面的回弹曲线 */
.m100-field .btn-primary.m100-track{
  transition: transform calc(.18s / var(--m-speed,1)) cubic-bezier(.2,.8,.2,1),
              box-shadow calc(.28s * var(--anim-k)) var(--ease);
}
.m100-field .btn-primary.m100-near{ --m100-s:1.02; }
.m100-field .btn-primary:hover{ --m100-lift:-2px; }
.m100-field .btn-primary:active{ --m100-lift:0px; --m100-s:.985; }
/* 运行中 / 禁用：不缩放、不抬升，位移由 JS 立刻归零 */
.m100-field .btn-primary.running,
.m100-field .btn-primary[disabled]{ --m100-lift:0px; --m100-s:1; }

/* ==================================================================
 * 100-magnetic — 玻璃卡 3D 微倾斜
 * ================================================================== */
.m100-tilt{
  --m100-rx:0deg; --m100-ry:0deg;
  transform: perspective(900px) rotateX(var(--m100-rx)) rotateY(var(--m100-ry)) translateZ(0);
  transition: transform calc(.5s / var(--m-speed,1)) cubic-bezier(.2,.8,.2,1);
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
}
.m100-tilt.m100-live{
  transition: transform calc(.1s / var(--m-speed,1)) linear;
  will-change: transform;
}
.m100-tilt.m100-glowable{ position:relative; }
.m100-tilt.m100-glowable::before{
  content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background: radial-gradient(360px 220px at var(--m100-gx,50%) var(--m100-gy,50%),
              var(--accent), transparent 66%);
  opacity: var(--m100-go,0);
  transition: opacity .38s var(--ease);
  z-index:0;
}

/* ---------- 动效总开关 / 系统减弱动效 ---------- */
html[data-motion="off"] .m100-field .btn-primary,
html[data-motion="off"] .m100-tilt{
  transform:none !important;
  transition:none !important;
}
html[data-motion="off"] .m100-tilt::before{ opacity:0 !important; }

@media (prefers-reduced-motion: reduce){
  .m100-field .btn-primary,
  .m100-tilt{
    transform:none !important;
    transition:none !important;
  }
  .m100-tilt::before{ opacity:0 !important; }
}
`;

  if (!doc.getElementById(STYLE_ID)) {
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.setAttribute('data-patch', '100');
    st.textContent = CSS;
    (doc.head || root).appendChild(st);
  }

  /* --------------------------- 工具 --------------------------- */
  function motionOn() { return root.dataset.motion !== 'off'; }
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function enabled() { return motionOn() && !reduceMotion(); }
  /* 95 号滑杆：--m-amp 乘位移/角度，--m-speed 除时长（JS 侧现读） */
  function ampVal() {
    return parseFloat(getComputedStyle(root).getPropertyValue('--m-amp')) || 1;
  }
  function clamp(v, lim) {
    var m = lim == null ? MAXX : lim;
    return v > m ? m : (v < -m ? -m : v);
  }
  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t * t * (3 - 2 * t);
  }
  function usable(el) {
    return el && el.isConnected !== false && !el.disabled && !el.classList.contains('running');
  }

  /* --------------------------- 状态 --------------------------- */
  var S = {
    mounted: false,
    pages: null,
    fieldHost: null,
    btn: null,
    cards: [],
    activePage: null,
    activeCard: null,
    raf: 0,
    evt: null,
    lastDx: 0,
    lastDy: 0,
    moves: 0,
    mo: null,
    moBtn: null,
    moMotion: null,
    mq: null
  };

  function bind(el, type, fn) {
    if (!el || !el.addEventListener) return;
    el.addEventListener(type, fn, { passive: true, capture: true });
  }
  function unbind(el, type, fn) {
    if (!el || !el.removeEventListener) return;
    el.removeEventListener(type, fn, { passive: true, capture: true });
  }

  /* ------------------------ 磁吸：按钮 ------------------------ */
  /* 按钮可能被版本加载流程重建：每帧惰性校验引用，断开就重新取 */
  function ensureBtn() {
    var b = S.btn;
    if (b && b.isConnected && doc.contains(b)) return b;
    var next = doc.getElementById('launchBtn');
    if (!next && S.pages) next = S.pages.querySelector('.btn-primary');
    if (next !== b) {
      S.btn = next;
      S.lastDx = 0; S.lastDy = 0;
      if (S.moBtn) { S.moBtn.disconnect(); S.moBtn = null; }
      if (next && window.MutationObserver) {
        S.moBtn = new MutationObserver(function () {
          if (!usable(S.btn)) zeroBtn();
        });
        S.moBtn.observe(next, { attributes: true, attributeFilter: ['class', 'disabled'] });
      }
    }
    return S.btn;
  }

  function zeroBtn() {
    var b = S.btn;
    if (!b) return;
    S.lastDx = 0; S.lastDy = 0;
    b.classList.remove('m100-track', 'm100-near');
    if (b.style.getPropertyValue('--m100-x') !== '0px') {
      b.style.setProperty('--m100-x', '0px');
      b.style.setProperty('--m100-y', '0px');
    }
  }

  function stepBtn(cx, cy) {
    var b = ensureBtn();
    if (!b) return;
    if (!usable(b)) { zeroBtn(); return; }

    var r = b.getBoundingClientRect();
    if (!r.width) return;

    /* 用「扣除自身位移」后的中心，避免磁吸反馈回路把按钮越拉越偏 */
    var bx = r.left + r.width / 2 - S.lastDx;
    var by = r.top + r.height / 2 - S.lastDy;
    var dx = cx - bx;
    var dy = cy - by;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > FIELD) { zeroBtn(); return; }

    var k = 1 - smoothstep(INNER, FIELD, dist);
    var amp = ampVal();
    /* 位移乘 --m-amp，硬上限同步放大，保证幅度滑杆真正起作用 */
    var tx = clamp(dx * KX * k * amp, MAXX * amp);
    var ty = clamp(dy * KY * k * amp, MAXY * amp);

    S.lastDx = tx; S.lastDy = ty;
    b.classList.add('m100-track', 'm100-near');
    b.style.setProperty('--m100-x', tx.toFixed(2) + 'px');
    b.style.setProperty('--m100-y', ty.toFixed(2) + 'px');
  }

  /* ------------------------ 3D 倾斜：卡片 ------------------------ */
  function releaseCard(card) {
    if (!card) return;
    card.classList.remove('m100-live');
    card.style.setProperty('--m100-rx', '0deg');
    card.style.setProperty('--m100-ry', '0deg');
    card.style.setProperty('--m100-go', '0');
    if (card.classList.contains('m100-glowable')) {
      card.style.willChange = 'transform';
      var done = function (ev) {
        if (ev.target !== card || ev.propertyName !== 'transform') return;
        card.style.willChange = '';
        card.removeEventListener('transitionend', done);
      };
      card.addEventListener('transitionend', done);
    }
  }

  function resetCards() {
    for (var i = 0; i < S.cards.length; i++) {
      var c = S.cards[i];
      c.classList.remove('m100-live', 'm100-tilt', 'm100-glowable');
      c.style.removeProperty('--m100-rx');
      c.style.removeProperty('--m100-ry');
      c.style.removeProperty('--m100-gx');
      c.style.removeProperty('--m100-gy');
      c.style.removeProperty('--m100-go');
      c.style.willChange = '';
    }
    S.cards = [];
    S.activeCard = null;
  }

  function pseudoFree(el) {
    try {
      var a = window.getComputedStyle(el, '::before');
      var b = window.getComputedStyle(el, '::after');
      var na = a && a.content;
      var nb = b && b.content;
      var free = function (v) { return v === 'none' || v === 'normal'; };
      return free(na) && free(nb);
    } catch (e) { return false; }
  }

  function collectCards() {
    resetCards();
    var page = S.pages && S.pages.querySelector('.page.active');
    if (!page) return;
    var all = page.querySelectorAll('.glass');
    var picked = 0;
    for (var i = 0; i < all.length && picked < MAX_CARDS; i++) {
      var el = all[i];
      if (el.offsetParent === null) continue;
      var r = el.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) continue;
      el.classList.add('m100-tilt');
      if (pseudoFree(el)) el.classList.add('m100-glowable');
      S.cards.push(el);
      picked++;
    }
  }

  function stepTilt(cx, cy, target) {
    var card = null;
    if (target && target.closest) card = target.closest('.m100-tilt');
    if (card && S.cards.indexOf(card) === -1) card = null;

    if (S.activeCard && S.activeCard !== card) releaseCard(S.activeCard);
    S.activeCard = card;
    if (!card) return;

    var r = card.getBoundingClientRect();
    if (!r.width || !r.height) return;

    var px = (cx - r.left) / r.width;
    var py = (cy - r.top) / r.height;
    px = px < 0 ? 0 : (px > 1 ? 1 : px);
    py = py < 0 ? 0 : (py > 1 ? 1 : py);

    var amp = ampVal();
    /* 倾斜最大角度乘 --m-amp */
    var rx = clamp(-(py - 0.5) * 4 * amp, 5 * amp);
    var ry = clamp((px - 0.5) * 5 * amp, 5 * amp);

    card.classList.add('m100-live');
    card.style.setProperty('--m100-rx', rx.toFixed(2) + 'deg');
    card.style.setProperty('--m100-ry', ry.toFixed(2) + 'deg');
    if (card.classList.contains('m100-glowable')) {
      card.style.setProperty('--m100-gx', (px * 100).toFixed(1) + '%');
      card.style.setProperty('--m100-gy', (py * 100).toFixed(1) + '%');
      card.style.setProperty('--m100-go', '0.07');
    }
  }

  /* --------------------------- 帧循环 --------------------------- */
  function applyEvt(e) {
    if (!e || !S.mounted) return;
    stepBtn(e.clientX, e.clientY);
    stepTilt(e.clientX, e.clientY, e.target);
  }

  /* 领头 + 收尾：本帧第一次移动立刻算，同帧后续移动合并到最后一次 rAF */
  function onMove(e) {
    if (!S.mounted) return;
    S.moves++;
    S.evt = e;
    if (S.raf) return;
    applyEvt(e);
    S.evt = null;
    S.raf = requestAnimationFrame(function () {
      S.raf = 0;
      var pend = S.evt;
      S.evt = null;
      if (pend) applyEvt(pend);
    });
  }

  function onLeave() {
    S.evt = null;
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    zeroBtn();
    if (S.activeCard) { releaseCard(S.activeCard); S.activeCard = null; }
  }

  function onScroll() {
    /* 滚动后按钮中心变了，但鼠标没动：让位移回到 0，避免卡片/按钮错位 */
    zeroBtn();
    if (S.activeCard) { releaseCard(S.activeCard); S.activeCard = null; }
  }

  /* --------------------------- 挂载 --------------------------- */
  function mount() {
    if (S.mounted) return;
    S.pages = doc.getElementById('pages') || doc.querySelector('.pages');
    if (!S.pages) return;

    if (!S.pages.classList.contains('m100-field')) {
      S.pages.classList.add('m100-field');
      S.fieldHost = S.pages;
    }

    S.btn = null;
    ensureBtn();

    collectCards();
    S.activePage = S.pages.querySelector('.page.active');

    bind(doc, 'mousemove', onMove);
    bind(doc, 'scroll', onScroll);
    bind(document.documentElement, 'mouseleave', onLeave);
    bind(window, 'blur', onLeave);

    /* 切页 -> 重新收集卡片 */
    if (window.MutationObserver) {
      S.mo = new MutationObserver(function () {
        var cur = S.pages.querySelector('.page.active');
        if (cur === S.activePage) return;
        S.activePage = cur;
        onLeave();
        collectCards();
      });
      S.mo.observe(S.pages, { attributes: true, attributeFilter: ['class'], subtree: true });
    }

    S.mounted = true;
  }

  function unmount() {
    if (!S.mounted) return;
    onLeave();
    unbind(doc, 'mousemove', onMove);
    unbind(doc, 'scroll', onScroll);
    unbind(document.documentElement, 'mouseleave', onLeave);
    unbind(window, 'blur', onLeave);
    if (S.moBtn) { S.moBtn.disconnect(); S.moBtn = null; }
    if (S.mo) { S.mo.disconnect(); S.mo = null; }
    resetCards();
    S.mounted = false;
  }

  function apply() {
    if (enabled()) mount();
    else unmount();
  }

  /* 运行中切换开关 / 系统偏好变化 */
  if (window.MutationObserver) {
    S.moMotion = new MutationObserver(function () { apply(); });
    S.moMotion.observe(root, { attributes: true, attributeFilter: ['data-motion'] });
  }
  if (window.matchMedia) {
    S.mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (S.mq.addEventListener) S.mq.addEventListener('change', apply);
    else if (S.mq.addListener) S.mq.addListener(apply);
  }

  window.__m100probe = function () {
    return { mounted: S.mounted, moves: S.moves, btn: !!S.btn, conn: S.btn ? S.btn.isConnected : null, cards: S.cards.length, motion: root.dataset.motion || null };
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
