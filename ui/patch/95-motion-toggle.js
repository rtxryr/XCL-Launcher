/* ------------------------------------------------------------------
 * patch/95-motion-toggle.js — 界面动效总开关 + 响应速度 / 响应幅度
 * 作用域：只在 #tab-appearance 顶部插入一张「界面动效」卡；
 *         写 html[data-motion] 与 localStorage['mc.motion']，其余 100+ 号补丁读这个值。
 * 约定：'on' = 全开（默认）；'off' = 全关（CSS 兜底禁用动画，功能不受影响）
 * 调速：--m-speed（0.5~2.0，越大动效越快完成，时长除以该值）
 *       --m-amp  （0.5~2.0，位移/角度/光斑大小乘以该值）
 *       其余补丁每次使用时现读这两个变量，95 号只负责写。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  var LS = 'mc.motion';
  var LS_SPEED = 'mc.motionSpeed';
  var LS_AMP = 'mc.motionAmp';

  function $(s, r) { return (r || doc).querySelector(s); }

  function read() {
    var v = null;
    try { v = localStorage.getItem(LS); } catch (e) {}
    if (v === 'off' || v === 'on') return v;
    /* 没设过：跟系统「减少动态效果」走 */
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return 'off';
      }
    } catch (e) {}
    return 'on';
  }

  /* 读滑杆值：范围 0.5~2.0，缺省 / 非法一律回到 1 */
  function readNum(key) {
    var v = null;
    try { v = localStorage.getItem(key); } catch (e) {}
    var n = parseFloat(v);
    if (isNaN(n)) n = 1;
    if (n < 0.5) n = 0.5;
    if (n > 2) n = 2;
    return n;
  }

  function write(v) {
    try { localStorage.setItem(LS, v); } catch (e) {}
    doc.documentElement.setAttribute('data-motion', v);
  }

  /* 尽早写入，避免首帧闪一下全动画 */
  if (!doc.documentElement.getAttribute('data-motion')) {
    doc.documentElement.setAttribute('data-motion', read());
  }
  /* 尽早写 CSS 变量，其它补丁任何时刻读都有值 */
  (function initVars() {
    var r = doc.documentElement;
    r.style.setProperty('--m-speed', readNum(LS_SPEED));
    r.style.setProperty('--m-amp', readNum(LS_AMP));
  })();

  function mount() {
    if (window.__xclPatch95) return;
    var host = $('#tab-appearance');
    if (!host) return;
    if ($('#motionCard')) { window.__xclPatch95 = true; return; }

    /* ---------- 样式 ---------- */
    var st = doc.createElement('style');
    st.id = 'patch-95-style';
    st.textContent = [
      '#motionCard{margin-bottom:14px}',
      '#motionCard .m95-row{display:flex;align-items:center;gap:16px;padding:16px 18px}',
      '#motionCard .m95-main{min-width:0;flex:1}',
      '#motionCard .m95-t{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:650;color:var(--txt);line-height:1.3}',
      '#motionCard .m95-t svg{width:16px;height:16px;flex-shrink:0;color:var(--accent)}',
      '#motionCard .m95-d{display:block;margin-top:4px;font-size:12px;line-height:1.55;color:var(--txt-2)}',
      /* 开关：全圆角胶囊 */
      '#motionCard .m95-sw{position:relative;flex-shrink:0;width:46px;height:26px;padding:0;border:1px solid var(--stroke-2);' +
      'border-radius:999px;background:var(--panel);cursor:pointer;transition:background .22s ease,border-color .22s ease;outline:none}',
      '#motionCard .m95-sw:focus-visible{box-shadow:0 0 0 3px var(--accent-soft);border-color:var(--accent-line)}',
      '#motionCard .m95-sw i{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:999px;background:var(--txt-3);' +
      'transition:transform .26s cubic-bezier(.2,1.4,.4,1),background .22s ease;display:block}',
      '#motionCard .m95-sw[aria-checked="true"]{background:var(--accent-soft);border-color:var(--accent-line)}',
      '#motionCard .m95-sw[aria-checked="true"] i{transform:translateX(20px);background:var(--accent)}',
      '#motionCard .m95-state{flex-shrink:0;font-size:12px;font-variant-numeric:tabular-nums;color:var(--txt-3);min-width:34px;text-align:right}',
      /* 滑杆行：全圆角 */
      '#motionCard .m95-sliders{display:flex;flex-direction:column;gap:12px;padding:4px 18px 16px}',
      '#motionCard .m95-srow{display:flex;align-items:center;gap:12px}',
      '#motionCard .m95-slabel{flex-shrink:0;font-size:12.5px;color:var(--txt-2);min-width:58px}',
      '#motionCard .m95-sval{flex-shrink:0;font-size:12px;font-variant-numeric:tabular-nums;color:var(--txt-3);min-width:36px;text-align:right}',
      /* 滑杆本体：轨道与拇指全圆角 */
      '#motionCard .m95-range{flex:1;min-width:0;height:18px;margin:0;-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer;outline:none}',
      '#motionCard .m95-range::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:var(--stroke-2)}',
      '#motionCard .m95-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-5px;border-radius:999px;background:var(--accent);border:none;box-shadow:0 1px 4px rgba(0,0,0,.2)}',
      '#motionCard .m95-range::-moz-range-track{height:6px;border-radius:999px;background:var(--stroke-2)}',
      '#motionCard .m95-range::-moz-range-thumb{width:16px;height:16px;border-radius:999px;background:var(--accent);border:none;box-shadow:0 1px 4px rgba(0,0,0,.2)}',
      '#motionCard .m95-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px var(--accent-soft)}',
      '#motionCard .m95-range:focus-visible::-moz-range-thumb{box-shadow:0 0 0 3px var(--accent-soft)}',
      '#motionCard .m95-range:disabled{opacity:.4;cursor:default}',
      '@media (prefers-reduced-motion: reduce){#motionCard .m95-sw i{transition:none}}'
    ].join('\n');
    if (!doc.getElementById('patch-95-style')) doc.head.appendChild(st);

    /* ---------- 卡片 ---------- */
    var cur = read();
    var curSpeed = readNum(LS_SPEED);
    var curAmp = readNum(LS_AMP);
    var card = doc.createElement('div');
    card.className = 'glass list-card';
    card.id = 'motionCard';
    card.innerHTML =
      '<div class="m95-row">' +
        '<span class="m95-main">' +
          '<span class="m95-t">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M13.2 3.2 5.6 13.1h5l-1 7.7 7.8-10.1h-5.1l.9-7.5Z"/>' +
            '</svg>' +
            '界面动效' +
          '</span>' +
          '<span class="m95-d">按钮磁吸、卡片光斑、页面入场、彩带等效果的开关。关掉后立刻恢复成最朴素的样子，电脑吃力时可以关。</span>' +
        '</span>' +
        '<span class="m95-state" id="m95State"></span>' +
        '<button type="button" class="m95-sw" id="m95Switch" role="switch" aria-checked="' + (cur === 'on') + '" aria-label="界面动效开关"><i></i></button>' +
      '</div>' +
      '<div class="m95-sliders">' +
        '<div class="m95-srow">' +
          '<span class="m95-slabel">响应速度</span>' +
          '<input type="range" class="m95-range" id="m95Speed" min="0.5" max="2" step="0.1" value="' + curSpeed + '" aria-label="动效响应速度">' +
          '<span class="m95-sval" id="m95SpeedVal">' + curSpeed.toFixed(1) + '×</span>' +
        '</div>' +
        '<div class="m95-srow">' +
          '<span class="m95-slabel">响应幅度</span>' +
          '<input type="range" class="m95-range" id="m95Amp" min="0.5" max="2" step="0.1" value="' + curAmp + '" aria-label="动效响应幅度">' +
          '<span class="m95-sval" id="m95AmpVal">' + curAmp.toFixed(1) + '×</span>' +
        '</div>' +
      '</div>';

    host.insertBefore(card, host.firstChild);

    var btn = $('#m95Switch', card);
    var lab = $('#m95State', card);
    function paint(v) {
      btn.setAttribute('aria-checked', v === 'on' ? 'true' : 'false');
      lab.textContent = v === 'on' ? '已开' : '已关';
      /* 开关为 off 时滑杆禁用 */
      var off = v !== 'on';
      var sp = $('#m95Speed', card);
      var am = $('#m95Amp', card);
      if (sp) sp.disabled = off;
      if (am) am.disabled = off;
    }
    paint(cur);

    /* 滑杆：input 事件里直接更新 CSS 变量 + localStorage，其它补丁现读现生效 */
    function bindSlider(inputId, valId, cssVar, lsKey) {
      var inp = $('#' + inputId, card);
      var val = $('#' + valId, card);
      if (!inp || !val) return;
      inp.addEventListener('input', function () {
        var n = parseFloat(inp.value);
        if (isNaN(n)) n = 1;
        if (n < 0.5) n = 0.5;
        if (n > 2) n = 2;
        doc.documentElement.style.setProperty(cssVar, n);
        val.textContent = n.toFixed(1) + '×';
        try { localStorage.setItem(lsKey, String(n)); } catch (e) {}
      });
    }
    bindSlider('m95Speed', 'm95SpeedVal', '--m-speed', LS_SPEED);
    bindSlider('m95Amp', 'm95AmpVal', '--m-amp', LS_AMP);

    btn.addEventListener('click', function () {
      var next = (doc.documentElement.getAttribute('data-motion') === 'off') ? 'on' : 'off';
      write(next);
      paint(next);
      /* 立刻通知其它补丁：它们都挂了 html[data-motion] 的观察器或 CSS 兜底 */
      try {
        window.dispatchEvent(new CustomEvent('xcl:motion', { detail: { value: next } }));
      } catch (e) {}
    });

    window.__xclPatch95 = true;
    console.log('[patch 95] ready · motion =', doc.documentElement.getAttribute('data-motion'));
  }

  /* 设置页可能后渲染，等 DOM 就绪 + 兜底重试 */
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
  /* 100+ 号补丁可能在任意时刻插入，这里只负责挂自己那张卡；
     若 #tab-appearance 当时不存在，用一次性观察器补挂 */
  if (!window.__xclPatch95) {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      mount();
      if (window.__xclPatch95 || tries > 40) clearInterval(t);
    }, 250);
  }
})();
