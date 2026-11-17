/* ------------------------------------------------------------------
 * patch/170-command.js — Command Palette（Ctrl/Cmd + K 命令面板）
 * 作用域：只在 <body> 末尾挂一个 .m170-mask（内含 .m170-panel），
 *         命令全部「发现式」生成：每次打开时现扫 DOM，把侧栏页、
 *         配色色卡、反馈页 / 更新页 / 性能卡上的真实按钮收进列表。
 *         不改 index.html、不改任何既有文件的类与属性。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  if (window.__xclPatch170) return;
  window.__xclPatch170 = true;

  var STYLE_ID = 'patch-170-style';
  var MASK_ID = 'm170Mask';
  var MAX_ROWS = 8;

  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function motionOn() { return root.dataset.motion !== 'off'; }

  /* ------------------------------------------------------------------
   * 图标：全部原生 SVG path，不用 emoji
   * ------------------------------------------------------------------ */
  var ICON = {
    palette: '<path d="M12 3.2a8.8 8.8 0 0 0 0 17.6c1.3 0 2-.8 2-1.9 0-.6-.3-1-.6-1.4-.3-.4-.5-.9-.5-1.3 0-1 .8-1.8 1.9-1.8h1.7a4.7 4.7 0 0 0 4.7-4.7c0-3.7-4.1-6.5-9.2-6.5Z"/>' +
      '<circle cx="8.3" cy="10.1" r=".95" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="7.7" r=".95" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.7" cy="10.1" r=".95" fill="currentColor" stroke="none"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
    update: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/><path d="M12 8.4v6"/><path d="m9.7 12 2.3 2.3 2.3-2.3"/>',
    folder: '<path d="M3.6 8.5A2.5 2.5 0 0 1 6.1 6h3.4l2 2.4h6.4a2.5 2.5 0 0 1 2.5 2.5v6.6a2.5 2.5 0 0 1-2.5 2.5H6.1a2.5 2.5 0 0 1-2.5-2.5V8.5Z"/>',
    gauge: '<path d="M4 17.4a8.4 8.4 0 1 1 16 0"/><path d="m12 13.3 3.5-3.5"/><circle cx="12" cy="14.6" r="1.5"/>',
    archive: '<path d="M4 8.2h16v9.5a2.3 2.3 0 0 1-2.3 2.3H6.3A2.3 2.3 0 0 1 4 17.7V8.2Z"/><path d="M3.3 5.2h17.4v3H3.3z"/><path d="M9.8 12.5h4.4"/>',
    link: '<path d="M14.3 4.6h5.1v5.1"/><path d="M19.4 4.6 11.2 12.8"/><path d="M18 14.4v3.8a2.3 2.3 0 0 1-2.3 2.3H6.3A2.3 2.3 0 0 1 4 18.2V8.8a2.3 2.3 0 0 1 2.3-2.3h3.8"/>',
    page: '<path d="M6 4.4h7.5L18.4 9.3v10.3H6z"/><path d="M13.5 4.4v4.9h4.9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    empty: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/><path d="M8.4 11h5.2"/>'
  };

  function svgWrap(paths, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + paths + '</svg>';
  }

  /* ------------------------------------------------------------------
   * 拼音首字母表：只收命令里会出现的字，查不到的字退化成原字符。
   * 用于「qhp」这类缩写匹配，不影响子串匹配。
   * ------------------------------------------------------------------ */
  var PY_GROUPS = {
    a: '安暗',
    b: '白本版包备薄',
    c: '采查草次',
    d: '典电定多断打',
    f: '反粉复',
    g: '更官光',
    h: '海黑琥荷换',
    j: '机检加经极',
    k: '馈开',
    l: '绿蓝列录落联',
    m: '目',
    n: '能',
    p: '配珀',
    q: '浅切前清全',
    r: '日',
    s: '色设深刷',
    t: '通题',
    w: '往网为蔚',
    x: '雪薰新信息性选下戏',
    y: '游源页义樱衣样用',
    z: '载置知主资装重自紫诊'
  };
  var CHAR2INIT = {};
  Object.keys(PY_GROUPS).forEach(function (k) {
    var s = PY_GROUPS[k];
    for (var i = 0; i < s.length; i++) CHAR2INIT[s.charAt(i)] = k;
  });

  function initialsOf(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var low = ch.toLowerCase();
      if (CHAR2INIT[ch]) out += CHAR2INIT[ch];
      else if (/[a-z0-9]/.test(low)) out += low;
    }
    return out;
  }

  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s\u00b7:：、,，.。/\\-]+/g, '');
  }

  function isSub(needle, hay) {
    if (!needle) return false;
    var j = 0;
    for (var i = 0; i < hay.length && j < needle.length; i++) {
      if (hay.charAt(i) === needle.charAt(j)) j++;
    }
    return j === needle.length;
  }

  /* ------------------------------------------------------------------
   * 样式
   * ------------------------------------------------------------------ */
  var CSS = [
    '.m170-mask{position:fixed;inset:0;z-index:9000;display:flex;justify-content:center;align-items:flex-start;',
    '  padding:18vh 16px 16px;background:rgba(0,0,0,.45);',
    '  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);',
    '  opacity:0;visibility:hidden;',
    '  transition:opacity .22s cubic-bezier(.22,.68,.36,1),visibility 0s linear .22s}',

    '.m170-mask.on{opacity:1;visibility:visible;transition:opacity .22s cubic-bezier(.22,.68,.36,1),visibility 0s}',

    '.m170-panel{position:relative;display:flex;flex-direction:column;width:min(620px,88vw);max-height:70vh;',
    '  border-radius:20px;overflow:hidden;',
    '  background:var(--panel-2);border:1px solid var(--stroke-2);',
    '  -webkit-backdrop-filter:blur(24px) saturate(1.2);backdrop-filter:blur(24px) saturate(1.2);',
    '  box-shadow:0 40px 80px -30px var(--shadow-2);',
    '  transform:scale(.96) translateY(-8px);opacity:0;',
    '  transition:transform .3s cubic-bezier(.2,1.1,.3,1),opacity .3s cubic-bezier(.2,1.1,.3,1)}',

    '.m170-mask.on .m170-panel{transform:scale(1) translateY(0);opacity:1}',

    '.m170-head{display:flex;align-items:center;gap:11px;padding:15px 18px;border-bottom:1px solid var(--stroke);flex-shrink:0}',
    '.m170-mico{display:grid;place-items:center;width:20px;height:20px;color:var(--txt-3);flex-shrink:0}',
    '.m170-mico svg{width:18px;height:18px;display:block}',
    '.m170-input{flex:1;min-width:0;background:none;border:none;outline:none;padding:0;',
    '  font:inherit;font-size:15px;line-height:22px;color:var(--txt);letter-spacing:-.01em}',
    '.m170-input::placeholder{color:var(--txt-3)}',
    '.m170-kbd{display:inline-flex;align-items:center;height:21px;padding:0 8px;border-radius:7px;',
    '  border:1px solid var(--stroke-2);background:var(--panel-3);',
    '  font-size:10.5px;font-weight:600;letter-spacing:.02em;color:var(--txt-3);flex-shrink:0}',

    '.m170-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:8px;display:flex;flex-direction:column;gap:2px}',
    '.m170-list::-webkit-scrollbar{width:8px}',
    '.m170-list::-webkit-scrollbar-thumb{background:var(--stroke-2);border-radius:var(--r-pill);border:2px solid transparent;background-clip:content-box}',

    '.m170-item{display:flex;align-items:center;gap:11px;width:100%;height:40px;flex-shrink:0;',
    '  padding:0 12px;border-radius:12px;text-align:left;color:var(--txt-2);',
    '  transition:background-color .14s ease,color .14s ease}',
    '.m170-item:hover{background:var(--hover)}',
    '.m170-item.sel{background:var(--accent-soft);color:var(--txt)}',
    '.m170-item.sel .m170-ico{color:var(--accent)}',

    '.m170-ico{display:grid;place-items:center;width:19px;height:19px;flex-shrink:0;color:var(--txt-3)}',
    '.m170-ico svg{width:17px;height:17px;display:block}',
    '.m170-t{font-size:13px;font-weight:540;letter-spacing:-.01em;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.m170-s{margin-left:auto;padding-left:14px;font-size:11px;color:var(--txt-2);opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;max-width:46%}',
    '.m170-item.sel .m170-s{color:var(--txt-2);opacity:1}',

    '.m170-empty{display:flex;flex-direction:column;align-items:center;gap:11px;padding:38px 18px 42px;color:var(--txt-3)}',
    '.m170-empty svg{width:30px;height:30px;opacity:.55}',
    '.m170-empty span{font-size:12.5px}',

    '.m170-foot{display:flex;align-items:center;gap:6px;padding:9px 18px 11px;border-top:1px solid var(--stroke);',
    '  font-size:11.5px;color:var(--txt-3);flex-shrink:0;letter-spacing:.01em}',
    '.m170-foot b{font-weight:600;color:var(--txt-2)}',
    '.m170-dot{opacity:.45;margin:0 2px}',

    '.m170-lock{overflow:hidden!important}',

    'html[data-motion="off"] .m170-mask,',
    'html[data-motion="off"] .m170-panel,',
    'html[data-motion="off"] .m170-item{transition:none!important;animation:none!important}',
    'html[data-motion="off"] .m170-panel{transform:none;opacity:1}',

    '@media (prefers-reduced-motion:reduce){',
    '  .m170-mask,.m170-panel,.m170-item{transition:none!important}',
    '  .m170-panel{transform:none;opacity:1}',
    '}',

    '@media (max-width:640px){',
    '  .m170-mask{padding:10vh 12px 12px}',
    '  .m170-panel{width:100%;max-height:76vh}',
    '  .m170-s{display:none}',
    '}'
  ].join('\n');

  function injectCss() {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || root).appendChild(st);
  }

  /* ------------------------------------------------------------------
   * 命令发现（每次打开都重扫）
   * ------------------------------------------------------------------ */
  function themeOf() { return root.getAttribute('data-theme') || ''; }

  function addCmds(list, seen, item) {
    if (!item || !item.title) return;
    var key = item.title + '|' + (item.sub || '');
    if (seen[key]) return;
    seen[key] = 1;
    item.id = list.length;
    item._t = normalize(item.title);
    item._s = normalize(item.sub || '');
    item._i = initialsOf(item.title);
    item._si = initialsOf(item.sub || '');
    list.push(item);
  }

  function goPage(page) {
    var b = doc.querySelector('.rail-btn[data-page="' + page + '"]');
    if (b) { b.click(); return true; }
    return false;
  }

  function setTab(tab) {
    var b = doc.querySelector('#setSeg button[data-tab="' + tab + '"]');
    if (b) b.click();
  }

  /* 先切页面/分页，再把真实按钮点一下 */
  function later(fn) { setTimeout(fn, 120); }

  function buildCommands() {
    var list = [];
    var seen = {};
    var cur = themeOf();

    /* 1) 侧栏页 —— 直接复用 .rail-btn 的原生 svg */
    $$('.rail-btn[data-page]').forEach(function (btn) {
      var nameEl = btn.querySelector('.rb-label');
      var name = (nameEl ? nameEl.textContent : btn.getAttribute('data-page') || '').trim();
      if (!name) return;
      var src = btn.querySelector('.rb-ico svg');
      addCmds(list, seen, {
        title: name,
        sub: '页面',
        icon: src ? src.cloneNode(true) : svgWrap(ICON.page),
        run: function () { btn.click(); }
      });
    });

    /* 2) 配色 —— #swatches 里所有 .sw[data-theme]（含 90 号补丁的 6 个渐变） */
    $$('#swatches .sw[data-theme]').forEach(function (sw) {
      var id = sw.getAttribute('data-theme');
      var nameEl = sw.querySelector('.sw-name');
      var subEl = sw.querySelector('.sw-sub');
      var name = (nameEl ? nameEl.textContent : id || '').trim();
      if (!name) return;
      var extra = subEl ? subEl.textContent.trim() : '';
      var isCur = id === cur;
      addCmds(list, seen, {
        title: name,
        sub: '配色 · ' + (extra || '主题') + (isCur ? ' · 当前' : ''),
        icon: svgWrap(ICON.palette),
        run: function () { sw.click(); }
      });
    });

    /* 3) 反馈页（70 号补丁后挂，缺失就不列） */
    if ($('#fbpPack')) {
      addCmds(list, seen, {
        title: '打包诊断信息',
        sub: '反馈 · 生成诊断包',
        icon: svgWrap(ICON.archive),
        run: function () {
          goPage('feedback');
          later(function () { var b = $('#fbpPack'); if (b) b.click(); });
        }
      });
    }
    if ($('#fbpSite')) {
      addCmds(list, seen, {
        title: '前往官网反馈',
        sub: '反馈 · 浏览器打开',
        icon: svgWrap(ICON.link),
        run: function () {
          goPage('feedback');
          later(function () { var b = $('#fbpSite'); if (b) b.click(); });
        }
      });
    }

    /* 4) 版本列表刷新 */
    if ($('#refreshVer')) {
      addCmds(list, seen, {
        title: '刷新版本列表',
        sub: '安装 · 重新拉取官方版本',
        icon: svgWrap(ICON.refresh),
        run: function () {
          goPage('install');
          later(function () { var b = $('#refreshVer'); if (b) b.click(); });
        }
      });
    }

    /* 5) 检查更新 */
    if ($('#updCheckBtn')) {
      addCmds(list, seen, {
        title: '检查更新',
        sub: '设置 · 更新',
        icon: svgWrap(ICON.update),
        run: function () {
          goPage('settings');
          setTab('update');
          later(function () { var b = $('#updCheckBtn'); if (b) b.click(); });
        }
      });
    }

    /* 6) 打开游戏目录（资源页的「打开目录」） */
    if ($('#resDirBtn')) {
      addCmds(list, seen, {
        title: '打开游戏目录',
        sub: '资源 · 资源所在文件夹',
        icon: svgWrap(ICON.folder),
        run: function () { var b = $('#resDirBtn'); if (b) b.click(); }
      });
    }

    /* 7) 重置性能采样（40 号补丁的设备性能卡） */
    if ($('#p40Rescan')) {
      addCmds(list, seen, {
        title: '重置性能采样',
        sub: '设置 · 重新检测设备',
        icon: svgWrap(ICON.gauge),
        run: function () {
          goPage('settings');
          setTab('general');
          later(function () { var b = $('#p40Rescan'); if (b) b.click(); });
        }
      });
    }

    return list;
  }

  /* ------------------------------------------------------------------
   * 匹配打分：完全一致 > 前缀 > 子串 > 首字母 > 副标题 > 乱序子序列
   * ------------------------------------------------------------------ */
  function scoreOf(c, q) {
    if (!q) return 0;
    var t = c._t, s = c._s, ini = c._i, sin = c._si;
    if (t === q) return 500;
    if (t.indexOf(q) === 0) return 420 - Math.min(20, t.length - q.length);
    if (t.indexOf(q) > 0) return 340 - Math.min(20, t.indexOf(q));
    if (ini && ini.indexOf(q) === 0) return 300 - Math.min(20, ini.length - q.length);
    if (ini && q.length > 1 && isSub(q, ini)) return 250 - Math.min(40, ini.length - q.length);
    if (s && s.indexOf(q) >= 0) return 180;
    if (sin && q.length > 1 && isSub(q, sin)) return 150;
    if (q.length > 1 && isSub(q, t)) return 110;
    return -1;
  }

  /* ------------------------------------------------------------------
   * 外壳
   * ------------------------------------------------------------------ */
  var mask, panel, input, listEl, pagesEl;
  var cmds = [];
  var shown = [];
  var sel = -1;
  var isOpen = false;
  var lastFocus = null;

  function buildItem(c, idx) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'm170-item';
    b.setAttribute('role', 'option');
    b.setAttribute('data-idx', String(idx));

    var ic = doc.createElement('span');
    ic.className = 'm170-ico';
    if (c.icon && c.icon.nodeType === 1) ic.appendChild(c.icon.cloneNode(true));
    else if (typeof c.icon === 'string') ic.innerHTML = c.icon;
    b.appendChild(ic);

    var t = doc.createElement('span');
    t.className = 'm170-t';
    t.textContent = c.title;
    b.appendChild(t);

    if (c.sub) {
      var s = doc.createElement('span');
      s.className = 'm170-s';
      s.textContent = c.sub;
      b.appendChild(s);
    }
    return b;
  }

  function setSel(next) {
    if (!shown.length) { sel = -1; return; }
    if (next < 0) next = shown.length - 1;
    if (next >= shown.length) next = 0;
    sel = next;
    var items = listEl.children;
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('sel', i === sel);
      items[i].setAttribute('aria-selected', i === sel ? 'true' : 'false');
    }
    var el = items[sel];
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { }
    }
  }

  function render() {
    if (!listEl) return;
    var q = normalize(input.value);
    var hits = [];
    for (var i = 0; i < cmds.length; i++) {
      var sc = scoreOf(cmds[i], q);
      if (sc >= 0) hits.push({ c: cmds[i], s: sc });
    }
    hits.sort(function (a, b) { return (b.s - a.s) || (a.c.id - b.c.id); });
    if (hits.length > MAX_ROWS) hits = hits.slice(0, MAX_ROWS);
    shown = hits.map(function (h) { return h.c; });

    listEl.textContent = '';
    if (!shown.length) {
      var em = doc.createElement('div');
      em.className = 'm170-empty';
      em.innerHTML = svgWrap(ICON.empty, 30) + '<span>没有匹配的命令</span>';
      listEl.appendChild(em);
      sel = -1;
      return;
    }

    var frag = doc.createDocumentFragment();
    for (var k = 0; k < shown.length; k++) frag.appendChild(buildItem(shown[k], k));
    listEl.appendChild(frag);
    setSel(0);
  }

  function runAt(idx) {
    var c = shown[idx];
    if (!c) return;
    close();
    setTimeout(function () {
      try { c.run(); } catch (e) { console.warn('[patch 170]', e); }
    }, 60);
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocus = doc.activeElement;

    cmds = buildCommands();
    input.value = '';
    render();

    mask.classList.add('on');
    mask.setAttribute('aria-hidden', 'false');
    if (pagesEl) pagesEl.classList.add('m170-lock');

    if (motionOn()) {
      panel.style.willChange = 'transform,opacity';
      setTimeout(function () { panel.style.willChange = ''; }, 420);
    }

    /* 立即聚焦一次（rAF 在无合成器环境里可能不触发），下一帧再补一次 */
    try { input.focus({ preventScroll: true }); } catch (e) { }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (doc.activeElement !== input) {
          try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (e2) { } }
        }
      });
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    mask.classList.remove('on');
    mask.setAttribute('aria-hidden', 'true');
    if (pagesEl) pagesEl.classList.remove('m170-lock');
    var back = lastFocus;
    lastFocus = null;
    if (back && back.focus && doc.contains(back)) {
      try { back.focus({ preventScroll: true }); } catch (e) { }
    }
  }

  function buildShell() {
    if (doc.getElementById(MASK_ID)) return;
    pagesEl = $('#pages');

    mask = doc.createElement('div');
    mask.id = MASK_ID;
    mask.className = 'm170-mask';
    mask.setAttribute('aria-hidden', 'true');
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-label', '命令面板');

    panel = doc.createElement('div');
    panel.className = 'm170-panel';

    var head = doc.createElement('div');
    head.className = 'm170-head';

    var mico = doc.createElement('span');
    mico.className = 'm170-mico';
    mico.innerHTML = svgWrap(ICON.search, 18);
    head.appendChild(mico);

    input = doc.createElement('input');
    input.className = 'm170-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('placeholder', '搜索页面、配色或操作…');
    input.setAttribute('aria-label', '搜索命令');
    head.appendChild(input);

    var kbd = doc.createElement('span');
    kbd.className = 'm170-kbd';
    kbd.textContent = 'ESC';
    head.appendChild(kbd);

    panel.appendChild(head);

    listEl = doc.createElement('div');
    listEl.className = 'm170-list';
    listEl.setAttribute('role', 'listbox');
    listEl.setAttribute('aria-label', '命令列表');
    panel.appendChild(listEl);

    var foot = doc.createElement('div');
    foot.className = 'm170-foot';
    foot.innerHTML = '<b>&#8593;&#8595;</b> 选择<span class="m170-dot">&middot;</span>' +
      '<b>Enter</b> 执行<span class="m170-dot">&middot;</span>' +
      '<b>Esc</b> 关闭';
    panel.appendChild(foot);

    mask.appendChild(panel);
    doc.body.appendChild(mask);

    /* ---- 事件（都挂在外壳上，列表重绘不产生新监听） ---- */
    mask.addEventListener('click', function (e) {
      if (e.target === mask) close();
    });

    input.addEventListener('input', function () { render(); });

    input.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      var k = e.key;
      if (k === 'ArrowDown') { e.preventDefault(); setSel(sel + 1); }
      else if (k === 'ArrowUp') { e.preventDefault(); setSel(sel - 1); }
      else if (k === 'Enter') {
        e.preventDefault();
        if (sel >= 0) runAt(sel);
      } else if (k === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (k === 'Tab') {
        e.preventDefault();   /* 焦点锁在输入框里 */
      }
    });

    listEl.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== listEl && !t.classList.contains('m170-item')) t = t.parentNode;
      if (!t || t === listEl) return;
      var idx = parseInt(t.getAttribute('data-idx'), 10);
      if (!isNaN(idx)) runAt(idx);
    });

    listEl.addEventListener('mouseover', function (e) {
      var t = e.target;
      while (t && t !== listEl && !t.classList.contains('m170-item')) t = t.parentNode;
      if (!t || t === listEl) return;
      var idx = parseInt(t.getAttribute('data-idx'), 10);
      if (!isNaN(idx) && idx !== sel) setSel(idx);
    });
  }

  /* ------------------------------------------------------------------
   * 全局快捷键
   * ------------------------------------------------------------------ */
  function onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;

    if (isOpen && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }

    var k = (e.key || '').toLowerCase();
    if (k !== 'k') return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isOpen) open();          /* 已经开着就忽略，不叠第二层 */
  }

  function bindGlobal() {
    if (window.__m170KeyBound) return;
    window.__m170KeyBound = true;
    doc.addEventListener('keydown', onKey, true);
  }

  function init() {
    try {
      injectCss();
      buildShell();
      bindGlobal();
    } catch (e) {
      console.warn('[patch 170]', e);
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
console.log('[patch 170] ready');
