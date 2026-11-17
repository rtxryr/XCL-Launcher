/* ------------------------------------------------------------------
 * patch/190-nav.js — Tab Switch（滑动指示器）+ Icon Morph（侧栏图标变形）
 *                  + Search Expand（顶栏搜索展开）+ Toggle（开关过冲）
 * 参考：uimotion.fyi / Tab Switch · Icon Morph · Search Expand · Toggle
 * 作用域：
 *   .seg            仅单行分段控件，追加 .m190-seg + span.m190-ind
 *   .rail-btn       .rb-ico > svg 追加 .m190-pop / .m190-dim
 *   .search         追加 .m190-search（升级，不插入新元素）
 *   .switch         追加 .m190-toggle（升级，不插入新元素）
 * 动效开关：html[data-motion="off"] / prefers-reduced-motion 全部降级。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch190) return;
  window.__xclPatch190 = true;

  var doc = document;
  var root = doc.documentElement;

  var STYLE_ID = 'patch-190-style';

  /* ---------------------------- CSS ---------------------------- */
  var CSS = `
/* ==================================================================
 * A. 变形标签指示器（.seg）
 * 指示器是绝对定位的独立元素，只动 transform / width，
 * 不参与任何兄弟节点的排版；按钮原 .on 底色在非渐变主题下改为透明，
 * 由指示器承担「选中底色」。渐变主题（90 号）保留它自己的渐变底，
 * 指示器置空避免与 --accent-grad-soft 叠加。
 * ================================================================== */
.m190-seg{position:relative}
.m190-seg > .m190-ind{
  position:absolute;left:0;top:0;width:0;height:0;
  border-radius:var(--r-pill);
  background:var(--panel-3);
  box-shadow:0 2px 8px rgba(0,0,0,.12);
  pointer-events:none;z-index:0;opacity:0;
  transition:transform calc(.34s / var(--m-speed,1)) cubic-bezier(.2,1.05,.3,1),
             width calc(.34s / var(--m-speed,1)) cubic-bezier(.2,1.05,.3,1),
             opacity calc(.18s / var(--m-speed,1)) linear;
}
.m190-seg.m190-ready > .m190-ind{opacity:1}
.m190-seg > button{position:relative;z-index:1}

html:not([data-theme^="grad-"]) .m190-seg > button.on{
  background:transparent !important;
  box-shadow:none !important;
}
/* 渐变主题：把指示器让给 90 号的渐变选中底，避免两层叠加 */
html[data-theme^="grad-"] .m190-seg > .m190-ind{
  background:transparent;box-shadow:none;
}
html[data-motion="on"] .m190-seg > .m190-ind{border-radius:8px}

/* ==================================================================
 * B. 图标变形（.rail-btn .rb-ico > svg）
 * 只动 transform / opacity；动画结束由 JS 摘类。
 * ================================================================== */
.m190-pop{animation:m190-pop calc(.35s / var(--m-speed,1)) cubic-bezier(.2,1.1,.3,1) both}
@keyframes m190-pop{
  0%{transform:scale(.86) rotate(-6deg);opacity:.4}
  60%{transform:scale(1.08) rotate(2deg);opacity:1}
  100%{transform:none;opacity:1}
}
.m190-dim{animation:m190-dim calc(.25s / var(--m-speed,1)) var(--ease) both}
@keyframes m190-dim{
  0%{opacity:1}
  45%{opacity:.8}
  100%{opacity:1}
}

/* ==================================================================
 * C. 搜索展开（.search，升级既有顶栏搜索框）
 * 展开只发生在单个元素上，宽度过渡不影响其它节点排版。
 * 放大镜在静息态略微左退 + 半透明，聚焦时归位并提亮。
 * ================================================================== */
.search.m190-search{
  transition:width calc(.3s / var(--m-speed,1)) var(--ease),
             border-color calc(.25s * var(--anim-k)),
             background calc(.25s * var(--anim-k)),
             box-shadow calc(.25s * var(--anim-k));
}
html:not([data-motion="off"]) .search.m190-search:focus-within{
  width:clamp(220px, 40vw, 460px);
}
.search.m190-search > svg{
  transform:translateX(-3px);opacity:.72;
  transition:transform calc(.3s / var(--m-speed,1)) var(--ease),opacity calc(.3s / var(--m-speed,1)) var(--ease);
}
.search.m190-search:focus-within > svg{transform:none;opacity:1}
.search.m190-search .kbd{
  transition:opacity calc(.22s / var(--m-speed,1)) var(--ease),transform calc(.22s / var(--m-speed,1)) var(--ease);
}
.search.m190-search:focus-within .kbd{opacity:0;transform:translateX(6px)}

/* ==================================================================
 * D. Toggle（.switch 升级：滑块带轻微过冲，轨道底色 .2s）
 * ================================================================== */
.switch.m190-toggle{
  transition:background calc(.2s / var(--m-speed,1)) var(--ease),
             border-color calc(.2s / var(--m-speed,1)) var(--ease),
             transform calc(.18s / var(--m-speed,1)) var(--ease);
}
.switch.m190-toggle::after{
  transition:transform calc(.3s / var(--m-speed,1)) cubic-bezier(.2,1.4,.4,1),
             box-shadow calc(.2s / var(--m-speed,1)) var(--ease);
}
.switch.m190-toggle:active{transform:scale(.965)}

/* ---------------------------- 关闭动效 ---------------------------- */
html[data-motion="off"] .m190-seg > .m190-ind{transition:none !important}
html[data-motion="off"] .m190-pop,
html[data-motion="off"] .m190-dim{animation:none !important}
html[data-motion="off"] .search.m190-search{transition:none !important}
html[data-motion="off"] .search.m190-search > svg,
html[data-motion="off"] .search.m190-search .kbd{transition:none !important}
html[data-motion="off"] .switch.m190-toggle,
html[data-motion="off"] .switch.m190-toggle::after{transition:none !important}
html[data-motion="off"] .switch.m190-toggle:active{transform:none !important}

@media (prefers-reduced-motion:reduce){
  .m190-seg > .m190-ind{transition:none !important}
  .m190-pop,.m190-dim{animation:none !important}
  .search.m190-search,
  .search.m190-search > svg,
  .search.m190-search .kbd,
  .switch.m190-toggle,
  .switch.m190-toggle::after{transition:none !important}
}
`;

  function injectCss() {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || root).appendChild(st);
  }

  function motionOn() {
    return root.getAttribute('data-motion') !== 'off';
  }

  /* ======================= A. 分段控件指示器 ======================= */

  function buttonsOf(seg) {
    var out = [];
    var kids = seg.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName === 'BUTTON') out.push(kids[i]);
    }
    return out;
  }

  /* 可见按钮 + 行数判定；换行的 seg 直接放弃（还原原底色） */
  function visibleRows(btns) {
    var tops = [], vis = 0;
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.offsetWidth === 0 && b.offsetHeight === 0) continue;
      vis++;
      if (tops.indexOf(b.offsetTop) < 0) tops.push(b.offsetTop);
    }
    return { vis: vis, rows: tops.length };
  }

  function deactivate(seg) {
    var st = seg.__m190;
    if (st) {
      if (st.ind && st.ind.parentNode) st.ind.parentNode.removeChild(st.ind);
      if (st.ro && st.ro.disconnect) st.ro.disconnect();
      seg.__m190 = null;
    }
    seg.classList.remove('m190-seg', 'm190-ready');
  }

  function measure(seg) {
    var st = seg.__m190;
    if (!st) return;
    var btns = st.btns;
    var info = visibleRows(btns);
    /* 窄屏把按钮挤成两行 → 放弃该 seg（还原原 .on 底色） */
    if (info.rows > 1) { deactivate(seg); return; }
    if (!info.vis) return;                       /* 整块隐藏，等 ResizeObserver */

    var ref = seg.querySelector('button.on');
    if (!ref || (ref.offsetWidth === 0 && ref.offsetHeight === 0)) ref = null;
    if (!ref) {
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].offsetWidth || btns[i].offsetHeight) { ref = btns[i]; break; }
      }
    }
    if (!ref) return;

    var cs = window.getComputedStyle(seg);
    var bl = parseFloat(cs.borderLeftWidth) || 0;
    var bt = parseFloat(cs.borderTopWidth) || 0;
    var cr = seg.getBoundingClientRect();
    var br = ref.getBoundingClientRect();

    var x = Math.round((br.left - cr.left - bl) * 100) / 100;
    var y = Math.round((br.top - cr.top - bt) * 100) / 100;
    var w = Math.round(br.width * 100) / 100;
    var h = Math.round(br.height * 100) / 100;
    if (w <= 0) return;

    var ind = st.ind;
    ind.style.width = w + 'px';
    ind.style.height = h + 'px';
    ind.style.top = y + 'px';
    ind.style.transform = 'translate3d(' + x + 'px,0,0)';
  }

  function setup(seg) {
    var btns = buttonsOf(seg);
    if (btns.length < 2) return;

    var ind = doc.createElement('span');
    ind.className = 'm190-ind';
    ind.setAttribute('aria-hidden', 'true');
    seg.appendChild(ind);

    seg.__m190 = { ind: ind, btns: btns, ro: null };
    seg.classList.add('m190-seg');

    measure(seg);

    /* 首帧无动画：定位落地后再开 transition */
    requestAnimationFrame(function () {
      if (seg.__m190) seg.classList.add('m190-ready');
    });

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { measure(seg); });
      ro.observe(seg);
      seg.__m190.ro = ro;
    }
  }

  function ensureSeg(seg) {
    /* .view-seg 有自己的一套选中态（accent-soft + 内描边），不接管 */
    if (seg.classList.contains('view-seg')) return;
    if (seg.__m190) { measure(seg); return; }

    var btns = buttonsOf(seg);
    if (btns.length < 2) return;
    if (visibleRows(btns).rows > 1) return;   /* 已经换行的 seg 不挂载 */
    if (!seg.offsetParent) return;            /* 挂在隐藏页签里，显示后再挂 */
    setup(seg);
  }

  function ensureAllSegs() {
    var segs = doc.querySelectorAll('.seg');
    for (var i = 0; i < segs.length; i++) ensureSeg(segs[i]);
  }

  /* ======================= B. 侧栏图标变形 ======================= */

  var lastRail = null;
  var railBooted = false;

  function pulse(btn, cls) {
    var svg = btn.querySelector('.rb-ico svg');
    if (!svg) return;
    if (svg.__m190t) { clearTimeout(svg.__m190t); svg.__m190t = 0; }
    svg.classList.remove('m190-pop', 'm190-dim');
    /* 强制回流以重启动画（每次切页最多一次） */
    void svg.getBoundingClientRect().width;
    if (!motionOn()) return;
    svg.classList.add(cls);
    var done = function () {
      svg.classList.remove(cls);
      if (svg.__m190t) { clearTimeout(svg.__m190t); svg.__m190t = 0; }
    };
    svg.addEventListener('animationend', done, { once: true });
    svg.__m190t = setTimeout(done, 620);
  }

  function syncRail() {
    var active = doc.querySelector('.rail-btn.active');
    if (!railBooted) { railBooted = true; lastRail = active; return; }
    if (!active || active === lastRail) return;
    var prev = lastRail;
    lastRail = active;
    if (prev && prev !== active) pulse(prev, 'm190-dim');
    pulse(active, 'm190-pop');
  }

  /* ======================= C / D. 搜索框与开关 ======================= */

  function ensureSearch() {
    var box = doc.querySelector('.search');
    if (!box || !doc.getElementById('searchInput')) return;
    if (!box.classList.contains('m190-search')) box.classList.add('m190-search');
  }

  function ensureSwitches() {
    var list = doc.querySelectorAll('.switch');
    for (var i = 0; i < list.length; i++) {
      if (!list[i].classList.contains('m190-toggle')) list[i].classList.add('m190-toggle');
    }
  }

  /* ======================= 统一调度 ======================= */

  var rafId = 0;

  function tick() {
    rafId = 0;
    ensureAllSegs();
    syncRail();
    ensureSearch();
    ensureSwitches();
  }

  function schedule() {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  }

  function boot() {
    injectCss();
    schedule();

    /* class / 子节点 / hidden 变化统一 rAF 合并，一帧最多跑一次 */
    var mo = new MutationObserver(schedule);
    mo.observe(doc.body || root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden']
    });

    /* 尺寸变化（窄屏换行、字体加载、页签显示）后重新量一次 */
    var rz = 0;
    window.addEventListener('resize', function () {
      if (rz) return;
      rz = requestAnimationFrame(function () { rz = 0; tick(); });
    }, { passive: true });

    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) {
      doc.fonts.ready.then(function () { schedule(); });
    }
    window.addEventListener('load', schedule, { once: true });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
