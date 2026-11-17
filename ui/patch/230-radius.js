/* ------------------------------------------------------------------
 * patch/230-radius.js — 外观设置：卡片圆角自定义
 *
 * 做法：全局圆角本来就全走 CSS 变量（--r-s / --r-m / --r-l / --r-xl / --r-2xl），
 *       这里只按一个基准值等比换算后写到 documentElement，所有卡片/按钮/输入框
 *       自动跟随，不逐条改样式，也不会漏掉某个组件。
 *
 * 基准值对应 --r-l（卡片主圆角），默认 22px = 现在的观感。
 * 胶囊类（--r-pill:999px）不参与换算，否则开关、标签会变成方块。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  var LS = 'mc.radius';
  var DEFAULT = 22;
  var MIN = 0;
  var MAX = 40;

  function $(s, r) { return (r || doc).querySelector(s); }
  function get() {
    try {
      var v = parseInt(localStorage.getItem(LS) || '', 10);
      if (isNaN(v)) return DEFAULT;
      return Math.max(MIN, Math.min(MAX, v));
    } catch (e) { return DEFAULT; }
  }
  function set(v) { try { localStorage.setItem(LS, String(v)); } catch (e) {} }

  /* 基准 → 全套比例（保持现有 12/16/22/28/34 的层级关系） */
  function apply(v) {
    var base = Math.max(MIN, Math.min(MAX, Number(v) || 0));
    var root = doc.documentElement;
    var px = function (n) { return Math.round(n) + 'px'; };
    root.style.setProperty('--r-l', px(base));
    root.style.setProperty('--r-m', px(base * 0.73));
    root.style.setProperty('--r-s', px(base * 0.55));
    root.style.setProperty('--r-xl', px(base * 1.27));
    root.style.setProperty('--r-2xl', px(base * 1.55));
    /* 比卡片小一档的组件（标签按钮、输入框内部、列表行）统一用这个 */
    root.style.setProperty('--r-follow', px(base * 0.73));
    /* 圆角为 0 时给个极小的值，避免阴影与描边出现锯齿断层 */
    if (base === 0) {
      root.style.setProperty('--r-l', '2px');
      root.style.setProperty('--r-m', '2px');
      root.style.setProperty('--r-s', '2px');
      root.style.setProperty('--r-xl', '2px');
      root.style.setProperty('--r-2xl', '2px');
    }
    root.setAttribute('data-radius', base === 0 ? 'sharp' : (base <= 12 ? 'small' : (base >= 32 ? 'large' : 'std')));
  }

  function toast(msg) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
  }

  function injectCss() {
    if (doc.getElementById('patch-230-style')) return;
    var css = [
      '.m230-row{display:flex;align-items:center;gap:14px;padding:0 16px 14px}',
      '.m230-slider{flex:1;min-width:120px;-webkit-appearance:none;appearance:none;height:6px;border-radius:999px;',
      '  background:var(--panel-3,rgba(255,255,255,.1));outline:none}',
      '.m230-slider::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;',
      '  background:var(--accent);border:2px solid var(--panel-2);box-shadow:0 2px 8px -2px var(--shadow-2);cursor:pointer}',
      '.m230-val{min-width:52px;text-align:right;font-size:12px;color:var(--txt-2);font-variant-numeric:tabular-nums}',
      '.m230-presets{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 14px}',
      '.m230-presets button{border-radius:999px;padding:6px 14px;font-size:11.5px;cursor:pointer;',
      '  border:1px solid var(--stroke);background:var(--panel-2);color:var(--txt)}',
      '.m230-presets button.on{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}',

      /* ---------------- 覆盖面补齐 ----------------
         下面这些组件原本写死 px 圆角或用 --r-pill，滑杆对它们无效。
         统一改绑到圆角变量，让「界面圆角」真的影响全局形状。
         注意：开关 / 圆点 / 进度条 / 徽章这些本来就是胶囊，保持 --r-pill 不动。 */
      /* 设置页顶部分类标签（含以后动态加的性能、账号等标签） */
      'html[data-radius] .seg{border-radius:var(--r-m)}',
      /* 设置页标签容器被 `#page-settings #setSeg` 两条 ID 写死成 999px，
         必须用同等「双 ID + 属性」的优先级才盖得住 */
      'html[data-radius] #page-settings #setSeg{border-radius:var(--r-m)}',
      'html[data-radius] .seg button{border-radius:calc(var(--r-follow) * .82)}',
      /* 输入框（连接页、联机房间号、资源搜索等） */
      'html[data-radius] .inp{border-radius:var(--r-m)}',
      'html[data-radius] .inp-sm,html[data-radius] input.inp-sm{border-radius:calc(var(--r-follow) * .82)}',
      /* 版本卡片上的操作按钮（开房、加入、下载等共用 .ver-btn） */
      'html[data-radius] .ver-btn{border-radius:var(--r-m)}',
      'html[data-radius] .fmp-btn{border-radius:var(--r-m)}',
      /* 联机页模式选择（红石联机 / 淘网联机）本身就是 .seg，已在上面覆盖；
         这里补它在房间面板里的分组按钮 */
      'html[data-radius] #page-online .seg{border-radius:var(--r-m)}',
      /* 通知：列表卡片 + 全屏卡 + 顶部横幅 */
      'html[data-radius] .nt-card{border-radius:var(--r-l)}',
      'html[data-radius] .nt-fs-card{border-radius:var(--r-2xl)}',
      'html[data-radius] .nt-bn{border-radius:var(--r-l)}',
      /* 反馈页两张卡片 */
      'html[data-radius] #page-feedback .fbp-card{border-radius:var(--r-l)}',
      /* 左下角头像：从「永远圆形」改成跟随圆角（0 时近方形，40 时接近圆） */
      'html[data-radius] .avatar{border-radius:var(--r-2xl)}',
      'html[data-radius] .rail .avatar-wrap::after{border-radius:999px}',
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-230-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  function buildCard(tab) {
    if (!tab || doc.getElementById('m230Card')) return;
    var card = doc.createElement('div');
    card.className = 'glass list-card';
    card.id = 'm230Card';
    card.style.marginBottom = '16px';
    card.innerHTML =
      '<div class="group-title">界面圆角</div>' +
      '<div class="opt-row">' +
        '<div class="opt-ico">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M4 20V9a5 5 0 0 1 5-5h11"/><path d="M4 20h6"/><path d="M20 20v-6"/></svg>' +
        '</div>' +
        '<div class="opt-main"><b>卡片圆角</b>' +
          '<span>整站卡片、按钮、输入框统一跟随；0 为直角，40 为最圆</span></div>' +
        '<span class="m230-val" id="m230Val">22px</span>' +
      '</div>' +
      '<div class="m230-row">' +
        '<input class="m230-slider" id="m230Range" type="range" min="0" max="40" step="1" value="22" aria-label="卡片圆角">' +
      '</div>' +
      '<div class="m230-presets" id="m230Presets">' +
        '<button type="button" data-r="0">直角</button>' +
        '<button type="button" data-r="10">小圆角</button>' +
        '<button type="button" data-r="22">标准</button>' +
        '<button type="button" data-r="32">大圆角</button>' +
        '<button type="button" data-r="40">超圆</button>' +
      '</div>';
    /* 放在「配色方案」之前，外观项排在一起 */
    var titles = tab.querySelectorAll('.group-title');
    var anchor = null;
    for (var i = 0; i < titles.length; i++) {
      if (/配色方案|自定义配色/.test(titles[i].textContent || '')) { anchor = titles[i].closest('.list-card'); break; }
    }
    if (anchor && anchor.parentNode === tab) tab.insertBefore(card, anchor);
    else tab.appendChild(card);

    var range = doc.getElementById('m230Range');
    var val = doc.getElementById('m230Val');
    var presets = doc.getElementById('m230Presets');

    function paint(v) {
      if (range) range.value = String(v);
      if (val) val.textContent = v === 0 ? '直角' : v + 'px';
      var btns = presets ? presets.querySelectorAll('button') : [];
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('on', Number(btns[j].getAttribute('data-r')) === v);
      }
    }

    var cur = get();
    apply(cur);
    paint(cur);

    if (range) {
      range.addEventListener('input', function () {
        var v = parseInt(range.value, 10) || 0;
        apply(v);
        paint(v);
        set(v);
      });
      range.addEventListener('change', function () {
        toast('圆角已设为 ' + (get() === 0 ? '直角' : get() + 'px'));
      });
    }
    if (presets) {
      presets.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-r]');
        if (!b) return;
        var v = Number(b.getAttribute('data-r'));
        apply(v);
        paint(v);
        set(v);
        toast('圆角已设为 ' + (v === 0 ? '直角' : v + 'px'));
      });
    }
  }

  function boot() {
    /* 先应用已保存的值：即使用户没进设置页，圆角也要生效 */
    apply(get());
    var tab = doc.getElementById('tab-appearance');
    if (!tab || !$('#page-settings')) return;
    injectCss();
    if (!window.__xclPatch230) {
      window.__xclPatch230 = true;
      buildCard(tab);
    } else if (!doc.getElementById('m230Card')) {
      buildCard(tab);
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 500);
  setTimeout(boot, 1500);
})();
