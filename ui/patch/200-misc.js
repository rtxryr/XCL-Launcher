/* ------------------------------------------------------------------
 * patch/200-misc.js — 按钮填充 / 扇形快捷菜单 / 打字机 / 拖拽刷新
 * 参考 uimotion.fyi：Button Fill（悬停先表意）、Radial FAB（扇形展开）、
 *                    Typewriter（逐字）、Pull to Refresh（拉一下才刷新）
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

      /* ---------- FAB ---------- */
      '@keyframes m200FabIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}',
      '#m200Fab{position:fixed;right:26px;bottom:26px;z-index:8000;width:54px;height:54px;',
      '  border-radius:999px;border:none;cursor:pointer;display:grid;place-items:center;',
      '  background:var(--accent);color:var(--accent-ink);',
      '  box-shadow:0 18px 40px -14px var(--accent-line),0 2px 8px rgba(0,0,0,.18);',
      '  animation:m200FabIn calc(.4s / var(--m-speed,1)) cubic-bezier(.2,1.2,.4,1) both;',
      '  transition:transform calc(.3s / var(--m-speed,1)) cubic-bezier(.34,1.3,.64,1),box-shadow calc(.3s / var(--m-speed,1)) ease}',
      '#m200Fab:hover{transform:scale(1.06)}',
      '#m200Fab svg{width:22px;height:22px;transition:transform calc(.32s / var(--m-speed,1)) cubic-bezier(.34,1.3,.64,1)}',
      '#m200Fab.on svg{transform:rotate(45deg)}',
      '.m200-act{position:fixed;right:26px;bottom:26px;width:46px;height:46px;border-radius:999px;',
      '  border:1px solid var(--stroke-2);background:var(--panel-2);color:var(--txt);',
      '  display:grid;place-items:center;cursor:pointer;z-index:7999;',
      '  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);',
      '  box-shadow:0 14px 30px -14px var(--shadow-2);',
      '  transform:translate3d(0,0,0) scale(.2);opacity:0;pointer-events:none;',
      '  transition:transform calc(.38s / var(--m-speed,1)) cubic-bezier(.34,1.3,.64,1),opacity calc(.22s / var(--m-speed,1)) ease}',
      '.m200-act svg{width:18px;height:18px}',
      '#m200Fab.on ~ .m200-act{opacity:1;pointer-events:auto}',
      '.m200-act .m200-tip{position:absolute;right:56px;top:50%;transform:translateY(-50%) translateX(6px);',
      '  white-space:nowrap;padding:6px 11px;border-radius:999px;background:var(--tip-bg);',
      '  color:var(--txt);font-size:11.5px;border:1px solid var(--stroke-2);',
      '  opacity:0;pointer-events:none;transition:opacity calc(.18s / var(--m-speed,1)) ease,transform calc(.18s / var(--m-speed,1)) ease}',
      '.m200-act:hover .m200-tip{opacity:1;transform:translateY(-50%) translateX(0)}',
      'html[data-motion="off"] .m200-act{transition:none}',
      'html[data-motion="off"] #m200Fab{animation:none}',

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

  /* ================= 扇形 FAB ================= */
  var fabOpen = false;
  var acts = [];

  function makeActs() {
    var list = [];

    var a1 = {
      label: '回到顶部',
      icon: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
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
      label: '命令面板',
      icon: '<path d="M9 6h6a3 3 0 1 0-3-3 3 3 0 0 0-3 3v12a3 3 0 1 0 3 3 3 3 0 0 0 3-3V6"/><path d="M6 9h12M6 15h12"/>',
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
      icon: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
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

  function buildFab() {
    if (doc.getElementById('m200Fab')) return;
    if (window.innerWidth < 1100) return;

    var fab = doc.createElement('button');
    fab.id = 'm200Fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', '快捷操作');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

    var defs = makeActs();
    acts = defs.map(function (d, i) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'm200-act';
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round">' + d.icon + '</svg>' +
        '<span class="m200-tip">' + d.label + '</span>';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        closeFab();
        try { d.run(); } catch (err) { console.warn('[patch 200] action failed', err); }
      });
      return b;
    });

    doc.body.appendChild(fab);
    acts.forEach(function (b) { doc.body.appendChild(b); });

    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      fabOpen ? closeFab() : openFab();
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && fabOpen) closeFab();
    });
    doc.addEventListener('click', function (e) {
      if (!fabOpen) return;
      if (e.target.closest && (e.target.closest('#m200Fab') || e.target.closest('.m200-act'))) return;
      closeFab();
    });

    /* 底部留白，别压住内容 */
    var pages = doc.getElementById('pages');
    if (pages) pages.style.paddingBottom = '104px';
  }

  function openFab() {
    fabOpen = true;
    var fab = doc.getElementById('m200Fab');
    if (fab) fab.classList.add('on');
    var R = 82;
    acts.forEach(function (b, i) {
      /* -90° ~ -170°，围绕左下弧线 */
      var ang = (-90 - i * 40) * Math.PI / 180;
      var x = Math.cos(ang) * R;
      var y = Math.sin(ang) * R;
      b.style.transitionDelay = (i * 45) + 'ms';
      b.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) scale(1)';
    });
  }

  function closeFab() {
    fabOpen = false;
    var fab = doc.getElementById('m200Fab');
    if (fab) fab.classList.remove('on');
    acts.forEach(function (b) {
      b.style.transitionDelay = '0ms';
      b.style.transform = 'translate3d(0,0,0) scale(.2)';
    });
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
    buildFab();
    bindPull();

    window.M200 = { type: type, openFab: openFab, closeFab: closeFab };

    /* 窗口变窄时撤掉 FAB（它会挡内容） */
    var lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      if (Math.abs(window.innerWidth - lastW) < 40) return;
      lastW = window.innerWidth;
      var fab = doc.getElementById('m200Fab');
      if (!fab) { buildFab(); return; }
      if (window.innerWidth < 1100) {
        if (fabOpen) closeFab();
        fab.style.display = 'none';
        acts.forEach(function (b) { b.style.display = 'none'; });
      } else {
        fab.style.display = '';
        acts.forEach(function (b) { b.style.display = ''; });
      }
    }, { passive: true });

    console.log('[patch 200] ready · FAB actions:', acts.length);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
