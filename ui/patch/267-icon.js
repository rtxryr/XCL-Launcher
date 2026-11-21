/* ------------------------------------------------------------------
 * patch/267-icon.js — 外观设置：启动器图标配色
 *
 * 需求：
 *   1) 图标可以跟随主题，也可以单独指定颜色（不跟着主题变）；
 *   2) 自定义时直接挑颜色，主题里那几个经典色都列出来；
 *   3) 图案保持 XCL 原来那枚等轴方块，不换样式，只换颜色。
 *
 * 做法：
 *   · 全局只认一个变量 --xcl-ic（图标色），默认 var(--accent)，
 *     主题切换时 --accent 变了，图标自动跟着变，不用监听主题事件。
 *   · 自定义配色时在 documentElement 上写内联值（优先级高于 :root 规则），
 *     切回「跟随主题」时把三个变量摘掉，立刻回落到主题色。
 *   · 标题栏那枚原来是 24×24 的 PNG（旧橙色徽章），位图没法着色，
 *     这里换成同尺寸的 span + 同一枚矢量方块，四处的图标从此是同一个形状。
 *   · 侧栏 / 关于页 / 右下角工具栏 / 引导页的品牌标由 50 / 200 号补丁写入，
 *     它们可能比本补丁晚一点点执行，所以除了立即刷一遍，还留了一个
 *     轻量轮询兜底（只在图形对不上时才写 DOM，不会反复触发回流）。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  var LS_MODE = 'mc.icon.mode';
  var LS_COLOR = 'mc.icon.color';
  var LS_SHAPE = 'mc.icon.shape';   /* 1.1.7 早期测试版留下的键，读到时顺手清掉 */
  var DEF_COLOR = '#0f9fcd';

  function $(s, r) { return (r || doc).querySelector(s); }
  function ls(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function getMode() { return ls(LS_MODE, 'theme') === 'custom' ? 'custom' : 'theme'; }
  function getColor() {
    var v = ls(LS_COLOR, DEF_COLOR);
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : DEF_COLOR;
  }

  /* ---------------- 图形：XCL 经典方块（等轴立方体 + 三条棱） ----------------
     和侧栏、关于页、工具栏一直在用的那枚完全一致，只是颜色跟着变量走。 */
  var ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M12 2.9 20.3 7.7v8.6L12 21.1 3.7 16.3V7.7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M12 12 3.7 7.7M12 12l8.3-4.3M12 12v9.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".85"/>' +
    '</svg>';

  /* ---------------- 颜色 ---------------- */
  function rgba(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) n = 0x0f9fcd;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function applyColor() {
    var root = doc.documentElement;
    if (getMode() === 'custom') {
      var c = getColor();
      root.style.setProperty('--xcl-ic', c);
      root.style.setProperty('--xcl-ic-soft', rgba(c, .16));
      root.style.setProperty('--xcl-ic-line', rgba(c, .34));
      root.setAttribute('data-ic', 'custom');
    } else {
      root.style.removeProperty('--xcl-ic');
      root.style.removeProperty('--xcl-ic-soft');
      root.style.removeProperty('--xcl-ic-line');
      root.setAttribute('data-ic', 'theme');
    }
  }

  /* ---------------- 把图形铺到各个位置 ----------------
     容器里可能只有一枚 svg（.logo / .ab-logo / .m200-brand），
     也可能 svg 后面还跟着文字（引导页的 .p50-brand），所以只换 svg 本身。 */
  function paintInto(el) {
    if (!el) return;
    if (el.getAttribute('data-m267') === 'classic' && el.querySelector('svg')) return;
    var old = el.querySelector('svg');
    if (old) old.outerHTML = ICON_SVG;
    else el.innerHTML = ICON_SVG;
    el.setAttribute('data-m267', 'classic');
  }

  /* 标题栏那枚是 <img> + base64 PNG（旧橙色徽章），换成同尺寸 span */
  function swapWbar() {
    var el = doc.getElementById('wbarLogo');
    if (!el || el.tagName === 'SPAN') return;
    var span = doc.createElement('span');
    span.id = 'wbarLogo';
    span.className = el.className;
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', 'X Craft Launcher');
    if (el.parentNode) el.parentNode.replaceChild(span, el);
    else return;
    paintInto(span);
  }

  function paintAll() {
    swapWbar();
    paintInto($('#rail .logo'));
    paintInto($('.ab-logo'));
    paintInto($('#m200Dock .m200-brand'));
    paintInto($('#p50Card .p50-brand'));
    /* 引导页 / 其他位置如果也放了 logo 容器，一并带上 */
    var extra = doc.querySelectorAll('.onb-logo,.ob-logo');
    for (var i = 0; i < extra.length; i++) paintInto(extra[i]);
  }

  /* ---------------- 样式 ---------------- */
  var COLORS = [
    { hex: '#2fbf62', name: '经典绿' },
    { hex: '#2b82d6', name: '蔚蓝' },
    { hex: '#0f9fcd', name: '浅蓝' },
    { hex: '#c9d4e0', name: '雪白' },
    { hex: '#3d444b', name: '石墨' },
    { hex: '#e88a1f', name: '经典橙' },
    { hex: '#8a63d2', name: '薰衣草' }
  ];

  var THEME_NAME = {
    green: '经典绿', azure: '蔚蓝', sky: '浅蓝', white: '雪白',
    dark: '暗黑', amber: '琥珀', lavender: '薰衣草', custom: '自定义'
  };

  function injectCss() {
    if (doc.getElementById('patch-267-style')) return;
    var css = [
      /* 默认跟随主题；自定义时由内联 style 覆盖这三个值 */
      'html{--xcl-ic:var(--accent);--xcl-ic-soft:var(--accent-soft);--xcl-ic-line:var(--accent-line)}',
      '.rail .logo svg,.ab-logo svg,#p50Card .p50-brand svg{color:var(--xcl-ic)}',
      '#m200Dock .m200-brand{color:var(--xcl-ic);border-color:var(--xcl-ic-line);',
      '  background:linear-gradient(150deg,var(--xcl-ic-soft),transparent)}',
      /* 标题栏图标：原来靠橙色辉光提亮，现在颜色自己带，辉光换成中性投影 */
      '#wbarLogo{display:inline-grid;place-items:center;color:var(--xcl-ic);',
      '  filter:drop-shadow(0 1px 3px rgba(0,0,0,.55))}',
      '#wbarLogo svg{width:24px;height:24px;display:block}',

      /* ---- 设置卡 ---- */
      '#m267Card .m267-prev{display:flex;align-items:center;gap:14px;padding:4px 16px 14px}',
      '#m267Card .m267-box{width:58px;height:58px;border-radius:19px;flex:0 0 auto;display:grid;place-items:center;',
      '  background:linear-gradient(155deg,#1b232c,#0a0e12);border:1px solid rgba(255,255,255,.1);',
      '  box-shadow:0 8px 20px -10px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.09)}',
      '#m267Card .m267-box svg{width:30px;height:30px;color:var(--xcl-ic);',
      '  transition:color calc(.3s * var(--anim-k)) ease}',
      '#m267Card .m267-main{min-width:0}',
      '#m267Card .m267-main b{display:block;font-size:13px;font-weight:580;margin-bottom:3px}',
      '#m267Card .m267-main span{font-size:11.5px;color:var(--txt-3);line-height:1.55}',
      '#m267Card .m267-label{font-size:11.5px;color:var(--txt-3);padding:0 16px 8px;display:flex;align-items:center;gap:7px}',
      '#m267Card .m267-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.18)}',

      '#m267Card .m267-colors{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:2px 16px 14px}',
      '#m267Card .m267-sw{width:30px;height:30px;border-radius:11px;padding:0;cursor:pointer;position:relative;',
      '  border:1px solid rgba(0,0,0,.2);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);',
      '  transition:transform calc(.18s * var(--anim-k)) var(--ease),outline-color .18s ease}',
      '#m267Card .m267-sw:hover{transform:translateY(-1px) scale(1.04)}',
      '#m267Card .m267-sw.on{outline:2px solid var(--txt);outline-offset:3px}',
      '#m267Card .m267-sw.on::after{content:"";position:absolute;inset:0;border-radius:10px;',
      '  background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'15\' height=\'15\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'3.4\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'M4 12.5l5.5 5.5L20 6.5\'/%3E%3C/svg%3E") center/15px no-repeat;',
      '  filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}',
      '#m267Card .m267-pick{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px 0 6px;',
      '  border-radius:11px;border:1px dashed var(--stroke-2);background:var(--panel);color:var(--txt-2);',
      '  font-size:11.5px;cursor:pointer}',
      '#m267Card .m267-pick:hover{background:var(--panel-2);color:var(--txt)}',
      '#m267Card .m267-pick input{-webkit-appearance:none;appearance:none;width:20px;height:20px;padding:0;',
      '  border:none;background:none;cursor:pointer}',
      '#m267Card .m267-pick input::-webkit-color-swatch-wrapper{padding:0}',
      '#m267Card .m267-pick input::-webkit-color-swatch{border:1px solid rgba(255,255,255,.28);border-radius:7px}',

      '#m267Card[data-mode="theme"] .m267-colors{display:none}',
      /* 跟随主题时色板收起来了，单独给说明行留出下边距 */
      '#m267Card[data-mode="theme"] #m267ColorLabel{padding-bottom:14px}',
      /* 自定义模式下色板是最后一行，卡片底部自己留白 */
      '#m267Card .m267-colors{padding-bottom:16px}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-267-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  function toast(msg) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
  }

  /* ---------------- 设置卡 ---------------- */
  function buildCard(tab) {
    if (!tab || doc.getElementById('m267Card')) return;
    var card = doc.createElement('div');
    card.className = 'glass list-card';
    card.id = 'm267Card';
    card.style.marginBottom = '16px';
    card.innerHTML =
      '<div class="group-title">图标</div>' +
      '<div class="m267-prev">' +
        '<span class="m267-box" id="m267Box"></span>' +
        '<div class="m267-main"><b>启动器图标</b>' +
          '<span>图案还是原来那枚方块，这里只调颜色。标题栏、侧栏与关于页共用一枚，默认跟着「配色方案」走，也可以单独指定。</span></div>' +
      '</div>' +
      '<div class="opt-row">' +
        '<div class="opt-ico">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6Z"/>' +
          '<path d="M12 11.8v9M4.4 7.6 12 12l7.6-4.4"/>' +
          '<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>' +
        '</div>' +
        '<div class="opt-main"><b>配色</b><span>跟随主题时随配色方案一起变，自定义后固定为你选的颜色</span></div>' +
        '<div class="seg" id="m267Mode">' +
          '<button type="button" data-mode="theme">跟随主题</button>' +
          '<button type="button" data-mode="custom">自定义</button>' +
        '</div>' +
      '</div>' +
      '<div class="m267-label" id="m267ColorLabel">挑一个颜色</div>' +
      '<div class="m267-colors" id="m267Colors"></div>';

    /* 放在「配色方案」之后：先选主题，再决定图标要不要脱离主题 */
    var titles = tab.querySelectorAll('.group-title');
    var anchor = null;
    for (var i = 0; i < titles.length; i++) {
      if (/配色方案/.test(titles[i].textContent || '')) { anchor = titles[i].closest('.list-card'); break; }
    }
    if (anchor && anchor.parentNode === tab) anchor.parentNode.insertBefore(card, anchor.nextSibling);
    else tab.appendChild(card);

    var box = doc.getElementById('m267Box');
    var modeSeg = doc.getElementById('m267Mode');
    var colorsWrap = doc.getElementById('m267Colors');
    var colorLabel = doc.getElementById('m267ColorLabel');

    /* 色板 */
    var html = '';
    for (var c = 0; c < COLORS.length; c++) {
      html += '<button type="button" class="m267-sw" data-hex="' + COLORS[c].hex + '" ' +
        'title="' + COLORS[c].name + '" aria-label="' + COLORS[c].name + '" ' +
        'style="background:' + COLORS[c].hex + '"></button>';
    }
    html += '<label class="m267-pick" title="更多颜色">' +
      '<input type="color" id="m267Color" value="' + getColor() + '" aria-label="自定义颜色">' +
      '<span>更多</span></label>';
    colorsWrap.innerHTML = html;

    function paint() {
      var mode = getMode();
      card.setAttribute('data-mode', mode);
      /* 模式 */
      var mb = modeSeg.querySelectorAll('button');
      for (var m = 0; m < mb.length; m++) {
        mb[m].classList.toggle('on', mb[m].getAttribute('data-mode') === mode);
      }
      /* 色板 */
      var cur = getColor().toLowerCase();
      var sw = colorsWrap.querySelectorAll('.m267-sw');
      for (var w = 0; w < sw.length; w++) {
        sw[w].classList.toggle('on', sw[w].getAttribute('data-hex').toLowerCase() === cur);
      }
      var pick = doc.getElementById('m267Color');
      if (pick) pick.value = getColor();
      /* 跟随主题时把「是谁的主题色」写出来，不然只剩孤零零一行字 */
      if (colorLabel) {
        if (mode === 'theme') {
          var acc = '';
          try { acc = getComputedStyle(doc.documentElement).getPropertyValue('--accent').trim(); } catch (e) {}
          var tn = THEME_NAME[doc.documentElement.getAttribute('data-theme') || ''] || '主题强调色';
          colorLabel.innerHTML = '<span class="m267-dot" style="background:' + (acc || 'currentColor') + '"></span>' +
            '正在跟随主题：' + tn;
        } else {
          colorLabel.textContent = '挑一个颜色 · ' + getColor().toUpperCase();
        }
      }
      /* 预览 */
      if (box) paintInto(box);
    }

    modeSeg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]');
      if (!b) return;
      var mode = b.getAttribute('data-mode');
      lsSet(LS_MODE, mode);
      applyColor();
      paint();
      toast(mode === 'custom' ? '图标改为自定义配色' : '图标已跟随主题');
    });

    colorsWrap.addEventListener('click', function (e) {
      var b = e.target.closest('.m267-sw');
      if (!b) return;
      lsSet(LS_MODE, 'custom');
      lsSet(LS_COLOR, b.getAttribute('data-hex'));
      applyColor();
      paint();
      toast('图标颜色：' + b.getAttribute('title'));
    });

    colorsWrap.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'm267Color') return;
      lsSet(LS_MODE, 'custom');
      lsSet(LS_COLOR, e.target.value);
      applyColor();
      paint();
    });

    /* 跟随主题时，换主题要把「正在跟随：xx」和圆点颜色一起刷新 */
    try {
      var mo = new MutationObserver(function () {
        if (getMode() === 'theme') paint();
      });
      mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) {}

    paint();
  }

  function boot() {
    /* 颜色先落地：不进设置页也要生效 */
    applyColor();
    paintAll();
    /* 清掉早期测试版留下的图形键，避免以后读到脏数据 */
    try { localStorage.removeItem(LS_SHAPE); } catch (e) {}

    var tab = doc.getElementById('tab-appearance');
    if (!tab || !$('#page-settings')) return;
    injectCss();
    if (!doc.getElementById('m267Card')) buildCard(tab);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 400);
  setTimeout(boot, 1200);

  /* 兜底：工具栏（200 号）建得晚、主题（205/210）可能重画 logo 容器 */
  var ticks = 0;
  var timer = setInterval(function () {
    ticks++;
    try { paintAll(); } catch (e) {}
    if (ticks > 40) clearInterval(timer);   /* 约 30 秒后收工 */
  }, 750);
})();
