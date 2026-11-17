/* ------------------------------------------------------------------
 * patch/150-celebrate.js — 庆祝类动效：彩带爆发 / 成功胶囊 / 触觉确认
 * 参考：uimotion.fyi 的 Confetti Burst + Payment Success + Haptic Confirmation
 *
 * 对外 API（window.M150）：
 *   M150.confetti({x, y, count})   从 (x,y) 爆一束彩带，无参数则视口上方居中
 *   M150.success(anchorEl, text)   在 anchor 中心弹一个带勾选的成功胶囊
 *   M150.tap(el)                   给元素播一次「按下感」
 *
 * 作用域：只新建自己的 DOM（#m150 全屏图层 / 成功胶囊），
 *         不改 index.html 任何既有节点，不碰 .btn-primary 的 transform
 *         （100 号磁吸在接管它），所有类名带 m150- 前缀。
 * 物理：单 rAF 驱动全部粒子，transform: translate3d + rotate，
 *       重力 .32 px/frame^2，水平阻尼 .995，粒子上限 120，2.2s 必回收。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch150) return;
  window.__xclPatch150 = true;

  var doc = document;
  var root = doc.documentElement;
  var STYLE_ID = 'patch-150-style';
  var LAYER_ID = 'm150Layer';

  var MAX_PARTICLES = 120;
  var GRAVITY = 0.32;
  var DRAG_X = 0.995;
  var LIFE_MS = 2200;
  var FADE_MS = 520;

  var COLOR_VARS = ['--accent', '--accent-l', '--accent-d', '--warn', '--danger'];

  function $(s, r) { return (r || doc).querySelector(s); }
  function motionOn() { return root.dataset.motion !== 'off'; }
  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function animOn() { return motionOn() && !reduced(); }

  /* ------------------------------ 样式 ------------------------------ */

  var CSS = `
/* ================= 150-celebrate ================= */

/* 彩带图层：全屏、不吃鼠标、不参与布局计算 */
#${LAYER_ID}{
  position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden;
  contain:layout style;
}
#${LAYER_ID} .m150-conf{
  position:absolute;top:0;left:0;width:10px;height:16px;
  border-radius:2px;background:var(--accent);
  will-change:transform,opacity;backface-visibility:hidden;
  transform:translate3d(-999px,-999px,0);
}

/* 成功胶囊：外层只负责居中定位，内层负责缩放（互不干扰） */
.m150-ok{
  position:fixed;z-index:9998;pointer-events:none;
  transform:translate(-50%,-50%);
}
.m150-ok-in{
  display:inline-flex;align-items:center;gap:9px;
  padding:9px 17px 9px 10px;border-radius:var(--r-pill,999px);
  background:var(--tip-bg,rgba(16,20,24,.94));
  border:1px solid var(--accent-line,var(--stroke));
  box-shadow:0 18px 38px -20px var(--shadow-1,rgba(0,0,0,.8)),0 0 0 1px var(--accent-soft);
  color:var(--txt);font:inherit;font-size:12.5px;font-weight:560;line-height:1;white-space:nowrap;
  -webkit-backdrop-filter:blur(14px) saturate(150%);backdrop-filter:blur(14px) saturate(150%);
  transform-origin:center;will-change:transform,opacity;
  animation:m150OkIn calc(.45s * var(--anim-k)) cubic-bezier(.2,1.3,.4,1) both;
}
.m150-ok-ico{
  display:grid;place-items:center;width:22px;height:22px;border-radius:50%;
  flex-shrink:0;background:var(--accent-soft);
  box-shadow:inset 0 0 0 1.4px var(--accent-line),inset 0 0 0 1.4px var(--accent);
}
.m150-ok-ico svg{display:block;width:13px;height:13px;color:var(--accent)}
.m150-check{
  stroke-dasharray:24;stroke-dashoffset:24;
  animation:m150Draw calc(.4s * var(--anim-k)) cubic-bezier(.4,0,.2,1) .1s forwards;
}
.m150-ok-out .m150-ok-in{animation:m150OkOut calc(.3s * var(--anim-k)) var(--ease) both}

@keyframes m150OkIn{
  0%{opacity:0;transform:scale(.8)}
  70%{opacity:1;transform:scale(1.04)}
  100%{opacity:1;transform:scale(1)}
}
@keyframes m150OkOut{
  from{opacity:1;transform:translateY(0) scale(1)}
  to{opacity:0;transform:translateY(-9px) scale(.98)}
}
@keyframes m150Draw{to{stroke-dashoffset:0}}

/* 触觉确认：只看 scale，落地即移除类，连点可重播 */
@keyframes m150Tap{
  0%{transform:scale(1)}
  35%{transform:scale(.955)}
  70%{transform:scale(1.012)}
  100%{transform:scale(1)}
}
.m150-tap{
  animation:m150Tap calc(.22s * var(--anim-k)) var(--ease);
  transform-origin:center;will-change:transform;
}

/* 关闭动效 / 系统减弱动态：不留任何动画，成功条退化为静态提示 */
html[data-motion="off"] #${LAYER_ID}{display:none}
html[data-motion="off"] .m150-ok-in,
html[data-motion="off"] .m150-tap{animation:none!important}
html[data-motion="off"] .m150-check{animation:none!important;stroke-dashoffset:0}

@media (prefers-reduced-motion: reduce){
  #${LAYER_ID}{display:none}
  .m150-ok-in,.m150-tap{animation:none!important}
  .m150-check{animation:none!important;stroke-dashoffset:0}
}
`;

  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || root).appendChild(st);
  }

  /* ---------------------------- 调色板 ---------------------------- */

  function palette() {
    var cs;
    try { cs = getComputedStyle(root); } catch (e) { cs = null; }
    var out = [];
    if (cs) {
      for (var i = 0; i < COLOR_VARS.length; i++) {
        var v = (cs.getPropertyValue(COLOR_VARS[i]) || '').trim();
        if (v) out.push(v);
      }
    }
    if (!out.length) out.push('#6fe08a');
    return out;
  }

  /* ---------------------------- 彩带爆发 ---------------------------- */

  var layer = null;
  var parts = [];
  var rafId = 0;
  var lastT = 0;

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    layer = doc.getElementById(LAYER_ID) || doc.createElement('div');
    layer.id = LAYER_ID;
    layer.setAttribute('aria-hidden', 'true');
    if (!layer.parentNode) doc.body.appendChild(layer);
    return layer;
  }

  function killLayer() {
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = null;
    parts = [];
  }

  function clearParts() {
    for (var i = 0; i < parts.length; i++) {
      var el = parts[i].el;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    parts = [];
  }

  function removePart(i) {
    var p = parts[i];
    if (p && p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
    parts.splice(i, 1);
  }

  function tick(now) {
    var dt = 16.667;
    if (lastT) dt = Math.min(Math.max(now - lastT, 8), 50);
    lastT = now;
    var k = dt / 16.667;

    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.vy += GRAVITY * k;
      p.vx *= Math.pow(DRAG_X, k);
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.rot += p.vr * k;

      var age = now - p.born;
      if (age > LIFE_MS || p.y > (window.innerHeight || 900) + 60 ||
          p.x < -80 || p.x > (window.innerWidth || 1440) + 80) {
        removePart(i);
        continue;
      }
      p.el.style.transform = 'translate3d(' + p.x.toFixed(2) + 'px,' + p.y.toFixed(2) + 'px,0) rotate(' + p.rot.toFixed(1) + 'deg)';
      if (age > LIFE_MS - FADE_MS) {
        p.el.style.opacity = ((LIFE_MS - age) / FADE_MS).toFixed(3);
      }
    }

    if (!parts.length) {
      rafId = 0;
      lastT = 0;
      killLayer();
      return;
    }
    rafId = window.requestAnimationFrame(tick);
  }

  function confetti(o) {
    if (!animOn()) return 0;
    o = o || {};

    var W = window.innerWidth || 1440;
    var H = window.innerHeight || 900;
    var cx = Number(o.x);
    var cy = Number(o.y);
    if (!isFinite(cx)) cx = W / 2;
    if (!isFinite(cy)) cy = H * 0.42;

    var count = Number(o.count);
    if (!isFinite(count) || count <= 0) count = 90;
    count = Math.min(Math.round(count), MAX_PARTICLES);

    /* 超过上限就丢掉旧批，保证同屏粒子 <= 120 */
    if (parts.length + count > MAX_PARTICLES) clearParts();

    var L = ensureLayer();
    var pal = palette();

    for (var i = 0; i < count; i++) {
      var el = doc.createElement('div');
      el.className = 'm150-conf';
      var w = 8 + Math.random() * 6;
      el.style.width = w.toFixed(1) + 'px';
      el.style.height = (w * 1.6).toFixed(1) + 'px';
      el.style.background = pal[(Math.random() * pal.length) | 0];

      var ang = (-90 + (Math.random() * 110 - 55)) * Math.PI / 180;
      var v = 6 + Math.random() * 7;
      var rot = Math.random() * 360;

      el.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0) rotate(' + rot.toFixed(1) + 'deg)';
      L.appendChild(el);

      parts.push({
        el: el,
        x: cx,
        y: cy,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v,
        rot: rot,
        vr: (Math.random() * 24 - 12),
        born: performance.now()
      });
    }

    if (!rafId) {
      lastT = 0;
      rafId = window.requestAnimationFrame(tick);
    }
    return parts.length;
  }

  /* ---------------------------- 成功胶囊 ---------------------------- */

  function success(anchor, text) {
    if (!doc.body) return null;
    var label = (text === null || text === undefined || text === '') ? '操作成功' : String(text);
    var r = null;
    try { r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null; } catch (e) { r = null; }

    var W = window.innerWidth || 1440;
    var H = window.innerHeight || 900;
    var cx = r && r.width ? r.left + r.width / 2 : W / 2;
    var cy = r && r.height ? r.top + r.height / 2 : H / 2;
    if (!isFinite(cx)) cx = W / 2;
    if (!isFinite(cy)) cy = H / 2;

    var box = doc.createElement('div');
    box.className = 'm150-ok' + (animOn() ? '' : ' m150-ok-static');
    box.setAttribute('role', 'status');
    box.style.left = cx.toFixed(1) + 'px';
    box.style.top = cy.toFixed(1) + 'px';
    box.innerHTML =
      '<div class="m150-ok-in">' +
      '<span class="m150-ok-ico">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path class="m150-check" d="M5.6 12.5 9.9 16.9 18.4 8.1"/></svg>' +
      '</span><span class="m150-ok-t"></span></div>';
    box.querySelector('.m150-ok-t').textContent = label;
    doc.body.appendChild(box);

    var hold = animOn() ? 1600 : 1400;
    window.setTimeout(function () {
      box.classList.add('m150-ok-out');
      window.setTimeout(function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, animOn() ? 340 : 60);
    }, hold);

    return box;
  }

  /* ---------------------------- 触觉确认 ---------------------------- */

  function tap(el) {
    if (!el || !el.classList) return false;
    if (!animOn()) return false;
    el.classList.remove('m150-tap');
    /* 强制回流，保证连点也能重播 */
    void el.offsetWidth;
    el.classList.add('m150-tap');

    var done = function (e) {
      if (e && e.target !== el) return;
      el.classList.remove('m150-tap');
      el.removeEventListener('animationend', done);
    };
    el.addEventListener('animationend', done);
    window.setTimeout(done, 600);
    return true;
  }

  var delegated = false;
  function onPointerDown(e) {
    if (!animOn() || !e.target || !e.target.closest) return;
    var t = e.target.closest('button, .sw, .rail-btn');
    if (!t) return;
    /* 100 号磁吸正在接管 .btn-primary 的 transform，这里让位 */
    if (t.closest('.btn-primary')) return;
    if (t.disabled) return;
    tap(t);
  }

  function bindDelegate() {
    if (delegated) return;
    doc.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    delegated = true;
  }
  function unbindDelegate() {
    if (!delegated) return;
    doc.removeEventListener('pointerdown', onPointerDown, { capture: true });
    delegated = false;
  }

  /* ------------------------- 真实触发点接管 ------------------------- */

  var CELEBRATE_RE = /(下载完成|安装完成|安装成功|下载成功|游戏已启动)/;
  var SUCCESS_RE = /(已保存|保存成功|已设为|已切换|已更新|已忽略|设置成功|操作成功)/;
  var FAIL_RE = /(失败|错误|无法|异常|不可用|请稍候)/;

  var lastCelebrate = 0;
  var lastSuccess = 0;

  function labelFor(text) {
    if (/(下载完成|安装完成|安装成功|下载成功)/.test(text)) return '安装完成';
    if (/游戏已启动/.test(text)) return '游戏已启动';
    if (/(已保存|保存成功)/.test(text)) return '设置已保存';
    if (/已切换/.test(text)) return '已切换';
    if (/已更新|已设为/.test(text)) return '已更新';
    return text.length > 16 ? '操作成功' : text;
  }

  function anchorPoint(anchor, fallbackY) {
    var H = window.innerHeight || 900;
    var r = null;
    try { r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null; } catch (e) { r = null; }
    if (r && r.width) {
      return {
        x: r.left + r.width / 2,
        y: Math.min(r.top + 6, H * 0.72)
      };
    }
    return { x: (window.innerWidth || 1440) / 2, y: fallbackY || H * 0.55 };
  }

  function celebrate(anchor, label, count) {
    var p = anchorPoint(anchor);
    confetti({ x: p.x, y: p.y, count: count || 84 });
    success(anchor, label);
  }

  function handleToast(el) {
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || FAIL_RE.test(text)) return;
    var now = Date.now();

    if (CELEBRATE_RE.test(text)) {
      if (now - lastCelebrate < 900) return;
      lastCelebrate = now;
      lastSuccess = now;
      celebrate(el, labelFor(text), 84);
      return;
    }
    if (SUCCESS_RE.test(text)) {
      if (now - lastSuccess < 600) return;
      lastSuccess = now;
      success(el, labelFor(text));
    }
  }

  function watchToasts() {
    var wrap = doc.getElementById('toastWrap') || $('.toast-wrap');
    if (!wrap) return;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n || n.nodeType !== 1 || !n.classList || !n.classList.contains('toast')) continue;
          if (n.__m150) continue;
          n.__m150 = true;
          /* 文案是 append 前写好的，直接读；再兜一帧防止别人二次改写 */
          handleToast(n);
          window.setTimeout(function (node) {
            return function () { if (node.isConnected && !node.__m150b) { node.__m150b = true; handleToast(node); } };
          }(n), 60);
        }
      }
    });
    mo.observe(wrap, { childList: true });
  }

  /* 游戏首次启动成功：主进程的 game:launchState 在闭包里拿不到，
     改看启动按钮的 .running 类（running 只在真正启动成功后挂上） */
  var launched = false;
  function watchLaunch() {
    var btn = doc.getElementById('launchBtn');
    if (!btn) return;
    var mo = new MutationObserver(function () {
      if (launched) return;
      if (!btn.classList.contains('running')) return;
      launched = true;
      var p = anchorPoint(btn);
      confetti({ x: p.x, y: p.y, count: 96 });
      success(btn, '游戏已启动');
    });
    mo.observe(btn, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------------------------- 开关联动 ---------------------------- */

  function applyMotion(on) {
    if (on && !reduced()) {
      bindDelegate();
    } else {
      unbindDelegate();
      clearParts();
      if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; lastT = 0; }
      killLayer();
    }
  }

  function watchMotion() {
    var mo = new MutationObserver(function () {
      applyMotion(motionOn());
    });
    mo.observe(root, { attributes: true, attributeFilter: ['data-motion'] });
  }

  /* ------------------------------ 启动 ------------------------------ */

  function boot() {
    ensureStyle();
    window.M150 = {
      confetti: confetti,
      success: success,
      tap: tap,
      get particles() { return parts.length; }
    };
    applyMotion(motionOn());
    watchMotion();
    watchToasts();
    watchLaunch();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
