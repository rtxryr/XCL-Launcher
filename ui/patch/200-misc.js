/* ------------------------------------------------------------------
 * patch/200-misc.js — 按钮填充 / 右侧快捷工具栏 / 打字机 / 拖拽刷新
 * 参考 uimotion.fyi：Button Fill（悬停先表意）、Typewriter（逐字）、
 *                    Pull to Refresh（拉一下才刷新）
 * 2026-11-19：右下角「+」扇形 FAB 下线，改为常驻竖排工具栏 + 品牌标识，
 *             提示条合并为单例，消除悬停重叠；命令面板图标重画（原图标像虫）。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__xclPatch200) return;
  window.__xclPatch200 = true;

  var doc = document;
  var root = doc.documentElement;
  var STYLE_ID = 'patch-200-style';

  function motionOn() { return root.dataset.motion !== 'off'; }

  function injectCss() {
    if (doc.getElementById(STYLE_ID)) return;
    var css = [
      /* ---------- 按钮填充 ---------- */
      '.m200-fill{position:relative;overflow:hidden;isolation:isolate}',
      '.m200-fill::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;',
      '  background:var(--accent-soft);transform:scaleX(0);transform-origin:var(--m200-o,left);',
      '  transition:transform calc(.34s / var(--m-speed,1)) cubic-bezier(.2,.8,.2,1);pointer-events:none}',
      '.m200-fill:hover::after{transform:scaleX(1)}',
      'html[data-motion="off"] .m200-fill::after{transition:none}',

      /* ---------- 右侧快捷工具栏（替代原「+」扇形 FAB） ---------- */
      /* 入场动画只做位移与缩放：把 opacity 写进 keyframes 会因 fill-mode:both
         一直压住内联样式，导致「内存提示出现时把工具栏淡出」永远无效 */
      '@keyframes m200DockIn{from{transform:translateY(10px) scale(.96)}to{transform:none}}',
      '#m200Dock{position:fixed;right:20px;bottom:20px;z-index:8000;',
      '  display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 6px;',
      '  border-radius:20px;background:var(--panel-2);border:1px solid var(--stroke-2);',
      '  backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%);',
      '  box-shadow:0 18px 44px -22px var(--shadow-2),inset 0 1px 0 var(--panel-3);',
      '  opacity:.62;transform:translate3d(0,0,0);',
      '  transition:opacity calc(.26s / var(--m-speed,1)) ease,box-shadow calc(.26s / var(--m-speed,1)) ease;',
      '  animation:m200DockIn calc(.5s / var(--m-speed,1)) cubic-bezier(.2,1.1,.4,1) both;',
      '  will-change:opacity}',
      '#m200Dock:hover,#m200Dock:focus-within{opacity:1;box-shadow:0 22px 52px -22px var(--shadow-2),inset 0 1px 0 var(--panel-3)}',
      /* 品牌标识：不再用「+」，避免暗示「新建」 */
      '#m200Dock .m200-brand{width:30px;height:30px;flex:0 0 auto;border-radius:10px;display:grid;place-items:center;',
      '  color:var(--accent);background:linear-gradient(150deg,var(--accent-soft),transparent);',
      '  border:1px solid var(--accent-line)}',
      '#m200Dock .m200-brand svg{width:17px;height:17px}',
      '#m200Dock .m200-div{width:16px;height:1px;margin:2px 0 3px;background:var(--stroke);flex:0 0 auto}',
      '.m200-dock-btn{position:relative;width:34px;height:34px;flex:0 0 auto;border:none;border-radius:12px;',
      '  background:transparent;color:var(--txt-2);display:grid;place-items:center;cursor:pointer;padding:0;',
      '  transition:background calc(.2s / var(--m-speed,1)) ease,color calc(.2s / var(--m-speed,1)) ease,',
      '    transform calc(.2s / var(--m-speed,1)) cubic-bezier(.34,1.3,.64,1)}',
      '.m200-dock-btn svg{width:17px;height:17px}',
      '.m200-dock-btn:hover{background:var(--accent-soft);color:var(--accent);transform:translateY(-1px)}',
      '.m200-dock-btn:active{transform:scale(.93)}',
      '.m200-dock-btn:focus-visible{outline:2px solid var(--accent-line);outline-offset:1px}',
      /* 共用一个提示条：只有一条，永远不会互相压住 */
      '#m200DockTip{position:fixed;right:80px;z-index:8001;padding:6px 11px;border-radius:999px;',
      '  white-space:nowrap;font-size:11.5px;line-height:1.2;color:var(--txt);',
      '  background:var(--tip-bg,var(--panel-2));border:1px solid var(--stroke-2);',
      '  box-shadow:0 12px 26px -18px var(--shadow-2);pointer-events:none;opacity:0;',
      '  transform:translateY(-50%) translateX(6px);',
      '  transition:opacity calc(.16s / var(--m-speed,1)) ease,transform calc(.16s / var(--m-speed,1)) ease}',
      '#m200DockTip.on{opacity:1;transform:translateY(-50%) translateX(0)}',
      'html[data-motion="off"] #m200Dock{animation:none;transition:none}',
      'html[data-motion="off"] .m200-dock-btn,html[data-motion="off"] #m200DockTip{transition:none}',

      /* ---------- 打字机 ---------- */
      '@keyframes m200Blink{0%,49%{opacity:1}50%,100%{opacity:0}}',
      '.m200-caret{display:inline-block;width:2px;height:1em;margin-left:2px;vertical-align:-.12em;',
      '  border-radius:999px;background:var(--accent);animation:m200Blink 1s steps(2) infinite}',

      /* ---------- 拖拽刷新 ---------- */
      '#m200Pull{position:absolute;left:50%;top:0;transform:translate(-50%,-52px);',
      '  width:38px;height:38px;border-radius:999px;display:grid;place-items:center;',
      '  background:var(--panel-2);border:1px solid var(--stroke-2);color:var(--accent);',
      '  opacity:0;pointer-events:none;z-index:60;',
      '  transition:transform calc(.26s / var(--m-speed,1)) cubic-bezier(.2,1.1,.4,1),opacity calc(.2s / var(--m-speed,1)) ease}',
      '#m200Pull.on{opacity:1}',
      '#m200Pull svg{width:17px;height:17px;transition:transform calc(.12s / var(--m-speed,1)) linear}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (doc.head || root).appendChild(st);
  }

  /* ================= 按钮填充 ================= */
  function bindFill() {
    /* .rail-btn 不参与：.m200-fill 的 overflow:hidden 会把按钮内部的
       .rail-pop（绝对定位在按钮盒外 left:calc(100%+24px)）永久裁剪掉，
       悬停提示从此无法显示；且 .rail-btn:hover 自带不透明背景，
       ::after（z-index:-1）画在背景之下完全不可见——零收益纯破坏。 */
    var SEL = '.btn-ghost, .sw, .seg button';
    doc.addEventListener('pointerenter', function (e) {
      if (!motionOn()) return;
      var el = e.target && e.target.closest ? e.target.closest(SEL) : null;
      if (!el || el.classList.contains('m200-fill')) return;
      /* 已有 ::before 的别抢（.rail-btn.active 的左侧竖条） */
      try {
        var cs = getComputedStyle(el, '::before');
        if (cs && cs.content && cs.content !== 'none' && cs.content !== 'normal') return;
      } catch (err) {}
      el.classList.add('m200-fill');
      var r = el.getBoundingClientRect();
      var leftHalf = (e.clientX - r.left) < r.width / 2;
      el.style.setProperty('--m200-o', leftHalf ? 'left' : 'right');
    }, true);
  }

  /* ================= 快捷工具栏（右侧竖排，常驻） ================= */
  var dockActs = [];

  /* 品牌标识：等轴方块（三个可见面）—— 对应 craft 的方块本体。
     不用「方框里一个 X」：小尺寸下容易被读成关闭按钮。 */
  var BRAND_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M12 2.9 20.3 7.7v8.6L12 21.1 3.7 16.3V7.7Z" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M12 12 3.7 7.7M12 12l8.3-4.3M12 12v9.1" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".85"/>' +
    '</svg>';

  function makeActs() {
    var list = [];

    var a1 = {
      label: '回到顶部',
      icon: '<path d="M12 18.4V6.2"/><path d="m6.4 11 5.6-5.6 5.6 5.6"/><path d="M5 20.4h14"/>',
      run: function () {
        var p = doc.getElementById('pages');
        if (p) p.scrollTo({ top: 0, behavior: 'smooth' });
        var ap = doc.querySelector('.page.active');
        if (ap && ap.scrollTo) ap.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    list.push(a1);

    /* 命令面板：给 170 号补丁用 */
    a1.exec = a1.run;

    var a2 = {
      /* 原先是两个 3px 半径的弧，18px 下糊成一条虫；换成「面板 + 两行条目」 */
      label: '命令面板',
      icon: '<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="4"/>' +
        '<path d="M7.6 9.4h8.8M7.6 13.1h5.2"/>',
      run: function () {
        try {
          var ev = new KeyboardEvent('keydown', {
            key: 'k', ctrlKey: true, bubbles: true, cancelable: true
          });
          doc.dispatchEvent(ev);
        } catch (e) {}
      }
    };
    list.push(a2);

    var a3 = {
      label: '打包诊断',
      icon: '<rect x="3.6" y="6.4" width="16.8" height="13.2" rx="3"/>' +
        '<path d="M3.6 10.4h16.8"/><path d="M9.8 6.4V4.4h4.4v2"/>',
      run: function () {
        var nav = doc.querySelector('.rail-btn[data-page="feedback"]');
        if (nav) nav.click();
        setTimeout(function () {
          var b = doc.getElementById('fbpPack');
          if (b) b.click();
        }, 320);
      }
    };
    list.push(a3);

    return list;
  }

  /* 只保留一个提示条：悬停哪个按钮就挪到哪个按钮左侧，
     同一时刻只存在一条，结构上不可能互相压住。 */
  function showTip(btn, label) {
    var tip = doc.getElementById('m200DockTip');
    if (!tip) return;
    var r = btn.getBoundingClientRect();
    tip.textContent = label;
    tip.style.top = (r.top + r.height / 2).toFixed(1) + 'px';
    tip.classList.add('on');
  }

  function hideTip() {
    var tip = doc.getElementById('m200DockTip');
    if (tip) tip.classList.remove('on');
  }

  function buildDock() {
    if (doc.getElementById('m200Dock')) return;
    if (window.innerWidth < 1100) return;

    var dock = doc.createElement('div');
    dock.id = 'm200Dock';
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', '快捷工具栏');
    dock.innerHTML = '<div class="m200-brand" aria-hidden="true">' + BRAND_SVG + '</div>' +
      '<div class="m200-div" aria-hidden="true"></div>';

    var tip = doc.createElement('div');
    tip.id = 'm200DockTip';
    tip.setAttribute('role', 'presentation');
    doc.body.appendChild(tip);

    var defs = makeActs();
    dockActs = defs.map(function (d) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'm200-dock-btn';
      b.setAttribute('aria-label', d.label);
      b.setAttribute('title', '');   /* 关掉原生 tooltip，避免与自定义提示重复 */
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round">' + d.icon + '</svg>';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        hideTip();
        try { d.run(); } catch (err) { console.warn('[patch 200] action failed', err); }
      });
      b.addEventListener('mouseenter', function () { showTip(b, d.label); });
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('focus', function () { showTip(b, d.label); });
      b.addEventListener('blur', hideTip);
      dock.appendChild(b);
      return b;
    });

    doc.body.appendChild(dock);

    /* 底部留白，别压住内容 */
    var pages = doc.getElementById('pages');
    if (pages) pages.style.paddingBottom = '104px';
  }

  /* ================= 打字机 ================= */
  function type(el, text, o) {
    if (!el) return;
    o = o || {};
    var speed = o.speed || 26;
    text = String(text == null ? '' : text);

    if (!motionOn()) { el.textContent = text; return; }

    /* 逐字间隔随 --m-speed 缩放（响应速度越快，间隔越短） */
    var sp = parseFloat(getComputedStyle(root).getPropertyValue('--m-speed')) || 1;
    speed = speed / sp;

    var caret = doc.createElement('span');
    caret.className = 'm200-caret';
    el.textContent = '';
    el.appendChild(caret);

    var i = 0;
    function step() {
      if (i >= text.length) {
        setTimeout(function () { if (caret.parentNode) caret.parentNode.removeChild(caret); }, 620);
        return;
      }
      var ch = text.charAt(i++);
      caret.parentNode.insertBefore(doc.createTextNode(ch), caret);
      var extra = /[。，、；：！？.,;:!?]/.test(ch) ? 90 : 0;
      setTimeout(step, speed + extra);
    }
    setTimeout(step, o.delay || 0);
  }

  /* ================= 拖拽刷新 ================= */
  function bindPull() {
    var pages = doc.getElementById('pages');
    if (!pages) return;
    if (pages.dataset.m200Pull) return;
    pages.dataset.m200Pull = '1';

    var ind = doc.createElement('div');
    ind.id = 'm200Pull';
    ind.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/></svg>';
    if (getComputedStyle(pages).position === 'static') pages.style.position = 'relative';
    pages.appendChild(ind);
    var arrow = ind.querySelector('svg');

    var down = false, startY = 0, dist = 0;

    pages.addEventListener('pointerdown', function (e) {
      if (!motionOn() || e.pointerType === 'touch') return;
      if (pages.scrollTop > 0) return;
      /* 只在不压在可交互元素上时启用，避免抢点击 */
      var t = e.target;
      if (t.closest && t.closest('button, a, input, textarea, select, [draggable="true"], .m200-fill')) return;
      down = true;
      startY = e.clientY;
      dist = 0;
    }, { passive: true });

    pages.addEventListener('pointermove', function (e) {
      if (!down) return;
      dist = e.clientY - startY;
      /* 只有向下拉、且页面还在顶部才响应 */
      if (dist <= 0 || pages.scrollTop > 0) { ind.classList.remove('on'); return; }
      var pull = Math.min(dist * 0.52, 96);
      ind.classList.add('on');
      ind.style.transform = 'translate(-50%,' + (pull - 52) + 'px)';
      if (arrow) arrow.style.transform = 'rotate(' + Math.min(pull * 2.4, 300) + 'deg)';
    }, { passive: true });

    function end() {
      if (!down) return;
      down = false;
      var pull = Math.min(dist * 0.52, 96);
      ind.style.transform = 'translate(-50%,-52px)';
      ind.classList.remove('on');
      if (arrow) arrow.style.transform = '';
      if (dist > 170) doRefresh();
      dist = 0;
    }
    pages.addEventListener('pointerup', end, { passive: true });
    pages.addEventListener('pointercancel', end, { passive: true });
    pages.addEventListener('pointerleave', end, { passive: true });
  }

  function doRefresh() {
    /* 保守：优先点页面自带的刷新按钮，没有就什么也不做 */
    var page = doc.querySelector('.page.active');
    if (!page) return;
    var cands = page.querySelectorAll('button');
    for (var i = 0; i < cands.length; i++) {
      var tx = (cands[i].textContent || '');
      if (/刷新|重新加载|重新检测/.test(tx)) {
        cands[i].click();
        return;
      }
    }
  }

  function boot() {
    injectCss();
    bindFill();
    buildDock();
    bindPull();

    /* 旧接口保留：其它补丁若调用也不会炸（扇形展开已下线） */
    window.M200 = {
      type: type,
      openFab: function () {},
      closeFab: function () {}
    };

    /* 窗口变窄时撤掉工具栏（它会挡内容） */
    var lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      if (Math.abs(window.innerWidth - lastW) < 40) return;
      lastW = window.innerWidth;
      var dock = doc.getElementById('m200Dock');
      if (!dock) { buildDock(); return; }
      dock.style.display = window.innerWidth < 1100 ? 'none' : '';
      if (window.innerWidth < 1100) hideTip();
    }, { passive: true });

    console.log('[patch 200] ready · dock actions:', dockActs.length);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
