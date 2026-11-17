/* ------------------------------------------------------------------
 * patch/130-loading.js — 12 辐条 Spinner（Vercel Geist 风格）+ 骨架屏
 * 参考 uimotion.fyi：加载不该是"转圈"，而是有方向的扫光；内容未到先给形状。
 * 功能性元素：动效关闭时仍显示，只是不动。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__xclPatch130) return;
  window.__xclPatch130 = true;

  var doc = document;
  var root = doc.documentElement;
  var STYLE_ID = 'patch-130-style';
  var SPOKES = 12;

  function motionOn() { return root.dataset.motion !== 'off'; }

  function injectCss() {
    if (doc.getElementById(STYLE_ID)) return;
    var lines = [
      '@keyframes m130Fade{0%,100%{opacity:.14}45%{opacity:1}}',
      '.m130-spinner{position:relative;display:inline-block;flex-shrink:0;',
      '  width:var(--m130-s,28px);height:var(--m130-s,28px);color:currentColor}',
      '.m130-spinner i{position:absolute;left:50%;top:0;width:2px;',
      '  height:calc(var(--m130-s,28px) * .3);margin-left:-1px;border-radius:999px;',
      '  background:currentColor;transform-origin:1px calc(var(--m130-s,28px) * .5);',
      '  animation:m130Fade 1.1s linear infinite}',
      '.m130-spinner.m130-static i{animation:none;opacity:.3}',
      'html[data-motion="off"] .m130-spinner i{animation:none;opacity:.55}',

      '@keyframes m130Shimmer{from{background-position:200% 0}to{background-position:-200% 0}}',
      '.m130-sk{position:relative;pointer-events:none}',
      '.m130-sk-inner{display:block;width:100%}',
      '.m130-sk-bar{height:13px;border-radius:999px;margin-bottom:10px;',
      '  background:linear-gradient(90deg,var(--panel) 0%,var(--panel-3) 50%,var(--panel) 100%);',
      '  background-size:200% 100%;animation:m130Shimmer 1.35s linear infinite}',
      '.m130-sk-bar:last-child{margin-bottom:0}',
      '.m130-sk-tall{height:52px;border-radius:16px}',
      'html[data-motion="off"] .m130-sk-bar{animation:none;background:var(--panel-2)}',
      '@media (prefers-reduced-motion:reduce){',
      '  .m130-spinner i{animation:none;opacity:.5}',
      '  .m130-sk-bar{animation:none;background:var(--panel-2)}',
      '}'
    ];
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = lines.join('\n');
    (doc.head || root).appendChild(st);
  }

  /* ---------------- Spinner ---------------- */
  function spinner(size) {
    var s = size || 28;
    var el = doc.createElement('span');
    el.className = 'm130-spinner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', '加载中');
    el.style.setProperty('--m130-s', s + 'px');
    for (var i = 0; i < SPOKES; i++) {
      var sp = doc.createElement('i');
      /* 从 12 点方向顺时针扫：越靠后的辐条延迟越长（负值立即进入周期） */
      sp.style.transform = 'rotate(' + (i * 30) + 'deg)';
      sp.style.animationDelay = (-(SPOKES - 1 - i) * 0.09) + 's';
      el.appendChild(sp);
    }
    return el;
  }

  /* 把现有 .dl-ring 之类的"假转圈"换成真辐条（只在空容器里替换，不破坏已有子节点） */
  function upgradeExisting() {
    var rings = doc.querySelectorAll('.dl-ring');
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      if (r.dataset.m130) continue;
      r.dataset.m130 = '1';
      if (r.children.length) continue;         /* 已有内容的别动 */
      var sp = spinner(14);
      sp.style.setProperty('--m130-s', '14px');
      r.appendChild(sp);
      r.classList.add('m130-host');
    }
  }

  /* ---------------- 骨架屏 ---------------- */
  function skeleton(el, o) {
    if (!el) return null;
    o = o || {};
    var rows = o.rows || 3;
    var tall = !!o.tall;

    if (!el.__m130Saved) el.__m130Saved = el.innerHTML;
    el.classList.add('m130-sk');

    var inner = doc.createElement('div');
    inner.className = 'm130-sk-inner';
    for (var i = 0; i < rows; i++) {
      var b = doc.createElement('div');
      b.className = 'm130-sk-bar' + (tall && i === 0 ? ' m130-sk-tall' : '');
      b.style.width = (i === rows - 1 ? 62 : 100 - (i % 3) * 9) + '%';
      inner.appendChild(b);
    }
    el.innerHTML = '';
    el.appendChild(inner);

    /* 硬兜底：8 秒必撤，绝不把真内容挡在外面 */
    var timer = setTimeout(function () { unwrap(el); }, 8000);
    el.__m130Timer = timer;
    return { unwrap: function () { unwrap(el); } };
  }

  function unwrap(el) {
    if (!el || !el.__m130Saved) return;
    try { clearTimeout(el.__m130Timer); } catch (e) {}
    el.classList.remove('m130-sk');
    el.innerHTML = el.__m130Saved;
    el.__m130Saved = null;
    el.__m130Timer = null;
  }

  /* 空列表 + 正在加载 → 自动上骨架；一有真内容立刻撤 */
  var AUTO_SEL = ['#verList', '#resList'];

  function autoSkeleton() {
    AUTO_SEL.forEach(function (sel) {
      var box = doc.querySelector(sel);
      if (!box || box.dataset.m130Auto) return;
      box.dataset.m130Auto = '1';
      if (box.children.length) return;         /* 已有内容不做 */

      var sk = skeleton(box, { rows: 4, tall: true });

      var mo = new MutationObserver(function () {
        if (box.children.length > 1 || (box.children.length === 1 && !box.querySelector('.m130-sk-inner'))) {
          unwrap(box);
          mo.disconnect();
        }
      });
      mo.observe(box, { childList: true });
      setTimeout(function () { try { mo.disconnect(); } catch (e) {} }, 12000);
    });
  }

  function boot() {
    injectCss();
    upgradeExisting();
    autoSkeleton();
    var n = 0;
    var t = setInterval(function () {
      upgradeExisting();
      autoSkeleton();
      if (++n > 30) clearInterval(t);
    }, 400);
    window.M130 = { spinner: spinner, skeleton: skeleton, unwrap: unwrap };
    console.log('[patch 130] ready');
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
