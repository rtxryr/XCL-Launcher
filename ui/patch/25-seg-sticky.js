/* ------------------------------------------------------------------
 * patch/25-seg-sticky.js — 设置页 4 小项标签条滚动吸附
 * 需求：设置页（通用/外观/更新/关于）往下滚动时，#setSeg 固定在内容区
 *      顶部不跟走（视觉上保持居中可见），吸附后加毛玻璃底 + 投影。
 * 实现：纯 CSS position:sticky（相对滚动容器 .pages）+ 哨兵元素侦测
 *      是否处于吸附态（.m25-stuck 类只管装饰，不影响功能）。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;

  function injectCss() {
    if (doc.getElementById('patch-25-style')) return;
    var st = doc.createElement('style');
    st.id = 'patch-25-style';
    st.textContent = [
      '/* setSeg 滚动吸附 */',
      '#page-settings #setSeg{',
      '  position: sticky;',
      '  top: -8px;               /* 抵消 .pages 顶部 padding，贴到内容区上缘 */',
      '  z-index: 30;',
      '  border-radius: 999px;',
      '  transition: box-shadow .25s ease, background .25s ease, backdrop-filter .25s ease;',
      '}',
      '#page-settings #setSeg.m25-stuck{',
      '  background: var(--panel-2, var(--panel));',
      '  backdrop-filter: blur(14px);',
      '  -webkit-backdrop-filter: blur(14px);',
      '  box-shadow: 0 6px 22px rgba(0,0,0,.14), 0 1px 0 var(--stroke-2);',
      '}',
      '/* 哨兵：正常文档流零高度块，钉在 setSeg 的自然位置上（绝不能 absolute，',
      '   否则它永远贴着滚动容器顶，吸附态判断永远为真） */',
      '#page-settings .m25-sentinel{height:0;margin:0;padding:0;border:0;pointer-events:none;visibility:hidden}'
    ].join('\n');
    doc.head.appendChild(st);
  }

  function mount() {
    if (window.__xclPatch25) return;
    var page = doc.getElementById('page-settings');
    var seg = doc.getElementById('setSeg');
    if (!page || !seg || page.querySelector('.m25-sentinel')) { if (seg) window.__xclPatch25 = true; return; }

    injectCss();

    /* 哨兵放在 setSeg 原本的位置：sentinel 离开视口顶 = setSeg 已吸附 */
    var sentinel = doc.createElement('div');
    sentinel.className = 'm25-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    seg.parentNode.insertBefore(sentinel, seg);

    /* 找到真正的滚动容器（.pages），找不到就不启用 stuck 装饰 */
    var scroller = null;
    var el = seg.parentElement;
    while (el && el !== doc.body) {
      var oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') { scroller = el; break; }
      el = el.parentElement;
    }

    if (scroller) {
      /* scroll 监听比 IO 可靠：sentinel 顶到达滚动容器顶 = 已吸附 */
      var update = function () {
        var sr = scroller.getBoundingClientRect();
        var nr = sentinel.getBoundingClientRect();
        seg.classList.toggle('m25-stuck', nr.top < sr.top + 2);
      };
      scroller.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update, { passive: true });
      update();
    }

    window.__xclPatch25 = true;
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
