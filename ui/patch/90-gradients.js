/* ------------------------------------------------------------------
 * patch/90-gradients.js — 6 个渐变配色主题（极光 / 深海 / 电紫 / 落日 / 樱粉 / 薄荷）
 * 作用域：只往「设置 → 外观 → 配色方案」里加 6 个色卡、加 6 组
 *         html[data-theme="grad-*"] 变量，并把渐变用到主按钮 / 分段控件 /
 *         色卡描边 / 进度条 / 侧栏激活项 / 卡片顶部高光上。
 *         其余 7 个纯色主题零影响 —— 所有新规则的上下文前缀都是
 *         html[data-theme^="grad-"]，老主题匹配不到。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }

  /* 顺序：深-浅交替，跟原有 7 个主题的深浅排布混在一起也不打架 */
  var GRADS = [
    { id: 'grad-aurora', name: '极光', sub: '青紫 · 深色', a: '#35e0c0', b: '#7d6cf0', mid: '#59a6d8', dark: true },
    { id: 'grad-sunset', name: '落日', sub: '橙粉 · 浅色', a: '#ff9d5c', b: '#ff6f9c', mid: '#ff867c', dark: false },
    { id: 'grad-ocean',  name: '深海', sub: '蓝青 · 深色', a: '#2f8bff', b: '#25d3c2', mid: '#2aafe0', dark: true },
    { id: 'grad-sakura', name: '樱粉', sub: '粉紫 · 浅色', a: '#ffb3d1', b: '#b596f0', mid: '#daa4e0', dark: false },
    { id: 'grad-plasma', name: '电紫', sub: '紫粉 · 深色', a: '#a259ff', b: '#ff6bb5', mid: '#d062da', dark: true },
    { id: 'grad-mint',   name: '薄荷', sub: '青绿 · 浅色', a: '#63e0b4', b: '#37c2e0', mid: '#4dd1ca', dark: false }
  ];
  var NAMES = {};
  GRADS.forEach(function (g) { NAMES[g.id] = g.name; });

  var CSS = `
/* ==================================================================
 * 90-gradients — 6 组渐变主题变量
 * 深色基底 = green，浅色基底 = sky，逐项按 A→B 色相重算
 * ================================================================== */

/* ---------- 渐变主题：极光（青 #35e0c0 → 紫 #7d6cf0，深色） ---------- */
html[data-theme="grad-aurora"]{
  --bg0:#070a10;
  --bg:radial-gradient(1200px 800px at 78% 8%, #0f3a44 0%, transparent 60%),
       radial-gradient(900px 700px at 8% 92%, #1b1742 0%, transparent 62%),
       linear-gradient(170deg,#0a0d16 0%,#06080c 100%);
  --orb1:#2fd8bc; --orb2:#6a5ad8; --orb3:#2b93b0;
  --o1:.34; --o2:.28; --o3:.2;
  --panel:rgba(226,255,250,.05); --panel-2:rgba(226,255,250,.08); --panel-3:rgba(226,255,250,.12);
  --stroke:rgba(180,240,232,.1); --stroke-2:rgba(180,240,232,.17);
  --glass-a:rgba(200,255,248,.08); --glass-b:rgba(190,230,255,.03);
  --rail-bg:rgba(220,255,250,.03); --top-bg:rgba(220,255,250,.016);
  --grid:rgba(214,255,246,.6); --grid-o:.055; --noise-o:.032;
  --txt:#e9f6f4; --txt-2:rgba(233,246,244,.63); --txt-3:rgba(233,246,244,.4);
  --accent:#5ce8cc; --accent-l:#8ff7e0; --accent-d:#22c3a4;
  --accent-soft:rgba(92,232,204,.13); --accent-line:rgba(125,108,240,.3);
  --accent-ink:#04191a;
  --shadow-1:rgba(0,0,0,.9); --shadow-2:rgba(0,0,0,.95);
  --tip-bg:rgba(14,22,26,.94); --sheen:rgba(255,255,255,.5);
  --danger:#ff6b7a; --warn:#ffc46b; --hover:rgba(214,255,246,.05);
  --grad-a:#35e0c0; --grad-b:#7d6cf0;
  --accent-grad:linear-gradient(135deg,#35e0c0 0%,#7d6cf0 100%);
  --accent-grad-soft:linear-gradient(135deg,rgba(53,224,192,.18) 0%,rgba(125,108,240,.18) 100%);
  --grad-hairline:linear-gradient(90deg,transparent 0%,rgba(53,224,192,.82) 38%,rgba(125,108,240,.82) 62%,transparent 100%);
}

/* ---------- 渐变主题：深海（蓝 #2f8bff → 青 #25d3c2，深色） ---------- */
html[data-theme="grad-ocean"]{
  --bg0:#05080e;
  --bg:radial-gradient(1200px 800px at 78% 8%, #0d2a4e 0%, transparent 60%),
       radial-gradient(900px 700px at 8% 92%, #08333a 0%, transparent 62%),
       linear-gradient(170deg,#08111c 0%,#05070c 100%);
  --orb1:#2f8bff; --orb2:#24c9c0; --orb3:#1f6fa8;
  --o1:.36; --o2:.3; --o3:.22;
  --panel:rgba(226,240,255,.05); --panel-2:rgba(226,240,255,.08); --panel-3:rgba(226,240,255,.12);
  --stroke:rgba(160,205,255,.1); --stroke-2:rgba(160,205,255,.17);
  --glass-a:rgba(206,232,255,.08); --glass-b:rgba(190,255,250,.028);
  --rail-bg:rgba(220,238,255,.03); --top-bg:rgba(220,238,255,.016);
  --grid:rgba(210,236,255,.6); --grid-o:.055; --noise-o:.032;
  --txt:#e8f2fb; --txt-2:rgba(232,242,251,.63); --txt-3:rgba(232,242,251,.4);
  --accent:#4fb4f7; --accent-l:#8fd8ff; --accent-d:#2276c9;
  --accent-soft:rgba(79,180,247,.13); --accent-line:rgba(37,211,194,.3);
  --accent-ink:#03141f;
  --shadow-1:rgba(0,0,0,.9); --shadow-2:rgba(0,0,0,.95);
  --tip-bg:rgba(12,20,30,.94); --sheen:rgba(255,255,255,.5);
  --danger:#ff6b7a; --warn:#ffc46b; --hover:rgba(210,236,255,.05);
  --grad-a:#2f8bff; --grad-b:#25d3c2;
  --accent-grad:linear-gradient(135deg,#2f8bff 0%,#25d3c2 100%);
  --accent-grad-soft:linear-gradient(135deg,rgba(47,139,255,.18) 0%,rgba(37,211,194,.18) 100%);
  --grad-hairline:linear-gradient(90deg,transparent 0%,rgba(47,139,255,.82) 38%,rgba(37,211,194,.82) 62%,transparent 100%);
}

/* ---------- 渐变主题：电紫（紫 #a259ff → 粉 #ff6bb5，深色） ---------- */
html[data-theme="grad-plasma"]{
  --bg0:#0a0610;
  --bg:radial-gradient(1200px 800px at 78% 8%, #2a1550 0%, transparent 60%),
       radial-gradient(900px 700px at 8% 92%, #3a1030 0%, transparent 62%),
       linear-gradient(170deg,#100a1a 0%,#08050d 100%);
  --orb1:#a259ff; --orb2:#ff6bb5; --orb3:#5a2f9e;
  --o1:.34; --o2:.26; --o3:.24;
  --panel:rgba(244,232,255,.05); --panel-2:rgba(244,232,255,.08); --panel-3:rgba(244,232,255,.12);
  --stroke:rgba(226,200,255,.1); --stroke-2:rgba(226,200,255,.17);
  --glass-a:rgba(238,224,255,.08); --glass-b:rgba(255,214,238,.03);
  --rail-bg:rgba(240,226,255,.03); --top-bg:rgba(240,226,255,.016);
  --grid:rgba(238,226,255,.6); --grid-o:.055; --noise-o:.032;
  --txt:#f3ecfb; --txt-2:rgba(243,236,251,.63); --txt-3:rgba(243,236,251,.4);
  --accent:#c07dff; --accent-l:#ddaaff; --accent-d:#8a45e0;
  --accent-soft:rgba(192,125,255,.13); --accent-line:rgba(255,107,181,.3);
  --accent-ink:#16031f;
  --shadow-1:rgba(0,0,0,.9); --shadow-2:rgba(0,0,0,.95);
  --tip-bg:rgba(20,12,28,.94); --sheen:rgba(255,255,255,.5);
  --danger:#ff6b7a; --warn:#ffc46b; --hover:rgba(238,226,255,.05);
  --grad-a:#a259ff; --grad-b:#ff6bb5;
  --accent-grad:linear-gradient(135deg,#a259ff 0%,#ff6bb5 100%);
  --accent-grad-soft:linear-gradient(135deg,rgba(162,89,255,.18) 0%,rgba(255,107,181,.18) 100%);
  --grad-hairline:linear-gradient(90deg,transparent 0%,rgba(162,89,255,.82) 38%,rgba(255,107,181,.82) 62%,transparent 100%);
}

/* ---------- 渐变主题：落日（橙 #ff9d5c → 粉 #ff6f9c，浅色） ---------- */
html[data-theme="grad-sunset"]{
  --bg0:#fdeee7;
  --bg:radial-gradient(1100px 780px at 80% 6%, #ffe0cc 0%, transparent 62%),
       radial-gradient(900px 700px at 6% 94%, #ffd6e2 0%, transparent 62%),
       linear-gradient(170deg,#fff7f2 0%,#fbe6dd 100%);
  --orb1:#ffb98c; --orb2:#ffa8c0; --orb3:#ffd6a8;
  --o1:.5; --o2:.42; --o3:.36;
  --panel:rgba(255,255,255,.62); --panel-2:rgba(255,255,255,.9); --panel-3:#fff;
  --stroke:rgba(96,44,30,.09); --stroke-2:rgba(96,44,30,.17);
  --glass-a:rgba(255,255,255,.82); --glass-b:rgba(255,255,255,.5);
  --glass-hl:rgba(255,255,255,.78);
  --glass-edge:rgba(255,255,255,1);
  --glass-edge-2:rgba(255,255,255,.6);
  --rail-bg:rgba(255,255,255,.56); --top-bg:rgba(255,255,255,.5);
  --grid:rgba(120,58,40,.5); --grid-o:.05; --noise-o:.018;
  --txt:#3a1c14; --txt-2:rgba(58,28,20,.68); --txt-3:rgba(58,28,20,.46);
  --accent:#e2543a; --accent-l:#ff8f6f; --accent-d:#b23a1f;
  --accent-soft:rgba(226,84,58,.12); --accent-line:rgba(226,84,58,.3);
  --accent-ink:#3a1208;
  --shadow-1:rgba(120,52,28,.2); --shadow-2:rgba(120,52,28,.28);
  --tip-bg:rgba(255,255,255,.97); --sheen:rgba(255,255,255,.6);
  --danger:#cf3050; --warn:#b8790c; --hover:rgba(96,44,30,.05);
  --grad-a:#ff9d5c; --grad-b:#ff6f9c;
  --accent-grad:linear-gradient(135deg,#ff9d5c 0%,#ff6f9c 100%);
  --accent-grad-soft:linear-gradient(135deg,rgba(255,157,92,.2) 0%,rgba(255,111,156,.2) 100%);
  --grad-hairline:linear-gradient(90deg,transparent 0%,rgba(255,150,84,.92) 38%,rgba(255,101,150,.92) 62%,transparent 100%);
}

/* ---------- 渐变主题：樱粉（粉 #ffb3d1 → 紫 #b596f0，浅色） ---------- */
html[data-theme="grad-sakura"]{
  --bg0:#fdf1f7;
  --bg:radial-gradient(1100px 780px at 80% 6%, #ffe0ef 0%, transparent 62%),
       radial-gradient(900px 700px at 6% 94%, #ece2fb 0%, transparent 62%),
       linear-gradient(170deg,#fff8fb 0%,#f8e8f2 100%);
  --orb1:#ffb8d8; --orb2:#cfa8f5; --orb3:#ffd0e4;
  --o1:.52; --o2:.44; --o3:.36;
  --panel:rgba(255,255,255,.62); --panel-2:rgba(255,255,255,.9); --panel-3:#fff;
  --stroke:rgba(92,36,68,.09); --stroke-2:rgba(92,36,68,.17);
  --glass-a:rgba(255,255,255,.82); --glass-b:rgba(255,255,255,.5);
  --glass-hl:rgba(255,255,255,.78);
  --glass-edge:rgba(255,255,255,1);
  --glass-edge-2:rgba(255,255,255,.6);
  --rail-bg:rgba(255,255,255,.56); --top-bg:rgba(255,255,255,.5);
  --grid:rgba(110,44,80,.5); --grid-o:.05; --noise-o:.018;
  --txt:#3b1a2c; --txt-2:rgba(59,26,44,.68); --txt-3:rgba(59,26,44,.46);
  --accent:#d94f97; --accent-l:#ff9fc9; --accent-d:#a8336f;
  --accent-soft:rgba(217,79,151,.12); --accent-line:rgba(217,79,151,.3);
  --accent-ink:#33101f;
  --shadow-1:rgba(108,44,84,.2); --shadow-2:rgba(108,44,84,.28);
  --tip-bg:rgba(255,255,255,.97); --sheen:rgba(255,255,255,.6);
  --danger:#cf3050; --warn:#b8790c; --hover:rgba(92,36,68,.05);
  --grad-a:#ffb3d1; --grad-b:#b596f0;
  --accent-grad:linear-gradient(135deg,#ffb3d1 0%,#b596f0 100%);
  --accent-grad-soft:linear-gradient(135deg,rgba(255,179,209,.22) 0%,rgba(181,150,240,.22) 100%);
  --grad-hairline:linear-gradient(90deg,transparent 0%,rgba(255,163,200,.95) 38%,rgba(181,150,240,.9) 62%,transparent 100%);
}

/* ---------- 渐变主题：薄荷（青绿 #63e0b4 → 天蓝 #37c2e0，浅色） ---------- */
html[data-theme="grad-mint"]{
  --bg0:#edfaf5;
  --bg:radial-gradient(1100px 780px at 80% 6%, #cdf5e6 0%, transparent 62%),
       radial-gradient(900px 700px at 6% 94%, #d6f2fb 0%, transparent 62%),
       linear-gradient(170deg,#f8fffc 0%,#e1f6f0 100%);
  --orb1:#8fedd0; --orb2:#90e0f5; --orb3:#b8f0d8;
  --o1:.56; --o2:.46; --o3:.36;
  --panel:rgba(255,255,255,.62); --panel-2:rgba(255,255,255,.9); --panel-3:#fff;
  --stroke:rgba(12,74,64,.09); --stroke-2:rgba(12,74,64,.17);
  --glass-a:rgba(255,255,255,.82); --glass-b:rgba(255,255,255,.5);
  --glass-hl:rgba(255,255,255,.78);
  --glass-edge:rgba(255,255,255,1);
  --glass-edge-2:rgba(255,255,255,.6);
  --rail-bg:rgba(255,255,255,.56); --top-bg:rgba(255,255,255,.5);
  --grid:rgba(14,86,74,.5); --grid-o:.05; --noise-o:.018;
  --txt:#0c302a; --txt-2:rgba(12,48,42,.68); --txt-3:rgba(12,48,42,.46);
  --accent:#0f9f7d; --accent-l:#56e0bf; --accent-d:#0a7a5e;
  --accent-soft:rgba(15,159,125,.12); --accent-line:rgba(15,159,125,.3);
  --accent-ink:#04231c;
  --shadow-1:rgba(16,84,74,.2); --shadow-2:rgba(16,84,74,.28);
  --tip-bg:rgba(255,255,255,.97); --sheen:rgba(255,255,255,.6);
  --danger:#cf3050; --warn:#b8790c; --hover:rgba(12,74,64,.05);
  --grad-a:#63e0b4; --grad-b:#37c2e0;
  --accent-grad:linear-gradient(135deg,#63e0b4 0%,#37c2e0 100%);
  --accent-grad-soft:linear-gradient(135deg,rgba(99,224,180,.22) 0%,rgba(55,194,224,.22) 100%);
  --grad-hairline:linear-gradient(90deg,transparent 0%,rgba(99,224,180,.9) 38%,rgba(55,194,224,.9) 62%,transparent 100%);
}

/* ==================================================================
 * 渐变主题：让渐变在界面上真的看得见
 * 全套规则的上下文前缀都是 html[data-theme^="grad-"]，
 * 老的 7 个纯色主题一条都匹配不到。
 * ================================================================== */

/* 1) 主按钮：A→B 渐变，hover 提亮，active 微压 */
html[data-theme^="grad-"] .btn-primary:not(.running){
  background:var(--accent-grad);
  background-size:100% 100%;
  box-shadow:0 16px 36px -18px var(--accent),inset 0 1px 0 var(--sheen);
}
html[data-theme^="grad-"] .btn-primary:not(.running):hover{
  background:var(--accent-grad);
  filter:brightness(1.07) saturate(1.06);
  box-shadow:0 22px 44px -16px var(--accent),inset 0 1px 0 var(--sheen);
}
html[data-theme^="grad-"] .btn-primary:not(.running):active{
  filter:brightness(.96) saturate(1.03);
  transform:translateY(0) scale(.985);
}

/* 2) 卡片顶部 1px 渐变高光（用背景层实现，不改 position，不碰伪元素） */
html[data-theme^="grad-"] .glass{
  background-image:var(--grad-hairline),linear-gradient(165deg,var(--glass-a),var(--glass-b));
  background-size:100% 1px,100% 100%;
  background-position:0 1px,0 0;
  background-repeat:no-repeat,no-repeat;
}

/* 3) 选中色卡：A→B 半透明底 + 1px 渐变描边（mask 挖空，圆角跟着色卡走） */
html[data-theme^="grad-"] .sw.on{
  background:var(--accent-grad-soft);
  border-color:transparent;
}
html[data-theme^="grad-"] .sw.on::after{
  content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;
  background:var(--accent-grad);pointer-events:none;
  -webkit-mask:linear-gradient(#000,#000) content-box,linear-gradient(#000,#000);
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000,#000) content-box,linear-gradient(#000,#000);
  mask-composite:exclude;
}

/* 4) 分段控件选中项 */
html[data-theme^="grad-"] .seg button.on{
  background:var(--accent-grad-soft);
  box-shadow:inset 0 0 0 1px var(--accent-line),0 2px 8px rgba(0,0,0,.14);
}

/* 5) 进度条填充 */
html[data-theme^="grad-"] .bar i{
  background:var(--accent-grad);
  box-shadow:0 0 16px var(--accent);
}

/* 6) 侧栏激活项：底色渐变 + 左侧竖条 A→B */
html[data-theme^="grad-"] .rail-btn.active{
  background:var(--accent-grad-soft);
}
html[data-theme^="grad-"] .rail-btn.active::before{
  background:linear-gradient(180deg,var(--grad-a),var(--grad-b));
  box-shadow:0 0 14px var(--accent);
}
`;

  /* ---------------- 注入样式 ---------------- */
  function injectCss() {
    if (doc.getElementById('patch-90-style')) return;
    var st = doc.createElement('style');
    st.id = 'patch-90-style';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  /* ---------------- 色卡 ---------------- */
  function dotStyle(g) {
    var bg = 'linear-gradient(145deg,' + g.a + ',' + g.mid + ' 50%,' + g.b + ')';
    /* 浅色圆点用黑描边勾边（照雪白那条的写法），深色用默认白描边 */
    var ring = g.dark
      ? 'inset 0 0 0 1px rgba(255,255,255,.22),0 3px 10px -4px rgba(0,0,0,.6)'
      : 'inset 0 0 0 1px rgba(0,0,0,.12),0 3px 10px -4px rgba(0,0,0,.35)';
    return 'background:' + bg + ';box-shadow:' + ring;
  }

  function buildSwatch(g) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.setAttribute('data-theme', g.id);
    b.setAttribute('data-grad', '1');
    b.title = g.name + ' · ' + g.a + ' → ' + g.b;
    b.setAttribute('aria-label', g.name + '，渐变配色，' + g.sub);

    var dot = doc.createElement('span');
    dot.className = 'sw-dot';
    dot.setAttribute('style', dotStyle(g));

    var txt = doc.createElement('span');
    var n = doc.createElement('span');
    n.className = 'sw-name';
    n.textContent = g.name;
    var s = doc.createElement('span');
    s.className = 'sw-sub';
    s.textContent = g.sub;
    txt.appendChild(n);
    txt.appendChild(s);

    b.appendChild(dot);
    b.appendChild(txt);
    b.addEventListener('click', function () { applyGrad(g.id); });
    return b;
  }

  function injectSwatches() {
    var wrap = $('#swatches');
    if (!wrap) return;
    var have = $$('.sw[data-grad="1"]', wrap);
    if (have.length === GRADS.length) return;
    /* 数量不对（被清过/被重复写过）先整体摘掉再重建，保证永远 6 个 */
    have.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    var anchor = doc.getElementById('cpSwatch');
    GRADS.forEach(function (g) {
      var btn = buildSwatch(g);
      /* 「自定义」永远排最后 */
      if (anchor && anchor.parentNode === wrap) wrap.insertBefore(btn, anchor);
      else wrap.appendChild(btn);
    });
  }

  /* ---------------- 主题切换 ---------------- */
  function currentId() {
    if (root.getAttribute('data-custom') === 'on') return 'custom';
    return root.getAttribute('data-theme') || '';
  }

  function syncUI(id) {
    if (!NAMES[id]) return;
    $$('.sw').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-theme') === id);
    });
    var el = doc.getElementById('popTheme');
    if (el && el.textContent !== NAMES[id]) el.textContent = NAMES[id];
    var dot = doc.getElementById('cpSwatchDot');
    if (dot) dot.style.background = '';
  }

  function applyGrad(id) {
    try { if (typeof window.clearCustomTheme === 'function') window.clearCustomTheme(); } catch (e) {}
    root.removeAttribute('data-custom');
    root.setAttribute('data-theme', id);
    try { localStorage.setItem('mc.theme', id); } catch (e) {}
    syncUI(id);
    try {
      if (typeof window.toast === 'function') window.toast('已切换配色 · ' + NAMES[id]);
    } catch (e) {}
  }

  /* 原引擎的 THEME_NAMES 是闭包常量，读到 grad-xxx 时会原样写入 #popTheme，
     这里把它改写成中文名；只在文本确实等于原始 id 时动手，避免和自己打架。 */
  function watchPopTheme() {
    var el = doc.getElementById('popTheme');
    if (!el) return;
    var fix = function () {
      var t = (el.textContent || '').trim();
      if (NAMES[t]) el.textContent = NAMES[t];
    };
    try {
      new MutationObserver(fix).observe(el, { childList: true, characterData: true, subtree: true });
    } catch (e) {}
    fix();
  }

  function watchTheme() {
    try {
      new MutationObserver(function () {
        var id = currentId();
        if (NAMES[id]) syncUI(id);
      }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-custom'] });
    } catch (e) {}
  }

  /* ---------------- init ---------------- */
  function init() {
    injectCss();
    injectSwatches();
    watchPopTheme();
    watchTheme();
    var id = currentId();
    if (NAMES[id]) syncUI(id);
  }

  function boot() {
    try { init(); } catch (e) { console.warn('[patch 90]', e); }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
console.log('[patch 90] ready');
