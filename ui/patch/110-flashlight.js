/* ------------------------------------------------------------------
 * patch/110-flashlight.js — Flashlight Card Border
 * 光标在卡片上移动时，卡片边框出现一圈跟随光标的高亮光斑，
 * 同时内部有一层极淡的径向光晕跟随。
 *
 * 实现要点：
 *  - 不改 .glass 的 background（90 号补丁在那里叠加 --grad-hairline）
 *  - 边框光斑 = 1px padding + mask XOR（只保留 padding 环）
 *  - 光晕 = radial-gradient + mix-blend-mode（深色 screen / 浅色 multiply）
 *  - JS 每帧只写 --m110-x / --m110-y 两个变量，不写 background
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch110) return;
  window.__xclPatch110 = true;

  var doc = document;
  var STYLE_ID = 'patch-110-style';
  var MAX_CARDS = 12;
  var TONE_CLASSES = ['m110-light', 'm110-dark'];

  var CSS = [
    '.m110-card{position:relative;isolation:isolate}',

    /* ---- 边框光斑（1px 环）---- */
    '.m110-card.m110-rp::after,',
    '.m110-card > .m110-ring{',
    "  content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;",
    '  padding:1px;box-sizing:border-box;z-index:2;',
    '  background:radial-gradient(calc(220px * var(--m-amp,1)) circle at var(--m110-x,50%) var(--m110-y,50%),',
    '             var(--accent-l) 0%,var(--accent) 18%,transparent 62%);',
    '  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);',
    '  -webkit-mask-composite:xor;',
    '  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);',
    '  mask-composite:exclude;',
    '  opacity:0;transition:opacity .22s ease;',
    '}',
    '.m110-card.m110-hot.m110-rp::after,',
    '.m110-card.m110-hot > .m110-ring{opacity:1}',

    /* ---- 内部光晕 ---- */
    '.m110-card.m110-gp::before,',
    '.m110-card > .m110-glow{',
    "  content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1;",
    '  background:radial-gradient(calc(300px * var(--m-amp,1)) circle at var(--m110-x,50%) var(--m110-y,50%),',
    '             var(--accent-soft),transparent 70%);',
    '  opacity:calc(var(--m110-on,0) * .9);',
    '  transition:opacity .26s ease;',
    '  mix-blend-mode:screen;',
    '}',
    '.m110-card.m110-light.m110-gp::before,',
    '.m110-card.m110-light > .m110-glow{mix-blend-mode:multiply}',

    /* ---- 浅色主题下 --accent-l 偏白，边框光斑改用 accent -> accent-d ---- */
    '.m110-card.m110-light.m110-rp::after,',
    '.m110-card.m110-light > .m110-ring{',
    '  background:radial-gradient(calc(220px * var(--m-amp,1)) circle at var(--m110-x,50%) var(--m110-y,50%),',
    '             var(--accent-d) 0%,var(--accent) 20%,transparent 62%);',
    '}',

    /* ---- 开关 OFF / 减少动态 ---- */
    'html[data-motion="off"] .m110-card::after,',
    'html[data-motion="off"] .m110-card::before,',
    'html[data-motion="off"] .m110-card > .m110-ring,',
    'html[data-motion="off"] .m110-card > .m110-glow{display:none!important}',
    '@media (prefers-reduced-motion: reduce){',
    '  .m110-card::after,.m110-card::before,',
    '  .m110-card > .m110-ring,.m110-card > .m110-glow{display:none!important}',
    '  .m110-card{transition:none!important}',
    '}'
  ].join('\n');

  if (!doc.getElementById(STYLE_ID)) {
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  /* ---------------- 工具 ---------------- */

  function motionOn() {
    return doc.documentElement.dataset.motion !== 'off';
  }

  /* 伪元素槽位是否空闲：content 为 none/normal 表示没有被别人占用 */
  function slotFree(el, which) {
    try {
      var c = getComputedStyle(el, which).content;
      return !c || c === 'none' || c === 'normal';
    } catch (e) {
      return true;
    }
  }

  /* 主题明暗：把 --bg0 塞进一个探针元素的 background-color，
     由浏览器把 hex / hsl() 统一解析成 rgb()，再算亮度 */
  var probe = null;
  function bgLuminance() {
    if (!probe) {
      probe = doc.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText =
        'position:absolute;left:-9999px;top:0;width:1px;height:1px;' +
        'opacity:0;pointer-events:none;background-color:var(--bg0)';
      (doc.body || doc.documentElement).appendChild(probe);
    }
    var c = getComputedStyle(probe).backgroundColor || '';
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(c);
    if (!m) return 0; /* 解析不出来按深色处理 */
    var r = +m[1] / 255, g = +m[2] / 255, b = +m[3] / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  var lightCache = null;
  function isLight() {
    if (lightCache === null) lightCache = bgLuminance() > 0.6;
    return lightCache;
  }

  function applyTone(el) {
    el.classList.toggle('m110-light', isLight());
    el.classList.toggle('m110-dark', !isLight());
  }

  /* ---------------- 挂载 ---------------- */

  var MOUNTED = [];

  function onMove(e) {
    var el = e.currentTarget;
    if (el.__m110Raf) {
      el.__m110Px = e.clientX;
      el.__m110Py = e.clientY;
      return;
    }
    el.__m110Px = e.clientX;
    el.__m110Py = e.clientY;
    el.__m110Raf = requestAnimationFrame(function () {
      el.__m110Raf = 0;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--m110-x', (el.__m110Px - r.left).toFixed(1) + 'px');
      el.style.setProperty('--m110-y', (el.__m110Py - r.top).toFixed(1) + 'px');
    });
  }

  function onEnter(e) {
    if (!motionOn()) return;
    var el = e.currentTarget;
    el.style.setProperty('--m110-on', '1');
    el.classList.add('m110-hot');
    if (!el.__m110Moving) {
      el.addEventListener('pointermove', onMove, { passive: true });
      el.__m110Moving = true;
    }
  }

  function onLeave(e) {
    var el = e.currentTarget;
    el.classList.remove('m110-hot');
    el.style.setProperty('--m110-on', '0');
    if (el.__m110Moving) {
      el.removeEventListener('pointermove', onMove);
      el.__m110Moving = false;
    }
    if (el.__m110Raf) {
      cancelAnimationFrame(el.__m110Raf);
      el.__m110Raf = 0;
    }
  }

  function mount(el) {
    if (!el || el.__m110) return false;
    el.__m110 = true;

    el.classList.add('m110-card');
    el.style.setProperty('--m110-x', '50%');
    el.style.setProperty('--m110-y', '50%');
    el.style.setProperty('--m110-on', '0');
    applyTone(el);

    /* ::after 被占用（如 .hero 的径向光斑）→ 插入真实子元素 */
    if (slotFree(el, '::after')) {
      el.classList.add('m110-rp');
    } else {
      var ring = doc.createElement('div');
      ring.className = 'm110-ring';
      ring.setAttribute('aria-hidden', 'true');
      el.appendChild(ring);
    }

    if (slotFree(el, '::before')) {
      el.classList.add('m110-gp');
    } else {
      var glow = doc.createElement('div');
      glow.className = 'm110-glow';
      glow.setAttribute('aria-hidden', 'true');
      el.appendChild(glow);
    }

    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    return true;
  }

  function unmount(el) {
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointerleave', onLeave);
    if (el.__m110Moving) {
      el.removeEventListener('pointermove', onMove);
      el.__m110Moving = false;
    }
    if (el.__m110Raf) {
      cancelAnimationFrame(el.__m110Raf);
      el.__m110Raf = 0;
    }
    el.classList.remove('m110-card', 'm110-hot', 'm110-rp', 'm110-gp');
    el.classList.remove('m110-light', 'm110-dark');
    el.style.removeProperty('--m110-x');
    el.style.removeProperty('--m110-y');
    el.style.removeProperty('--m110-on');
    var j1 = el.querySelector(':scope > .m110-ring');
    if (j1) j1.parentNode.removeChild(j1);
    var j2 = el.querySelector(':scope > .m110-glow');
    if (j2) j2.parentNode.removeChild(j2);
    el.__m110 = false;
  }

  /* ---------------- 扫描 ---------------- */

  function visible(el) {
    var cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none' || cs.visibility === 'hidden') return false;
    return true;
  }

  function collect() {
    var out = [];
    var dlg = doc.querySelector('.pf-dialog');
    if (dlg) out.push(dlg);

    var cards = doc.querySelectorAll('.page.active .glass');
    for (var i = 0; i < cards.length && out.length < MAX_CARDS; i++) {
      var el = cards[i];
      if (out.indexOf(el) !== -1) continue;
      if (el.closest && el.closest('.pf-dialog')) continue;
      if (!visible(el)) continue;
      if (el.offsetWidth < 60 || el.offsetHeight < 40) continue;
      out.push(el);
    }
    return out;
  }

  function scan() {
    var next = collect();

    MOUNTED.slice().forEach(function (el) {
      if (next.indexOf(el) === -1) unmount(el);
    });

    next.forEach(function (el) {
      if (!el.__m110) mount(el);
    });

    MOUNTED = next.filter(function (el) { return el.__m110; });
    return MOUNTED.length;
  }

  function toneAll() {
    lightCache = null;
    MOUNTED.forEach(applyTone);
  }

  var scanRaf = 0;
  function scheduleScan() {
    if (scanRaf) return;
    scanRaf = requestAnimationFrame(function () {
      scanRaf = 0;
      scan();
    });
  }

  /* ---------------- 观察者 ---------------- */

  function activePage() {
    var p = doc.querySelector('.page.active');
    return p ? p.id : '';
  }

  var lastPage = activePage();

  function init() {
    scan();

    var pages = doc.getElementById('pages');
    if (pages) {
      new MutationObserver(function () {
        var now = activePage();
        if (now !== lastPage) {
          lastPage = now;
          scheduleScan();
        }
      }).observe(pages, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
        childList: true
      });
    }

    /* 弹窗是运行时 append 到 body 的，出现/移除都要重新扫 */
    new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.type !== 'childList') continue;
        var nodes = [].concat(
          Array.prototype.slice.call(r.addedNodes),
          Array.prototype.slice.call(r.removedNodes)
        );
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (n.nodeType === 1 && (n.classList.contains('pf-mask') || n.classList.contains('pf-dialog'))) {
            scheduleScan();
            return;
          }
        }
      }
    }).observe(doc.body, { childList: true });

    /* 主题切换（含自定义色）→ 重新判定明暗 */
    new MutationObserver(toneAll).observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-custom', 'style']
    });

    /* 动效开关运行中被关掉 → 立刻收掉光斑 */
    new MutationObserver(function () {
      if (!motionOn()) {
        MOUNTED.forEach(function (el) {
          el.classList.remove('m110-hot');
          el.style.setProperty('--m110-on', '0');
        });
      } else {
        toneAll();
      }
    }).observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion']
    });

    /* 供自检脚本调用（不影响动效逻辑） */
    window.__m110Scan = scan;
    window.__m110State = function () {
      return {
        count: MOUNTED.length,
        light: isLight(),
        on: motionOn(),
        cards: MOUNTED.map(function (el) {
          return {
            id: el.id || el.className,
            ring: el.classList.contains('m110-rp') ? '::after' : 'child',
            glow: el.classList.contains('m110-gp') ? '::before' : 'child',
            x: el.style.getPropertyValue('--m110-x'),
            y: el.style.getPropertyValue('--m110-y'),
            onVal: el.style.getPropertyValue('--m110-on'),
            hot: el.classList.contains('m110-hot')
          };
        })
      };
    };
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
