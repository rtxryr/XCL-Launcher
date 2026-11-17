/* ------------------------------------------------------------------
 * patch/120-counters.js — 数字滚动（Number Counter）+ 环形进度 API
 * 参考 uimotion.fyi：数字像老虎机一样滚到位，数据才有"活着"的感觉。
 * 只接管确实表示进度/数量的元素，不做全站乱接管。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__xclPatch120) return;
  window.__xclPatch120 = true;

  var doc = document;
  var root = doc.documentElement;
  var STYLE_ID = 'patch-120-style';

  /* 已知的百分比元素（grep 确认过） */
  var PCT_IDS = ['taskPct', 'dlgPct', 'dlChipPct', 'fmpTcPct'];
  var NUM_RE = /^(\s*)([\d]+(?:[.,]\d+)?)(\s*)(%|MB|GB|KB|B|ms|s|线程|项|个)?(\s*)$/;

  function motionOn() { return root.dataset.motion !== 'off'; }

  function injectCss() {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.m120-num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}',
      '.m120-ring-wrap{position:relative;display:inline-grid;place-items:center;flex-shrink:0}',
      '.m120-ring-wrap svg{display:block;transform:rotate(-90deg)}',
      '.m120-ring-bg{stroke:var(--stroke-2);fill:none}',
      '.m120-ring-fg{stroke:var(--accent);fill:none;stroke-linecap:round;',
      '  transition:stroke-dashoffset .35s cubic-bezier(.2,.8,.2,1)}',
      '.m120-ring-txt{position:absolute;font-size:11.5px;font-weight:650;color:var(--txt);',
      '  font-variant-numeric:tabular-nums}',
      'html[data-motion="off"] .m120-ring-fg{transition:none}',
      '@media (prefers-reduced-motion:reduce){.m120-ring-fg{transition:none}}'
    ].join('\n');
    (doc.head || root).appendChild(st);
  }

  /* ---------------- 数字 tween ---------------- */
  var busy = new WeakSet();

  function parse(text) {
    var m = NUM_RE.exec(text || '');
    if (!m) return null;
    var numStr = m[2].replace(',', '.');
    var dec = numStr.indexOf('.') >= 0 ? numStr.split('.')[1].length : 0;
    return {
      pre: m[1], num: parseFloat(numStr), dec: dec,
      mid: m[3], unit: m[4] || '', post: m[5]
    };
  }

  function fmt(p, v) {
    var s = p.dec > 0 ? v.toFixed(p.dec) : String(Math.round(v));
    return p.pre + s + p.mid + p.unit + p.post;
  }

  /**
   * 把 el 的数值从当前值滚到 to
   * @param {Element} el
   * @param {number} to
   * @param {{dur?:number, suffix?:string}} opts
   */
  function count(el, to, opts) {
    if (!el || !isFinite(to)) return;
    opts = opts || {};
    var p = parse(el.textContent || '');
    if (!p) {
      /* 不是纯数值：直接写，不乱动 */
      if (opts.suffix !== undefined) el.textContent = String(to) + opts.suffix;
      return;
    }
    var from = p.num;
    var target = to;
    if (opts.suffix !== undefined) p.unit = opts.suffix;

    if (!motionOn() || from === target) {
      el.textContent = fmt(p, target);
      return;
    }
    if (busy.has(el)) { el.textContent = fmt(p, target); return; }

    busy.add(el);
    try { el.classList.add('m120-num'); } catch (e) {}

    var dur = opts.dur || 520;
    var t0 = 0;
    function ease(t) { return 1 - Math.pow(1 - t, 3); }   /* easeOutCubic */

    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      var v = from + (target - from) * ease(k);
      el.textContent = fmt(p, v);
      if (k < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = fmt(p, target);
        busy.delete(el);
      }
    }
    requestAnimationFrame(step);
  }

  /* ---------------- 自动接管百分比元素 ---------------- */
  var last = Object.create(null);

  function pick(el) {
    if (!el || el.nodeType !== 1 || !motionOn()) return;
    var txt = (el.textContent || '').trim();
    var p = parse(txt);
    if (!p || !p.unit || p.unit !== '%') return;
    var v = p.num;
    var old = last[el.id];
    last[el.id] = v;
    if (old === undefined || old === v) return;
    /* 进度跳跃（超过 40 个点）不做 tween，直接写 —— 否则看起来在"倒放" */
    if (Math.abs(v - old) > 40) { el.textContent = fmt(p, v); return; }
    count(el, v, { dur: 480 });
  }

  var selfWrite = false;

  function watchIds() {
    PCT_IDS.forEach(function (id) {
      var el = doc.getElementById(id);
      if (!el || el.dataset.m120) return;
      el.dataset.m120 = '1';
      el.classList.add('m120-num');
      var p = parse(el.textContent || '');
      if (p) last[id] = p.num;

      var mo = new MutationObserver(function () {
        if (selfWrite || busy.has(el)) return;
        pick(el);
      });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  /* ---------------- 环形进度 ---------------- */
  function ring(host, o) {
    o = o || {};
    var size = o.size || 64;
    var sw = o.stroke || 6;
    var r = (size - sw) / 2;
    var c = 2 * Math.PI * r;

    var wrap = doc.createElement('div');
    wrap.className = 'm120-ring-wrap';
    wrap.style.width = size + 'px';
    wrap.style.height = size + 'px';
    wrap.innerHTML =
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
        '<circle class="m120-ring-bg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + sw + '"></circle>' +
        '<circle class="m120-ring-fg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + sw + '"' +
          ' stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + c.toFixed(2) + '"></circle>' +
      '</svg>' +
      '<span class="m120-ring-txt">0%</span>';

    var fg = wrap.querySelector('.m120-ring-fg');
    var tx = wrap.querySelector('.m120-ring-txt');

    if (host && host.appendChild) host.appendChild(wrap);

    return {
      el: wrap,
      set: function (v) {
        var k = Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
        fg.setAttribute('stroke-dashoffset', (c * (1 - k)).toFixed(2));
        tx.textContent = Math.round(k * 100) + '%';
      },
      destroy: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
  }

  function boot() {
    injectCss();
    watchIds();
    /* 元素可能后渲染：短轮询补齐一次 */
    var n = 0;
    var t = setInterval(function () {
      watchIds();
      if (++n > 40) clearInterval(t);
    }, 300);
    window.M120 = { count: count, ring: ring };
    console.log('[patch 120] ready · targets:', PCT_IDS.join(','));
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
