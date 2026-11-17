/* ------------------------------------------------------------------
 * patch/10-restore-default.js — 外观设置：默认形象卡 / 不佩戴卡 / 一键恢复
 * 作用域：只往 #skinGridSkin、#skinGridDeco、#skinBody 里插元素，
 *         再加一个自身的 toast；不碰 #skinZoomGrid、不碰首页 hero 逻辑。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var doc = document;
  var PATCH = '10';

  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }

  /* ------------------------------ 图标 ------------------------------ */

  var SVG_RESTORE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M3.6 12a8.4 8.4 0 1 0 2.46-5.94"/>' +
    '<path d="M3.6 4.3v4.2h4.2"/>' +
    '</svg>';

  var SVG_NONE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="8.4"/>' +
    '<path d="M6.1 17.9 17.9 6.1"/>' +
    '</svg>';

  /* ------------------------------ 样式 ------------------------------ */

  var CSS = [
    /* 卡片：沿用 .skin-item / .skin-pix / .skin-name，只补副标题与图标细节 */
    '#skinBody .p10-card{overflow:hidden}',
    '#skinBody .p10-card .skin-pix{padding:9px 9px 7px}',
    '#skinBody .p10-card .skin-pix svg{max-width:60px;shape-rendering:auto;image-rendering:auto;color:var(--accent)}',
    '#skinBody .p10-card .skin-name{min-height:44px;font-size:10.5px;letter-spacing:-.2px;white-space:nowrap;overflow:hidden}',
    '#skinBody .p10-sub{display:block;margin-top:3px;font-size:9.5px;line-height:1.35;color:var(--txt-3)}',
    /* 立体模式下这两张卡不是像素画，不参与等距倾斜与地面阴影 */
    'html[data-skin="iso"] #skinBody .p10-card .skin-pix{perspective:none}',
    'html[data-skin="iso"] #skinBody .p10-card .skin-pix svg,',
    'html[data-skin="iso"] #skinBody .p10-card:hover .skin-pix svg{transform:none;filter:none;will-change:auto}',
    'html[data-skin="iso"] #skinBody .p10-card .skin-pix::after{display:none}',
    /* 底部整卡恢复按钮 */
    '#skinBody .p10-foot{display:flex;justify-content:flex-end;padding:0 18px 14px;margin-top:-8px}',
    '#p10ResetAll{',
    '  display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 16px;',
    '  border-radius:var(--r-pill);border:1px solid var(--stroke);background:var(--panel-2);',
    '  color:var(--txt-2);font:inherit;font-size:12px;cursor:pointer;',
    '  transition:transform calc(.2s * var(--anim-k)) var(--ease),color calc(.2s * var(--anim-k)) var(--ease),',
    '             border-color calc(.2s * var(--anim-k)) var(--ease),background calc(.2s * var(--anim-k)) var(--ease);',
    '}',
    '#p10ResetAll:hover{color:var(--txt);transform:translateY(-1px)}',
    '#p10ResetAll:active{transform:translateY(0) scale(.98)}',
    '#p10ResetAll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '#p10ResetAll svg{width:14px;height:14px}',
    '#p10ResetAll.armed{border-color:var(--accent-line);background:var(--accent-soft);color:var(--accent)}',
    '#p10ResetAll.armed svg{animation:p10Pulse .9s var(--ease) infinite alternate}',
    '@keyframes p10Pulse{from{opacity:.55}to{opacity:1}}',
    /* 自己的 toast（不借用页面里那个闭包里的 toast()） */
    '#p10Toast{',
    '  position:fixed;left:50%;bottom:34px;z-index:200;padding:10px 18px;',
    '  border-radius:var(--r-pill);background:var(--tip-bg);border:1px solid var(--stroke);',
    '  color:var(--txt);font-size:12.5px;white-space:nowrap;pointer-events:none;opacity:0;',
    '  transform:translate(-50%,12px);',
    '  transition:transform calc(.26s * var(--anim-k)) var(--ease),opacity calc(.26s * var(--anim-k));',
    '}',
    '#p10Toast.on{opacity:1;transform:translate(-50%,0)}',
    'html[data-motion="on"] #p10Toast{font-family:ui-monospace,"Cascadia Mono",Consolas,"Microsoft YaHei",monospace}'
  ].join('\n');

  function injectCss() {
    if (doc.getElementById('patch-10-style')) return;
    var st = doc.createElement('style');
    st.id = 'patch-10-style';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  /* ------------------------------ 小工具 ------------------------------ */

  function setOn(el, on) {
    if (!el) return;
    if (on) el.classList.add('on'); else el.classList.remove('on');
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function readStore(k) {
    try { return localStorage.getItem(k) || ''; } catch (e) { return ''; }
  }
  function writeStore(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式等，忽略 */ }
  }
  function dropStore(k) {
    try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ }
  }

  var toastEl = null;
  var toastTimer = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = doc.createElement('div');
      toastEl.id = 'p10Toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    void toastEl.offsetWidth;                 /* 强制回流：连点也能重播上浮 */
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2000);
  }

  /* ------------------------------ 卡片 ------------------------------ */

  var cardDefault = null;
  var cardNone = null;

  function makeCard(opts) {
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'skin-item p10-card';
    btn.id = opts.id;
    btn.setAttribute('data-id', opts.dataId);
    btn.setAttribute('data-group', opts.group);
    btn.setAttribute('data-patch', PATCH);
    btn.setAttribute('aria-pressed', 'false');
    btn.title = opts.title;

    var pix = doc.createElement('span');
    pix.className = 'skin-pix';
    pix.innerHTML = opts.svg;

    var name = doc.createElement('span');
    name.className = 'skin-name';
    name.textContent = opts.name;
    if (opts.sub) {
      var sub = doc.createElement('span');
      sub.className = 'p10-sub';
      sub.textContent = opts.sub;
      name.appendChild(sub);
    }

    btn.appendChild(pix);
    btn.appendChild(name);
    btn.addEventListener('click', function () { pick(btn, opts.pick); });
    return btn;
  }

  function pick(el, id) {
    try {
      var skin = window.XCL_SKIN;
      if (skin && typeof skin.select === 'function') skin.select(id);
    } catch (e) {
      console.warn('[patch 10] select', e);
    }
    syncMine();
    setOn(el, true);   /* 和原生项一致：class="on" + aria-pressed="true" */
  }

  function defaultId() {
    var skin = window.XCL_SKIN;
    var id = skin && skin.defaultId;
    return id || 'grass_block';
  }

  /* 两张卡片的选中态：当前是「无装饰的默认草方块」时两张都亮（各在自己分区里成立） */
  function syncMine() {
    if (!cardDefault && !cardNone) return;
    var cur = '';
    try {
      var skin = window.XCL_SKIN;
      if (skin && typeof skin.current === 'function') cur = skin.current() || '';
    } catch (e) { cur = ''; }
    var isDef = !cur || cur === defaultId();
    setOn(cardDefault, isDef);
    setOn(cardNone, isDef);
  }

  /* 包一层对外接口：任何入口（原生项、首页提示条、本补丁）换装后都回来同步 */
  function hookSelect() {
    var skin = window.XCL_SKIN;
    if (!skin || typeof skin.select !== 'function' || skin.__p10) return;
    var orig = skin.select;
    skin.select = function (id) {
      var r = orig.apply(skin, arguments);
      try { syncMine(); } catch (e) { /* 不扩散 */ }
      return r;
    };
    skin.__p10 = true;
  }

  /* ------------------------------ 恢复全部 ------------------------------ */

  function setFlat() {
    writeStore('mc.skinStyle', 'flat');
    try { doc.documentElement.setAttribute('data-skin', 'flat'); } catch (e) {}
    var seg = doc.getElementById('skinStyleSeg');
    if (!seg) return;
    var bs = seg.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      var on = b.getAttribute('data-style') === 'flat';
      if (on) b.classList.add('on'); else b.classList.remove('on');
    }
  }

  function restoreAll() {
    var id = defaultId();
    try {
      var skin = window.XCL_SKIN;
      if (skin && typeof skin.select === 'function') skin.select(id);
    } catch (e) { console.warn('[patch 10] restore', e); }

    setFlat();
    dropStore('mc.skinWarnAck');   /* 内测提示条重新具备出现条件 */
    syncMine();

    /* 提示条自己会在「非默认 + 未确认」时出现，这里只是让它重新判断一次 */
    if (typeof window.XCL_SKIN_NOTICE === 'function') {
      try { window.XCL_SKIN_NOTICE(); } catch (e) { /* 忽略 */ }
    }

    toast('已恢复默认外观');
  }

  function buildReset() {
    var foot = doc.createElement('div');
    foot.className = 'skin-foot p10-foot';
    foot.setAttribute('data-patch', PATCH);

    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = 'p10ResetAll';
    btn.setAttribute('data-patch', PATCH);
    btn.innerHTML = SVG_RESTORE;
    var txt = doc.createElement('span');
    txt.id = 'p10ResetTxt';
    btn.appendChild(txt);

    var LABEL_IDLE = '恢复全部外观默认';
    var LABEL_ARMED = '再点一次确认';
    var armed = false;
    var armTimer = 0;

    function paint() {
      txt.textContent = armed ? LABEL_ARMED : LABEL_IDLE;
      if (armed) btn.classList.add('armed'); else btn.classList.remove('armed');
      btn.setAttribute('aria-label', armed ? '再点一次确认恢复默认外观' : LABEL_IDLE);
    }

    function disarm() {
      clearTimeout(armTimer);
      armTimer = 0;
      armed = false;
      paint();
    }

    btn.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        paint();
        armTimer = setTimeout(disarm, 2000);   /* 2 秒内不再点就复原 */
        return;
      }
      disarm();
      try { restoreAll(); } catch (e) { console.warn('[patch 10]', e); }
    });

    paint();            /* 初始文案（点击前也要有字） */
    foot.appendChild(btn);
    return foot;
  }

  /* ------------------------------ 组装 ------------------------------ */

  function insertFirst(grid, node) {
    if (!grid) return;
    /* 幂等：同 id 的卡已存在就不再插 */
    if (doc.getElementById(node.id)) return;
    grid.insertBefore(node, grid.firstChild);
  }

  function setup() {
    hookSelect();

    var gridSkin = doc.getElementById('skinGridSkin');
    var gridDeco = doc.getElementById('skinGridDeco');
    var body = doc.getElementById('skinBody');

    /* 1) 人物皮肤区：默认形象卡 */
    cardDefault = makeCard({
      id: 'p10CardDefault',
      dataId: 'p10-default',
      group: 'skin',
      title: '默认（草方块）',
      name: '默认（草方块）',
      sub: '还原到最初的样子',
      svg: SVG_RESTORE,
      pick: defaultId()
    });
    insertFirst(gridSkin, cardDefault);

    /* 2) 经典装饰区：不佩戴卡（ITEMS 里没有「无/不佩戴」条目，所以这里补一张） */
    var hasNone = false;
    var existing = gridDeco ? $$('.skin-item', gridDeco) : [];
    for (var i = 0; i < existing.length; i++) {
      var nm = (existing[i].getAttribute('title') || '') + (existing[i].textContent || '');
      if (nm.indexOf('不佩戴') >= 0 || nm.indexOf('无装饰') >= 0) { hasNone = true; break; }
    }
    cardNone = makeCard({
      id: 'p10CardNone',
      dataId: 'p10-none',
      group: 'deco',
      title: '不佩戴',
      name: '不佩戴',
      sub: '不挂任何装饰',
      svg: SVG_NONE,
      pick: defaultId()
    });
    if (!hasNone) insertFirst(gridDeco, cardNone);
    else cardNone = null;

    /* 3) 底部整卡恢复按钮 */
    if (body && !doc.getElementById('p10ResetAll')) {
      var foot = body.querySelector('.skin-foot');
      var row = buildReset();
      if (foot && foot.parentNode) foot.parentNode.insertBefore(row, foot.nextSibling);
      else body.appendChild(row);
    }

    syncMine();
  }

  /* ------------------------------ 启动 ------------------------------ */

  function ready() {
    var skin = window.XCL_SKIN;
    if (!skin || typeof skin.select !== 'function') return false;
    var gs = doc.getElementById('skinGridSkin');
    var gd = doc.getElementById('skinGridDeco');
    if (!gs || !gd) return false;
    /* 原生 fillGrid 还没跑时插入会排到后面，等它填完再插 */
    return gs.children.length > 0 && gd.children.length > 0;
  }

  function boot(t0) {
    try {
      if (ready()) { setup(); return; }
      if (Date.now() - t0 > 3000) return;      /* 超时静默放弃 */
      setTimeout(function () { boot(t0); }, 60);
    } catch (e) {
      console.warn('[patch 10]', e);
    }
  }

  function init() {
    try {
      injectCss();
      if (!$('#skinCard') || !$('#skinBody')) return;   /* 没有这段 HTML 时整体静默 */
      var t0 = Date.now();
      if (ready()) setup();
      else boot(t0);
    } catch (e) {
      console.warn('[patch 10]', e);
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();

console.log('[patch 10] ready');
