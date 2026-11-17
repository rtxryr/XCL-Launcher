/* ------------------------------------------------------------------
 * patch/140-stagger.js — 页面入场（Stagger Reveal）+ 滚动揭示（Scroll Reveal）
 * 参考 uimotion.fyi：列表项依次错落到场；滚动到才出现，不提前剧透。
 * 铁律：任何情况下都不许让内容永久不可见 —— 全部有 animationend + 超时双兜底。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__xclPatch140) return;
  window.__xclPatch140 = true;

  var doc = document;
  var root = doc.documentElement;
  var STYLE_ID = 'patch-140-style';
  var MAX_STAGGER = 24;
  var STEP = 34;          /* 每项间隔 ms */
  var CAP = 340;          /* 延迟上限 */

  function motionOn() { return root.dataset.motion !== 'off'; }

  function injectCss() {
    if (doc.getElementById(STYLE_ID)) return;
    var css = [
      '@keyframes m140Rise{from{opacity:0;transform:translate3d(0,11px,0)}to{opacity:1;transform:none}}',
      /* 时长除以 --m-speed（95 号「响应速度」滑杆），默认 1 */
      '.m140-item{animation:m140Rise calc(.46s / var(--m-speed,1)) cubic-bezier(.2,.8,.2,1) both;',
      '  animation-delay:var(--m140-d,0ms)}',
      '@keyframes m140Vis{from{opacity:0;transform:translate3d(0,9px,0)}to{opacity:1;transform:none}}',
      '.m140-wait{opacity:0}',
      '.m140-vis{animation:m140Vis calc(.52s / var(--m-speed,1)) cubic-bezier(.2,.8,.2,1) both}',
      /* 动效关闭 / 系统减少动效：一律回到最终态 */
      'html[data-motion="off"] .m140-item,html[data-motion="off"] .m140-vis',
      '  {animation:none!important;opacity:1!important;transform:none!important}',
      'html[data-motion="off"] .m140-wait{opacity:1!important}',
      '@media (prefers-reduced-motion:reduce){',
      '  .m140-item,.m140-vis{animation:none!important;opacity:1!important;transform:none!important}',
      '  .m140-wait{opacity:1!important}',
      '}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (doc.head || root).appendChild(st);
  }

  /* ---------------- 清理：把所有可能残留的类摘干净 ---------------- */
  function clearAll() {
    var a = doc.querySelectorAll('.m140-item, .m140-vis, .m140-wait');
    for (var i = 0; i < a.length; i++) {
      a[i].classList.remove('m140-item');
      a[i].classList.remove('m140-vis');
      a[i].classList.remove('m140-wait');
      if (a[i].style) a[i].style.removeProperty('--m140-d');
    }
  }

  /* ---------------- A. 页面入场 ---------------- */
  var played = Object.create(null);

  function stagger(page, force) {
    if (!page || !motionOn()) return;
    var key = page.id || '(anon)';
    if (played[key] && !force) return;
    played[key] = true;

    var kids = [];
    for (var i = 0; i < page.children.length && kids.length < MAX_STAGGER; i++) {
      var el = page.children[i];
      if (el.nodeType !== 1) continue;
      var cs = null;
      try { cs = getComputedStyle(el); } catch (e) {}
      if (cs && cs.display === 'none') continue;
      kids.push(el);
    }

    kids.forEach(function (el, i) {
      var d = Math.min(i * STEP, CAP);
      el.style.setProperty('--m140-d', d + 'ms');
      el.classList.add('m140-item');

      var done = false;
      function fin() {
        if (done) return;
        done = true;
        el.classList.remove('m140-item');
        try { el.style.removeProperty('--m140-d'); } catch (e) {}
      }
      el.addEventListener('animationend', fin, { once: true });
      /* 兜底：动画被打断 / 元素被移出 / 系统降级时报不出 animationend
         动画时长随 --m-speed 缩放，兜底超时同步除一下 */
      var sp = parseFloat(getComputedStyle(root).getPropertyValue('--m-speed')) || 1;
      setTimeout(fin, 460 / sp + d + 400);
    });
  }

  /* ---------------- B. 滚动揭示 ---------------- */
  var io = null;

  function killIO() {
    if (io) { try { io.disconnect(); } catch (e) {} io = null; }
  }

  function scrollReveal(page) {
    killIO();
    if (!page || !motionOn()) return;
    if (typeof IntersectionObserver !== 'function') return;

    var scroller = doc.getElementById('pages');
    var vh = window.innerHeight || 800;
    /* 只有「明显比一屏长」的页面才做，短页面全在首屏没必要 */
    if (page.scrollHeight < vh * 1.4) return;

    /* 只挑还没被入场动画管过的深层卡片，避免和 stagger 抢同一个元素 */
    var cards = page.querySelectorAll('.glass');
    var targets = [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].parentNode === page) continue;   /* 顶层交给 stagger */
      targets.push(cards[i]);
    }
    if (!targets.length) return;

    io = new IntersectionObserver(function (entries) {
      for (var k = 0; k < entries.length; k++) {
        var en = entries[k];
        var el = en.target;
        if (en.isIntersecting) {
          el.dataset.m140Seen = '1';
          el.classList.remove('m140-wait');
          if (!el.classList.contains('m140-vis')) {
            el.classList.add('m140-vis');
            el.addEventListener('animationend', function () {
              this.classList.remove('m140-vis');
            }, { once: true });
          }
        } else {
          /* 只在「从没露过面」时设为隐藏；已经看过的绝不隐藏回去 */
          if (!el.dataset.m140Seen) el.classList.add('m140-wait');
        }
      }
    }, { root: scroller || null, rootMargin: '0px 0px -8% 0px', threshold: 0.01 });

    for (var j = 0; j < targets.length; j++) {
      io.observe(targets[j]);
    }

    /* 兜底：不管 IO 出什么幺蛾子，1.2s 后清掉所有 wait */
    setTimeout(function () {
      var w = page.querySelectorAll('.m140-wait');
      for (var n = 0; n < w.length; n++) {
        var r = w[n].getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) w[n].classList.remove('m140-wait');
      }
    }, 1200);
  }

  /* ---------------- 监听 .page.active 切换 ---------------- */
  var pagesRoot = null;
  var lastActive = null;

  function currentPage() {
    return (pagesRoot && pagesRoot.querySelector('.page.active')) ||
      doc.querySelector('.page.active');
  }

  function onSwitch() {
    var p = currentPage();
    if (!p || p === lastActive) return;
    /* 离开的页面把 wait 全清掉：那是上一轮 scrollReveal 的临时状态，
       留着会让隐藏页堆一排 opacity:0 的元素（切回来会重新评估，不怕清） */
    if (lastActive) {
      var old = lastActive.querySelectorAll('.m140-wait');
      for (var i = 0; i < old.length; i++) old[i].classList.remove('m140-wait');
    }
    lastActive = p;
    if (!motionOn()) { clearAll(); return; }
    stagger(p);
    scrollReveal(p);
  }

  function watch() {
    pagesRoot = doc.getElementById('pages');
    if (!pagesRoot) return;
    var mo = new MutationObserver(function () { onSwitch(); });
    mo.observe(pagesRoot, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  }

  /* 动效开关切换：关掉时立刻清场，打开时补一次 */
  var moMotion = new MutationObserver(function () {
    if (!motionOn()) {
      killIO();
      clearAll();
    } else {
      lastActive = null;
      onSwitch();
    }
  });
  moMotion.observe(root, { attributes: true, attributeFilter: ['data-motion'] });

  function boot() {
    injectCss();
    watch();
    /* 首页在脚本执行时已经 active，主动播一次 */
    setTimeout(onSwitch, 60);
    /* 兜底：任何遗漏都清掉 */
    setTimeout(function () {
      if (motionOn()) {
        var a = doc.querySelectorAll('.m140-item');
        for (var i = 0; i < a.length; i++) {
          if (!a[i].getAnimations || a[i].getAnimations().length === 0) {
            a[i].classList.remove('m140-item');
          }
        }
      }
    }, 3000);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  console.log('[patch 140] ready');
})();
