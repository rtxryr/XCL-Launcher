/* ============================================================
 * patch 180 - Drag Reorder / Stacked File Hover / Delete Reveal
 * 只做三件事，全部用前缀 .m180- 隔离，幂等。
 * 拖拽排序：#verList（版本列表）、#resList（已安装资源）
 * 堆叠悬停：#fbpList（诊断包行）、#verList（列表视图，非 cards）
 * 删除揭示：window.M180.collapse(el)
 * ============================================================ */
(function () {
  'use strict';
  if (window.__xclPatch180) return;
  window.__xclPatch180 = true;

  var doc = document;
  var root = doc.documentElement;

  var CSS_ID = 'patch-180-style';
  var SORT_CLS = 'm180-sortable';
  var DRAG_CLS = 'm180-dragging';
  var SRC_CLS = 'm180-drag-src';
  var STACK_CLS = 'm180-stack';
  var ENTER_CLS = 'm180-enter';
  var DROP_CLS = 'm180-drop';
  var LINE_ID = 'm180-line';

  var SORTABLE_SEL = ['#verList', '#resList'];
  var STACK_SEL = ['#fbpList', '#verList'];
  var OBSERVE_SEL = ['#verList', '#resList', '#fbpList'];

  function motionOn() { return root.dataset.motion !== 'off'; }

  /* ---------------- 存储（file:// 下 localStorage 可能抛错，降级内存） ---------------- */
  var memStore = {};
  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return memStore[k] || null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { memStore[k] = v; }
  }

  /* ---------------- 样式 ---------------- */
  function injectCss() {
    if (doc.getElementById(CSS_ID)) return;
    var css = [
      /* --- 拖拽排序 --- */
      '.' + SORT_CLS + '.m180-dragging{user-select:none;-webkit-user-select:none}',
      /* 让位要跟手，但不能硬切：给一点 spring 尾巴 */
      '.' + SORT_CLS + '.m180-dragging > *{transition:transform .24s cubic-bezier(.2,1.05,.35,1)}',
      /* 拖起来的那张抬成纸牌：微旋 + 抬起 + 落影 */
      '.' + SRC_CLS + '{opacity:.42;transform:rotate(-2.5deg) scale(1.015);',
      '  box-shadow:0 18px 38px -18px var(--shadow-2);',
      '  transition:opacity .16s ease,transform .24s cubic-bezier(.34,1.3,.64,1),box-shadow .24s ease}',
      '.' + SORT_CLS + '.m180-dragging > *:hover{transform:none}',
      '@keyframes m180Drop{0%{transform:scale(1.02)}58%{transform:scale(.996)}100%{transform:scale(1)}}',
      '.' + DROP_CLS + '{animation:m180Drop .3s cubic-bezier(.2,.9,.25,1) both}',
      '#' + LINE_ID + '{position:fixed;left:0;top:0;height:2px;width:120px;border-radius:999px;',
      '  background:var(--accent);box-shadow:0 0 0 1px var(--accent-soft),0 3px 14px var(--accent-line);',
      '  opacity:0;pointer-events:none;z-index:2147483000;will-change:transform,opacity;',
      '  transition:transform .12s ease,opacity .14s ease}',

      /* --- 纸牌堆叠扇开 ---
       * 参数照 uimotion.fyi/docs/stacked-file-hover：
       *   duration 600ms / cubic-bezier(.34,1.3,.64,1)（回位也带过冲，别用线性）
       *   侧卡位移 ≤30px、旋转 ≤25°，只动 transform 不动 opacity（保住层叠视差）
       *   transform-origin 压在底部，扇开才像纸牌而不是整块平移
       * :has 不支持时只是弱一档（仅中心卡抬起），不会报错 */
      '.m180-stack:not(.cards) > *{transition:transform 600ms cubic-bezier(.34,1.3,.64,1);',
      '  transform-origin:50% 84%;will-change:transform}',
      '.m180-stack:not(.cards) > *:hover{transform:translateY(-3px) scale(1.035);z-index:3}',
      '.m180-stack:not(.cards) > *:hover + *{transform:translateX(30px) rotate(11deg) scale(.985)}',
      '.m180-stack:not(.cards) > *:has(+ *:hover){transform:translateX(-30px) rotate(-11deg) scale(.985)}',
      '.m180-stack:not(.cards) > *:hover + * + *{transform:translateX(46px) rotate(17deg) scale(.968)}',
      '.m180-stack:not(.cards) > *:has(+ * + *:hover){transform:translateX(-46px) rotate(-17deg) scale(.968)}',

      /* --- 新增项入场 --- */
      '@keyframes m180Enter{from{opacity:0;transform:translateY(-6px) scale(.96)}to{opacity:1;transform:none}}',
      '.' + ENTER_CLS + '{animation:m180Enter .32s cubic-bezier(.2,.9,.2,1) both}',

      /* --- 删除揭示 --- */
      '.m180-collapsing{pointer-events:none}',

      /* --- 动效关闭兜底 --- */
      'html[data-motion="off"] .' + SORT_CLS + '.m180-dragging > *{transition:none}',
      'html[data-motion="off"] .' + SRC_CLS + '{transition:none}',
      'html[data-motion="off"] .' + DROP_CLS + '{animation:none}',
      'html[data-motion="off"] .' + ENTER_CLS + '{animation:none;opacity:1;transform:none}',
      'html[data-motion="off"] .m180-stack:not(.cards) > *{transition:none;transform:none}',
      'html[data-motion="off"] #' + LINE_ID + '{transition:none}',

      /* --- 系统级减少动效 --- */
      '@media (prefers-reduced-motion:reduce){',
      '  .' + SORT_CLS + '.m180-dragging > *{transition:none}',
      '  .' + DROP_CLS + '{animation:none}',
      '  .' + ENTER_CLS + '{animation:none}',
      '  .m180-stack:not(.cards) > *{transition:none}',
      '  .m180-stack:not(.cards) > *:hover,',
      '  .m180-stack:not(.cards) > *:hover + *,',
      '  .m180-stack:not(.cards) > *:has(+ *:hover){transform:none}',
      '}'
    ].join('\n');

    var st = doc.createElement('style');
    st.id = CSS_ID;
    st.textContent = css;
    (doc.head || root).appendChild(st);
  }

  /* ---------------- 元素标识 ---------------- */
  function idOf(el) {
    if (!el || el.nodeType !== 1) return '';
    var d = el.getAttribute('data-ver') || el.getAttribute('data-res') ||
      el.getAttribute('data-id') || el.getAttribute('data-key');
    if (d) return String(d);
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    var h = 0, i;
    for (i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return 't' + h.toString(36) + '-' + t.length;
  }

  function orderKey(c) {
    return 'mc.listOrder.' + (c.id || 'anon');
  }

  function readOrder(c) {
    var raw = lsGet(orderKey(c));
    if (!raw) return null;
    try {
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : null;
    } catch (e) { return null; }
  }

  function saveOrder(c) {
    var ids = Array.prototype.map.call(c.children, idOf);
    lsSet(orderKey(c), JSON.stringify(ids));
    return ids;
  }

  /* 按存储顺序重排 DOM；已符合顺序时完全不碰 DOM（避免 MutationObserver 自激） */
  function applyOrder(c) {
    if (!c || c.__m180Applying) return false;
    var saved = readOrder(c);
    if (!saved || saved.length < 2) return false;
    var kids = Array.prototype.slice.call(c.children);
    if (kids.length < 2) return false;

    var rank = {}, i;
    for (i = 0; i < saved.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(rank, saved[i])) rank[saved[i]] = i;
    }

    var rows = kids.map(function (el, n) {
      var id = idOf(el);
      var r = Object.prototype.hasOwnProperty.call(rank, id) ? rank[id] : 1e6 + n;
      return { el: el, r: r, n: n };
    }).sort(function (a, b) { return a.r - b.r || a.n - b.n; });

    var same = rows.every(function (x, n) { return x.n === n; });
    if (same) return false;

    c.__m180Applying = true;
    var frag = doc.createDocumentFragment();
    for (i = 0; i < rows.length; i++) frag.appendChild(rows[i].el);
    c.appendChild(frag);
    c.__m180Applying = false;
    return true;
  }

  /* ---------------- 拖拽排序 ---------------- */
  var ctx = null;

  function childOf(c, node) {
    while (node && node.parentNode !== c) node = node.parentNode;
    return node && node.nodeType === 1 ? node : null;
  }

  function lineEl() {
    var l = doc.getElementById(LINE_ID);
    if (!l) {
      l = doc.createElement('div');
      l.id = LINE_ID;
      l.setAttribute('aria-hidden', 'true');
      (doc.body || root).appendChild(l);
    }
    return l;
  }

  function hideLine() {
    var l = doc.getElementById(LINE_ID);
    if (l) l.style.opacity = '0';
  }

  function isColumn(c) {
    var cs = window.getComputedStyle(c);
    return cs.display === 'flex' && (cs.flexDirection || 'row').indexOf('column') === 0;
  }

  function clearShift(c) {
    Array.prototype.forEach.call(c.children, function (el) {
      if (el.style.transform) el.style.transform = '';
    });
  }

  function shift(c, pos) {
    if (!isColumn(c)) { clearShift(c); return; }
    var cs = window.getComputedStyle(c);
    var gap = parseFloat(cs.rowGap || cs.gap) || 0;
    var kids = Array.prototype.slice.call(c.children);
    var srcEl = ctx.el;
    var srcPos = kids.indexOf(srcEl);
    if (srcPos < 0) return;
    var step = srcEl.offsetHeight + gap;

    kids.forEach(function (el, i) {
      if (el === srcEl) return;
      var j = i > srcPos ? i - 1 : i;
      var d = 0;
      if (pos > srcPos && j >= srcPos && j < pos) d = -step;
      else if (pos < srcPos && j >= pos && j < srcPos) d = step;
      var next = d ? 'translateY(' + d + 'px)' : '';
      if (el.style.transform !== next) el.style.transform = next;
    });
  }

  function showLine(c, kids, pos) {
    var l = lineEl();
    var cr = c.getBoundingClientRect();
    var cs = window.getComputedStyle(c);
    var gap = parseFloat(cs.rowGap || cs.gap) || 8;
    var y;
    if (!kids.length) y = cr.top + 3;
    else if (pos <= 0) y = kids[0].getBoundingClientRect().top - gap / 2;
    else if (pos >= kids.length) y = kids[kids.length - 1].getBoundingClientRect().bottom + gap / 2;
    else {
      y = (kids[pos - 1].getBoundingClientRect().bottom + kids[pos].getBoundingClientRect().top) / 2;
    }
    var x = Math.round(cr.left);
    var w = Math.round(cr.width);
    if (l.style.width !== w + 'px') l.style.width = w + 'px';
    if (l.style.height !== '2px') l.style.height = '2px';   /* 从竖线模式切回横线 */
    l.style.transform = 'translate3d(' + x + 'px,' + Math.round(y) + 'px,0)';
    l.style.opacity = '1';
  }

  /* 网格视图：指示线改为竖线，落在目标卡左右边缘 */
  function showLineGrid(c, kids, pos, srcEl) {
    var l = lineEl();
    var cs = window.getComputedStyle(c);
    var gap = parseFloat(cs.columnGap || cs.gap) || 10;
    var ref, x;
    if (pos <= 0) {
      ref = kids[0];
      x = ref ? ref.getBoundingClientRect().left - gap / 2 : c.getBoundingClientRect().left + 3;
    } else if (pos >= kids.length) {
      ref = kids[kids.length - 1];
      x = ref ? ref.getBoundingClientRect().right + gap / 2 : c.getBoundingClientRect().right - 3;
    } else {
      var a = kids[pos - 1] && kids[pos - 1] !== srcEl ? kids[pos - 1] : null;
      var b = kids[pos];
      if (a && b) x = (a.getBoundingClientRect().right + b.getBoundingClientRect().left) / 2;
      else if (b) x = b.getBoundingClientRect().left - gap / 2;
      else x = c.getBoundingClientRect().left + 3;
    }
    var r0 = (kids[0] || c).getBoundingClientRect();
    var y = Math.round(r0.top);
    var h = Math.round(r0.height);
    l.style.width = '3px';
    l.style.transform = 'translate3d(' + Math.round(x) + 'px,' + y + 'px,0)';
    l.style.height = h + 'px';
    l.style.opacity = '1';
  }

  function startDrag(c, e) {
    if (!ctx && e.target) {
      var item = childOf(c, e.target);
      if (!item) return;
      var kids = Array.prototype.slice.call(c.children);
      if (kids.length < 2) return;
      if (item.getBoundingClientRect().height <= 30) return;
      if (c.__m180Applying) return;
      ctx = { c: c, el: item, pos: kids.indexOf(item), shown: false, moved: false, gap: 0 };
      item.classList.add(SRC_CLS);
      c.classList.add(DRAG_CLS);
      if (e.dataTransfer) {
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', idOf(item));
        } catch (err) { /* 忽略 */ }
      }
      var l = lineEl();
      l.style.opacity = '0';
    }
  }

  function overDrag(c, e) {
    if (!ctx || ctx.c !== c) return;
    e.preventDefault();
    if (e.dataTransfer) { try { e.dataTransfer.dropEffect = 'move'; } catch (err) {} }

    var x = e.clientX || 0;
    var y = e.clientY || 0;
    var kids = Array.prototype.filter.call(c.children, function (el) { return el !== ctx.el; });
    if (!kids.length) return;

    var grid = !isColumn(c);
    var best = -1, bestD = Infinity, i, r, d;
    if (grid) {
      /* 网格/行布局：按与每张卡中心的欧氏距离找落点（单轴 y 会在多列网格下失灵） */
      for (i = 0; i < kids.length; i++) {
        r = kids[i].getBoundingClientRect();
        d = (r.left + r.width / 2 - x) * (r.left + r.width / 2 - x) +
            (r.top + r.height / 2 - y) * (r.top + r.height / 2 - y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return;
      var gbr = kids[best].getBoundingClientRect();
      /* 光标落在卡中心右侧/下侧 → 插到它后面；否则前面 */
      ctx.pos = best + ((x > gbr.left + gbr.width / 2 || y > gbr.top + gbr.height / 2) ? 1 : 0);
    } else {
      for (i = 0; i < kids.length; i++) {
        r = kids[i].getBoundingClientRect();
        d = Math.abs(r.top + r.height / 2 - y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return;
      var br = kids[best].getBoundingClientRect();
      ctx.pos = best + (y > br.top + br.height / 2 ? 1 : 0);
    }

    if (!ctx.shown || ctx.pos !== ctx.lastPos) {
      ctx.lastPos = ctx.pos;
      ctx.shown = true;
      if (grid) { clearShift(c); showLineGrid(c, kids, ctx.pos, ctx.el); }
      else { shift(c, ctx.pos); showLine(c, kids, ctx.pos); }
    }
    ctx.moved = true;
  }

  function finishDrag(c, e, fromEnd) {
    if (!ctx || ctx.c !== c) return;
    var d = ctx;
    ctx = null;

    if (!fromEnd && e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    }

    hideLine();
    c.classList.remove(DRAG_CLS);
    d.el.classList.remove(SRC_CLS);
    clearShift(c);

    if (fromEnd) return;              /* 拖到容器外松手：只清理，不改顺序 */
    if (!d.moved) return;             /* 原地点击式拖拽：不动 */

    var rest = Array.prototype.filter.call(c.children, function (el) { return el !== d.el; });
    var ref = d.pos < rest.length ? rest[d.pos] : null;
    if (ref) c.insertBefore(d.el, ref);
    else c.appendChild(d.el);

    saveOrder(c);

    if (motionOn()) {
      d.el.classList.add(DROP_CLS);
      var clear = function () { d.el.classList.remove(DROP_CLS); };
      d.el.addEventListener('animationend', clear, { once: true });
      setTimeout(clear, 420);
    }
  }

  function bind(c) {
    if (c.__m180Bound) return;
    c.__m180Bound = true;
    c.addEventListener('dragstart', function (e) { startDrag(c, e); }, false);
    c.addEventListener('dragover', function (e) { overDrag(c, e); }, false);
    c.addEventListener('drop', function (e) { finishDrag(c, e, false); }, false);
    c.addEventListener('dragend', function (e) { finishDrag(c, e, true); }, false);
    c.addEventListener('dragleave', function (e) {
      if (!ctx || ctx.c !== c) return;
      var to = e.relatedTarget;
      if (to && c.contains(to)) return;
      hideLine();
    }, false);
  }

  /* ---------------- 刷新：可排序 / 可堆叠 ---------------- */
  function refresh(c) {
    if (!c) return;
    var kids = Array.prototype.slice.call(c.children);
    var enough = kids.length >= 2;

    var wantSort = enough && SORTABLE_SEL.indexOf('#' + c.id) >= 0;
    if (wantSort) {
      c.classList.add(SORT_CLS);
      kids.forEach(function (el) {
        if (el.getAttribute('draggable') !== 'true') el.setAttribute('draggable', 'true');
      });
      bind(c);
    } else if (c.classList.contains(SORT_CLS)) {
      c.classList.remove(SORT_CLS);
    }

    if (STACK_SEL.indexOf('#' + c.id) >= 0) {
      c.classList.toggle(STACK_CLS, motionOn() && enough);
    }
  }

  function playEnter(nodes) {
    if (!motionOn()) return;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || el.nodeType !== 1) continue;
      if (el.classList.contains(ENTER_CLS)) continue;
      el.classList.add(ENTER_CLS);
      (function (node) {
        var done = function () { node.classList.remove(ENTER_CLS); };
        node.addEventListener('animationend', done, { once: true });
        setTimeout(done, 500);
      })(el);
    }
  }

  function observe(c) {
    if (c.__m180Obs) return;
    var pending = false;
    var mo = new MutationObserver(function (muts) {
      if (c.__m180Applying) return;
      var added = [];
      for (var i = 0; i < muts.length; i++) {
        var an = muts[i].addedNodes;
        if (!an) continue;
        for (var j = 0; j < an.length; j++) if (an[j].nodeType === 1) added.push(an[j]);
      }
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        if (c.__m180Applying) return;
        if (SORTABLE_SEL.indexOf('#' + c.id) >= 0) applyOrder(c);
        refresh(c);
        /* 只给零散新增做入场，整表重绘（>8）不抢 140 号补丁的错落动画 */
        if (added.length && added.length <= 8 && added.length < c.children.length) playEnter(added);
      });
    });
    mo.observe(c, { childList: true });
    c.__m180Obs = mo;
  }

  /* ---------------- 删除揭示 ---------------- */
  function collapse(el) {
    return new Promise(function (resolve) {
      if (!el || !el.parentNode) { resolve(false); return; }
      var h = el.getBoundingClientRect().height;
      if (!h) { el.remove(); resolve(true); return; }

      var cs = window.getComputedStyle(el);
      el.classList.add('m180-collapsing');
      el.style.boxSizing = 'border-box';
      el.style.height = h + 'px';
      el.style.overflow = 'hidden';
      el.style.willChange = 'height,opacity';
      /* 先定高再收掉纵向内边距：外框高度不变，不会跳一下 */
      el.style.paddingTop = '0px';
      el.style.paddingBottom = '0px';
      void el.offsetHeight;

      el.style.transition = 'height .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease';
      requestAnimationFrame(function () {
        el.style.height = '0px';
        el.style.opacity = '0';
      });

      var done = false;
      function fin() {
        if (done) return;
        done = true;
        if (el.parentNode) el.remove();
        resolve(true);
      }
      el.addEventListener('transitionend', function (e) {
        if (e.target === el && e.propertyName === 'height') fin();
      });
      setTimeout(fin, 480);
    });
  }

  /* ---------------- 初始化 ---------------- */
  function boot() {
    if (!doc.body) { doc.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    injectCss();

    var i;
    for (i = 0; i < OBSERVE_SEL.length; i++) {
      var c = doc.querySelector(OBSERVE_SEL[i]);
      if (!c) continue;
      if (SORTABLE_SEL.indexOf(OBSERVE_SEL[i]) >= 0) applyOrder(c);
      refresh(c);
      observe(c);
    }

    /* 运行中切换动效开关：类跟着走（CSS 也有兜底） */
    if (window.MutationObserver) {
      new MutationObserver(function () {
        STACK_SEL.forEach(function (sel) {
          var el = doc.querySelector(sel);
          if (el) refresh(el);
        });
      }).observe(root, { attributes: true, attributeFilter: ['data-motion'] });
    }
  }

  window.M180 = {
    version: '1.0.0',
    collapse: collapse,
    order: function (id) {
      var c = doc.getElementById(id);
      return c ? Array.prototype.map.call(c.children, idOf) : [];
    },
    reset: function (id) {
      var c = doc.getElementById(id);
      if (c) lsSet(orderKey(c), '[]');
    },
    refresh: function (id) {
      var c = doc.getElementById(id);
      if (c) refresh(c);
    }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
