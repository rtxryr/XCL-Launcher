/* ------------------------------------------------------------------
 * patch/240-account.js — 账号设置（多离线账号）+ 主页账号详情 + 顶部搜索
 *
 * 三块：
 *   1) 设置页在「通用」与「外观设置」之间插入「账号设置」标签：
 *      多账号列表、切换、重命名、换头像、删除、新增离线账号；
 *      在线（正版）账号不在本页管理，点了会提示去侧栏的「正版登录」。
 *   2) 主页上方的账号卡点击后弹「账号详情」：查看信息 + 快速切换 + 去设置。
 *   3) 顶部搜索框真正能用：搜版本（已安装）与设置项，回车直达。
 *
 * 数据：
 *   mc.accounts = [{ id, name, type:'offline', avatar:dataURL|null, createdAt, lastUsedAt }]
 *   mc.activeAccount = 当前账号 id
 *   mc.user = 当前账号名（沿用旧键，保证原有代码路径与昵称逻辑不变）
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch240) return;
  window.__xclPatch240 = true;

  var doc = document;
  var LS_ACCTS = 'mc.accounts';
  var LS_ACTIVE = 'mc.activeAccount';
  var LS_USER = 'mc.user';
  var MAX_ACCOUNTS = 20;
  var MAX_NAME = 16;

  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function uid() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function initialOf(name) {
    var arr = Array.from(String(name || '').trim());
    if (!arr.length) return '?';
    return /[a-z]/i.test(arr[0]) ? arr[0].toUpperCase() : arr[0];
  }
  function toast(msg) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
    var t = doc.createElement('div');
    t.className = 'm240-toast';
    t.textContent = msg;
    doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }
  function bridge(ch, p) {
    if (!window.FMBridge || typeof window.FMBridge.invoke !== 'function' || window.FMBridge.available === false) {
      return Promise.resolve(null);
    }
    return Promise.resolve(window.FMBridge.invoke(ch, p || {})).catch(function () { return null; });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ---------------- 数据层 ---------------- */
  function readList() {
    try {
      var j = JSON.parse(localStorage.getItem(LS_ACCTS) || '[]');
      return Array.isArray(j) ? j.filter(function (x) { return x && x.id && x.name; }) : [];
    } catch (e) { return []; }
  }
  function writeList(list) {
    try { localStorage.setItem(LS_ACCTS, JSON.stringify(list)); } catch (e) {}
  }
  function activeId() {
    try { return localStorage.getItem(LS_ACTIVE) || ''; } catch (e) { return ''; }
  }
  function setActiveId(id) {
    try { localStorage.setItem(LS_ACTIVE, String(id || '')); } catch (e) {}
  }
  function activeAccount() {
    var list = readList();
    var id = activeId();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || null;
  }

  /** 首次使用：把现有昵称（mc.user）迁移成一个离线账号，别丢用户现在的名字 */
  function seed() {
    var list = readList();
    if (list.length) return list;
    var name = '';
    try { name = String(localStorage.getItem(LS_USER) || '').trim(); } catch (e) {}
    if (!name) name = '玩家';
    if (Array.from(name).length > MAX_NAME) name = Array.from(name).slice(0, MAX_NAME).join('');
    var acc = { id: uid(), name: name, type: 'offline', avatar: null, createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() };
    list = [acc];
    writeList(list);
    setActiveId(acc.id);
    return list;
  }

  /* ---------------- 同步到界面各处 ---------------- */
  function applyAvatar(el, acc) {
    if (!el) return;
    if (acc && acc.avatar) {
      el.textContent = '';
      el.style.backgroundImage = 'url("' + acc.avatar + '")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.classList.add('m240-img');
    } else {
      el.style.backgroundImage = '';
      el.classList.remove('m240-img');
      el.textContent = initialOf(acc ? acc.name : '');
    }
  }

  function syncUi() {
    var acc = activeAccount();
    if (!acc) return;
    try { localStorage.setItem(LS_USER, acc.name); } catch (e) {}

    var un = doc.getElementById('userName');
    if (un) un.textContent = acc.name;
    applyAvatar(doc.getElementById('avatarTxt'), acc);
    applyAvatar(doc.getElementById('upAvatar'), acc);

    /* 侧栏副标题：原来固定写「正版账号已登录」 */
    var sub = doc.querySelector('#userBtn .rail-user > span');
    if (sub) sub.textContent = acc.type === 'online' ? '正版账号已登录' : '离线账号 · ' + acc.name;

    /* 主页账号卡：只在没有在线账号接管显示时才改，避免和登录模块打架 */
    var vaList = doc.getElementById('vaList');
    var hasOnline = vaList && vaList.querySelector('.va-item');
    if (!hasOnline) {
      var vn = doc.getElementById('vaName');
      if (vn) vn.textContent = acc.name;
      var badge = doc.getElementById('vaBadge');
      var badgeTxt = doc.getElementById('vaBadgeTxt');
      if (badge) badge.hidden = false;
      if (badgeTxt) badgeTxt.textContent = '离线';
      var vs = doc.getElementById('vaSub');
      if (vs) vs.textContent = '当前账号 · 可在「设置 → 账号」里管理';
      applyAvatar(doc.querySelector('#vaPanel .va-ph'), null);
    }

    renderPane();
    renderHomePanel();
  }

  function switchTo(id) {
    var list = readList();
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { hit = list[i]; break; }
    }
    if (!hit) return;
    hit.lastUsedAt = new Date().toISOString();
    setActiveId(hit.id);
    writeList(list);
    syncUi();
    toast('已切换到 ' + hit.name);
  }

  /* ---------------- 设置页：账号标签 ---------------- */
  var S = { name: '', avatar: null, editingId: '' };

  function injectCss() {
    if (doc.getElementById('patch-240-style')) return;
    var css = [
      '#m240Card .m240-row{display:flex;align-items:center;gap:12px;padding:11px 2px;border-top:1px solid var(--stroke)}',
      '#m240Card .m240-row:first-of-type{border-top:0}',
      '#m240Card .m240-ava{width:38px;height:38px;flex:0 0 auto;border-radius:var(--r-m);display:grid;place-items:center;',
      '  font-weight:700;font-size:14px;color:var(--accent-ink);background:linear-gradient(145deg,var(--accent-l),var(--accent));',
      '  background-size:cover;background-position:center;border:1.6px solid var(--panel-3)}',
      '#m240Card .m240-meta{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '#m240Card .m240-meta b{font-size:12.5px;font-weight:600;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#m240Card .m240-meta span{font-size:11px;color:var(--txt-3)}',
      '#m240Card .m240-tag{flex:0 0 auto;font-size:10px;padding:1px 7px;border-radius:999px;',
      '  color:var(--accent);background:var(--accent-soft,rgba(120,200,160,.14))}',
      '#m240Card .m240-acts{flex:0 0 auto;display:flex;gap:6px}',
      '#m240Card .m240-btn{padding:5px 12px;border-radius:var(--r-pill);border:1px solid var(--stroke);',
      '  background:var(--panel-2);color:var(--txt-2);font-size:11.5px;cursor:pointer;transition:color .18s,border-color .18s}',
      '#m240Card .m240-btn:hover{color:var(--txt);border-color:var(--accent)}',
      '#m240Card .m240-btn.on{border-color:var(--accent);color:var(--accent)}',
      '#m240Card .m240-btn.danger:hover{color:#e0705f;border-color:#e0705f}',
      '#m240Card .m240-add{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}',
      '#m240Card .m240-add button{flex:0 0 auto;padding:8px 16px;border-radius:var(--r-pill);font-size:12px;cursor:pointer;',
      '  border:1px solid var(--stroke);background:var(--panel-2);color:var(--txt-2)}',
      '#m240Card .m240-add button.primary{background:var(--accent);border-color:transparent;color:var(--on-accent,#08120e);font-weight:600}',
      '#m240Card .m240-add button[disabled]{opacity:.45;pointer-events:none}',
      '#m240Card .m240-note{margin:10px 0 0;font-size:11px;line-height:1.7;color:var(--txt-3)}',

      /* 编辑 / 新增弹窗 */
      '.m240-mask{position:fixed;inset:0;z-index:975;display:grid;place-items:center;padding:24px;',
      '  background:rgba(6,12,10,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
      '.m240-mask[hidden]{display:none}',
      '.m240-dlg{width:min(460px,100%);border-radius:var(--r-xl);padding:22px 24px 18px;color:var(--txt);',
      '  background:linear-gradient(165deg,var(--glass-a),var(--glass-b)),var(--panel-2);border:1px solid var(--stroke);',
      '  box-shadow:0 40px 90px -40px var(--shadow-2)}',
      '.m240-dlg h3{margin:0 0 14px;font-size:16px;letter-spacing:-.01em}',
      '.m240-fld{display:flex;align-items:center;gap:12px;margin-bottom:14px}',
      '.m240-prev{width:56px;height:56px;flex:0 0 auto;border-radius:var(--r-m);display:grid;place-items:center;',
      '  font-size:20px;font-weight:700;color:var(--accent-ink);background:linear-gradient(145deg,var(--accent-l),var(--accent));',
      '  background-size:cover;background-position:center;border:1.6px solid var(--panel-3);cursor:pointer;overflow:hidden}',
      '.m240-inp{flex:1 1 auto;height:40px;padding:0 14px;border-radius:var(--r-m);background:var(--panel);',
      '  border:1px solid var(--stroke);color:var(--txt);font-size:13px;outline:none}',
      '.m240-inp:focus{border-color:var(--accent)}',
      '.m240-hint{margin:-6px 0 12px;font-size:11px;color:var(--txt-3)}',
      '.m240-foot{display:flex;justify-content:flex-end;gap:9px}',
      '.m240-foot button{padding:8px 18px;border-radius:var(--r-pill);font-size:12.5px;cursor:pointer;',
      '  border:1px solid var(--stroke);background:var(--panel-2);color:var(--txt-2)}',
      '.m240-foot button.primary{background:var(--accent);border-color:transparent;color:var(--on-accent,#08120e);font-weight:600}',
      '.m240-foot button[disabled]{opacity:.45;pointer-events:none}',

      /* 主页账号详情面板 */
      '.m240-pop{position:fixed;z-index:700;width:min(300px,calc(100vw - 40px));border-radius:var(--r-l);padding:16px 16px 12px;',
      '  background:linear-gradient(168deg,var(--glass-a),var(--glass-b)),var(--panel-2);border:1px solid var(--stroke-2);',
      '  box-shadow:0 32px 70px -36px var(--shadow-2);color:var(--txt)}',
      '.m240-pop[hidden]{display:none}',
      '.m240-pop .m240-ph{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--stroke)}',
      '.m240-pop .m240-ava{width:44px;height:44px;border-radius:var(--r-2xl);display:grid;place-items:center;font-size:16px;font-weight:700;',
      '  color:var(--accent-ink);background:linear-gradient(145deg,var(--accent-l),var(--accent));background-size:cover;background-position:center}',
      '.m240-pop .m240-pm{min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.m240-pop .m240-pm b{font-size:13.5px}',
      '.m240-pop .m240-pm span{font-size:11px;color:var(--txt-3)}',
      '.m240-pop .m240-kv{display:flex;justify-content:space-between;font-size:11.5px;color:var(--txt-3);padding:5px 0}',
      '.m240-pop .m240-kv b{color:var(--txt-2);font-weight:600}',
      '.m240-pop .m240-pa{display:flex;gap:7px;margin-top:10px}',
      '.m240-pop .m240-pa button{flex:1 1 0;padding:8px 0;border-radius:var(--r-pill);font-size:11.5px;cursor:pointer;',
      '  border:1px solid var(--stroke);background:var(--panel-2);color:var(--txt-2)}',
      '.m240-pop .m240-pa button.primary{background:var(--accent);border-color:transparent;color:var(--on-accent,#08120e);font-weight:600}',

      /* 顶部搜索面板 */
      '.m240-sr{position:fixed;z-index:760;width:min(560px,calc(100vw - 40px));max-height:64vh;overflow:auto;',
      '  border-radius:var(--r-l);padding:8px;background:linear-gradient(168deg,var(--glass-a),var(--glass-b)),var(--panel-2);',
      '  border:1px solid var(--stroke-2);box-shadow:0 36px 80px -40px var(--shadow-2)}',
      '.m240-sr[hidden]{display:none}',
      '.m240-sr .m240-sh{font-size:10.5px;color:var(--txt-3);padding:8px 10px 4px;letter-spacing:.04em}',
      '.m240-sr .m240-si{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:var(--r-m);cursor:pointer}',
      '.m240-sr .m240-si.on{background:var(--panel-3,rgba(255,255,255,.07))}',
      '.m240-sr .m240-si b{font-size:12.5px;font-weight:600;color:var(--txt)}',
      '.m240-sr .m240-si span{font-size:11px;color:var(--txt-3)}',
      '.m240-sr .m240-si .m240-sm{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.m240-sr .m240-hl{background:var(--accent-soft,rgba(120,200,160,.18));box-shadow:0 0 0 2px var(--accent) inset;transition:none}',
      '.m240-empty{padding:18px 12px;text-align:center;font-size:12px;color:var(--txt-3)}',
      '.m240-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:9999;padding:10px 18px;',
      '  border-radius:var(--r-pill);background:var(--panel-2);color:var(--txt);border:1px solid var(--stroke);font-size:12.5px}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-240-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  function tabButton() {
    var seg = doc.getElementById('setSeg');
    if (!seg) return null;
    var b = seg.querySelector('button[data-tab="account"]');
    if (b) return b;
    b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('data-tab', 'account');
    b.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="8.4" r="3.4"/><path d="M5.2 19.4c0-3.4 3-5.4 6.8-5.4s6.8 2 6.8 5.4"/></svg>' +
      '账号设置';
    var anchor = seg.querySelector('button[data-tab="appearance"]');
    seg.insertBefore(b, anchor || null);

    /* 目标顺序：通用 → 账号 → 外观 → 性能 → 更新 → 关于。
       225 号补丁把「性能」插在了外观前面，这里统一挪到外观后面。 */
    var perf = seg.querySelector('button[data-tab="perf"]');
    var appearance = seg.querySelector('button[data-tab="appearance"]');
    if (perf && appearance && perf.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING) {
      seg.insertBefore(perf, appearance.nextSibling);
    }

    b.addEventListener('click', function () {
      $$('#setSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      $$('#page-settings > div[id^="tab-"]').forEach(function (d) {
        d.hidden = d.id !== 'tab-account';
      });
      try { localStorage.setItem('mc.setTab', 'account'); } catch (e) {}
      renderPane();
    });
    return b;
  }

  function ensurePane() {
    var page = doc.getElementById('page-settings');
    if (!page) return null;
    var pane = doc.getElementById('tab-account');
    if (pane) return pane;
    pane = doc.createElement('div');
    pane.id = 'tab-account';
    pane.hidden = true;
    page.appendChild(pane);
    return pane;
  }

  function renderPane() {
    var pane = ensurePane();
    if (!pane) return;
    var list = readList();
    var act = activeAccount();
    var actId = act ? act.id : '';

    var html =
      '<div class="glass list-card" id="m240Card" style="max-width:var(--content-max);margin-bottom:16px">' +
        '<div class="group-title">我的账号<span class="m240-tag" style="margin-left:8px">' + list.length + ' / ' + MAX_ACCOUNTS + '</span></div>';

    if (!list.length) {
      html += '<p class="m240-note">还没有账号。添加一个离线账号就能开始游戏。</p>';
    } else {
      html += list.map(function (a) {
        var on = a.id === actId;
        return '<div class="m240-row" data-id="' + esc(a.id) + '">' +
          '<span class="m240-ava"' + (a.avatar ? ' style="background-image:url(' + esc(a.avatar) + ');background-size:cover;background-position:center"' : '') + '>' +
          (a.avatar ? '' : esc(initialOf(a.name))) + '</span>' +
          '<span class="m240-meta"><b>' + esc(a.name) + '</b>' +
            '<span>' + (a.type === 'online' ? '正版账号' : '离线账号') + ' · 创建于 ' + fmtDate(a.createdAt) + '</span></span>' +
          (on ? '<span class="m240-tag">当前</span>' : '') +
          '<span class="m240-acts">' +
            (on ? '' : '<button type="button" class="m240-btn" data-act="use">切换</button>') +
            '<button type="button" class="m240-btn" data-act="edit">编辑</button>' +
            (list.length > 1 ? '<button type="button" class="m240-btn danger" data-act="del">删除</button>' : '') +
          '</span>' +
        '</div>';
      }).join('');
    }

    html +=
        '<div class="m240-add">' +
          '<button type="button" class="primary" data-act="add">+ 添加离线账号</button>' +
          '<button type="button" data-act="online" title="当前版本暂不支持在此管理在线账号">+ 添加正版账号</button>' +
        '</div>' +
        '<p class="m240-note">离线账号只在本机生效，可以随便改名换头像；正版（在线）账号请用侧栏的「正版登录」添加，本页暂不支持管理。切换账号后，启动游戏用的玩家名会跟着变。</p>' +
      '</div>';

    pane.innerHTML = html;

    var card = pane.querySelector('#m240Card');
    if (!card || card.__bound) return;
    card.__bound = true;
    card.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var row = btn.closest('.m240-row');
      var id = row ? row.getAttribute('data-id') : '';

      if (act === 'add') { openEditor(''); return; }
      if (act === 'online') { toast('在线账号暂不支持在此管理，请用侧栏的「正版登录」'); return; }
      if (act === 'use') { switchTo(id); return; }
      if (act === 'edit') { openEditor(id); return; }
      if (act === 'del') {
        var list = readList();
        var target = null;
        for (var i = 0; i < list.length; i++) if (list[i].id === id) target = list[i];
        if (!target) return;
        if (!window.confirm('删除账号「' + target.name + '」？这个操作不可撤销。')) return;
        var next = list.filter(function (x) { return x.id !== id; });
        writeList(next);
        if (activeId() === id) setActiveId(next.length ? next[0].id : '');
        syncUi();
        toast('已删除 ' + target.name);
      }
    });
  }

  /* ---------------- 新增 / 编辑弹窗 ---------------- */
  function openEditor(id) {
    injectCss();
    var list = readList();
    var acc = null;
    if (id) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) acc = list[i];
    }
    S.editingId = id || '';
    S.name = acc ? acc.name : '';
    S.avatar = acc ? acc.avatar : null;

    var old = doc.getElementById('m240Modal');
    if (old) old.remove();

    var mask = doc.createElement('div');
    mask.className = 'm240-mask';
    mask.id = 'm240Modal';
    mask.innerHTML =
      '<div class="m240-dlg" role="dialog" aria-modal="true">' +
        '<h3>' + (acc ? '编辑账号' : '添加离线账号') + '</h3>' +
        '<div class="m240-fld">' +
          '<span class="m240-prev" id="m240Prev" title="点击换头像"></span>' +
          '<input class="m240-inp" id="m240Name" type="text" maxlength="16" placeholder="账号名称（1~16 个字符）">' +
          '<input type="file" id="m240File" accept="image/*" hidden>' +
        '</div>' +
        '<p class="m240-hint">点头像可以换一张图片，会自动压到 128×128 存在本机，不会上传。</p>' +
        '<div class="m240-foot">' +
          '<button type="button" data-act="cancel">取消</button>' +
          '<button type="button" class="primary" data-act="save">保存</button>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(mask);

    var nameEl = mask.querySelector('#m240Name');
    var prev = mask.querySelector('#m240Prev');
    var file = mask.querySelector('#m240File');

    function paintPrev() {
      if (S.avatar) {
        prev.textContent = '';
        prev.style.backgroundImage = 'url("' + S.avatar + '")';
      } else {
        prev.style.backgroundImage = '';
        prev.textContent = initialOf(S.name || '?');
      }
    }
    nameEl.value = S.name;
    paintPrev();
    setTimeout(function () { nameEl.focus(); nameEl.select(); }, 60);

    nameEl.addEventListener('input', function () {
      S.name = nameEl.value;
      if (!S.avatar) paintPrev();
    });
    prev.addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          try {
            var size = 128;
            var c = doc.createElement('canvas');
            c.width = size; c.height = size;
            var g = c.getContext('2d');
            var s = Math.min(img.width, img.height);
            g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
            S.avatar = c.toDataURL('image/png');
            paintPrev();
          } catch (e) {
            S.avatar = String(reader.result || '');
            paintPrev();
          }
        };
        img.onerror = function () { toast('这张图片读不出来'); };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(f);
    });

    function close() { mask.remove(); }
    mask.addEventListener('click', function (e) {
      if (e.target === mask) { close(); return; }
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'cancel') { close(); return; }
      if (act !== 'save') return;

      var name = String(nameEl.value || '').trim();
      var len = Array.from(name).length;
      if (len < 1 || len > MAX_NAME) { toast('名称需要 1~16 个字符'); nameEl.focus(); return; }

      var arr = readList();
      if (S.editingId) {
        for (var i = 0; i < arr.length; i++) {
          if (arr[i].id === S.editingId) {
            arr[i].name = name;
            arr[i].avatar = S.avatar;
            arr[i].lastUsedAt = new Date().toISOString();
          }
        }
        writeList(arr);
        if (activeId() === S.editingId) { /* 当前账号改名要立刻同步 */ }
        close();
        syncUi();
        toast('已保存');
        return;
      }

      if (arr.length >= MAX_ACCOUNTS) { toast('最多 ' + MAX_ACCOUNTS + ' 个账号'); return; }
      var acc = {
        id: uid(), name: name, type: 'offline', avatar: S.avatar,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      arr.push(acc);
      writeList(arr);
      if (!activeId()) setActiveId(acc.id);
      close();
      syncUi();
      toast('已添加 ' + name);
    });
  }

  /* ---------------- 主页账号详情面板 ---------------- */
  function renderHomePanel() {
    var pop = doc.getElementById('m240HomePop');
    if (!pop || pop.hidden) return;
    paintHomePanel(pop);
  }

  function paintHomePanel(pop) {
    var acc = activeAccount();
    if (!acc) return;
    var list = readList();
    pop.innerHTML =
      '<div class="m240-ph">' +
        '<span class="m240-ava"' + (acc.avatar ? ' style="background-image:url(' + esc(acc.avatar) + ');background-size:cover;background-position:center"' : '') + '>' +
        (acc.avatar ? '' : esc(initialOf(acc.name))) + '</span>' +
        '<span class="m240-pm"><b>' + esc(acc.name) + '</b>' +
          '<span>' + (acc.type === 'online' ? '正版账号' : '离线账号') + ' · 共 ' + list.length + ' 个账号</span></span>' +
      '</div>' +
      '<div class="m240-kv"><span>创建时间</span><b>' + fmtDate(acc.createdAt) + '</b></div>' +
      '<div class="m240-kv"><span>最近使用</span><b>' + fmtDate(acc.lastUsedAt) + '</b></div>' +
      '<div class="m240-pa">' +
        '<button type="button" data-act="switch" class="primary">切换账号</button>' +
        '<button type="button" data-act="settings">账号设置</button>' +
      '</div>';

    pop.onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'switch') {
        var others = readList().filter(function (x) { return x.id !== activeAccount().id; });
        if (!others.length) { toast('只有一个账号，先去「账号设置」里加一个'); return; }
        var next = others[0];
        switchTo(next.id);
        paintHomePanel(pop);
        return;
      }
      if (act === 'settings') {
        hideHomePanel();
        var rail = doc.querySelector('.rail-btn[data-page="settings"]');
        if (rail) rail.click();
        setTimeout(function () {
          var b2 = doc.querySelector('#setSeg button[data-tab="account"]');
          if (b2) b2.click();
        }, 260);
      }
    };
  }

  function hideHomePanel() {
    var pop = doc.getElementById('m240HomePop');
    if (pop) pop.hidden = true;
  }

  function showHomePanel(anchor) {
    injectCss();
    var pop = doc.getElementById('m240HomePop');
    if (!pop) {
      pop = doc.createElement('div');
      pop.className = 'm240-pop';
      pop.id = 'm240HomePop';
      pop.hidden = true;
      doc.body.appendChild(pop);
    }
    paintHomePanel(pop);
    pop.hidden = false;
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 10;
    var left = Math.min(Math.max(12, r.left), window.innerWidth - 312);
    if (top + 240 > window.innerHeight) top = Math.max(12, r.top - 250);
    pop.style.top = Math.round(top) + 'px';
    pop.style.left = Math.round(left) + 'px';
  }

  function bindHome() {
    var head = doc.querySelector('#page-home .va-head') || doc.querySelector('.va-head');
    if (!head || head.__m240) return;
    head.__m240 = true;
    head.addEventListener('click', function (e) {
      /* 登录/展开按钮交给原有逻辑，只在点账号信息区时弹详情 */
      if (e.target.closest && e.target.closest('.va-toggle')) return;
      e.preventDefault();
      e.stopPropagation();
      showHomePanel(head);
    }, true);

    doc.addEventListener('click', function (e) {
      var pop = doc.getElementById('m240HomePop');
      if (!pop || pop.hidden) return;
      if (pop.contains(e.target)) return;
      if (head.contains(e.target)) return;
      pop.hidden = true;
    });
  }

  /* ---------------- 顶部搜索 ---------------- */
  var SEARCH_ITEMS = [
    { t: '内存分配', s: '内存 分配 上限 Xmx', tab: 'general', sel: '#memCard, #tab-general .list-card' },
    { t: '最大 CPU', s: 'cpu 核心 线程 亲和', tab: 'perf', sel: '#m225CpuCard' },
    { t: '独显优先', s: '显卡 gpu 独显 高性能', tab: 'perf', sel: '#m225GpuCard' },
    { t: 'Super X 引擎', s: 'superx 多线程 性能 优化', tab: 'perf', sel: '#m225Sx' },
    { t: '内存优化', s: '内存 清理 后台 释放', tab: 'perf', sel: '#m265Card' },
    { t: '轻量模式', s: 'lite 轻量 自动', tab: 'perf', sel: '#tab-perf .list-card' },
    { t: '账号设置', s: '账号 account 切换 头像 昵称', tab: 'account', sel: '#m240Card' },
    { t: '界面圆角', s: '圆角 radius 形状', tab: 'appearance', sel: '#m230Card' },
    { t: '壁纸 / 背景', s: '背景 壁纸 图片 视频 wallpaper', tab: 'appearance', sel: '#m220CardWrap' },
    { t: '配色方案', s: '主题 配色 颜色 theme', tab: 'appearance', sel: '#tab-appearance .list-card' },
    { t: '界面动效', s: '动效 动画 motion 速度 幅度', tab: 'appearance', sel: '#motionCard' },
    { t: '角色皮肤与装扮', s: '皮肤 装扮 立体 3d', tab: 'appearance', sel: '#skinHead' },
    { t: '更新日志', s: '更新 版本 changelog', tab: 'update', sel: '#tab-update .list-card' },
    { t: '内测功能入口', s: '内测 beta 日志 上传', tab: 'about', sel: '#m260Card' },
  ];

  var srIdx = 0;
  var srRows = [];

  function goSettings(tab, sel) {
    var rail = doc.querySelector('.rail-btn[data-page="settings"]');
    if (rail) rail.click();
    setTimeout(function () {
      var b = doc.querySelector('#setSeg button[data-tab="' + tab + '"]');
      if (b) b.click();
      setTimeout(function () {
        var el = sel ? doc.querySelector(sel) : null;
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('m240-hl');
        setTimeout(function () { el.classList.remove('m240-hl'); }, 1300);
      }, 260);
    }, 220);
  }

  function versionResults(q) {
    var out = [];
    var seen = {};
    $$('#verList .ver, #verList [data-ver]').forEach(function (el) {
      var id = el.getAttribute('data-ver') || (el.querySelector('.ver-name, b') || {}).textContent || '';
      id = String(id).trim();
      if (!id || seen[id]) return;
      seen[id] = 1;
      if (q && id.toLowerCase().indexOf(q) < 0) return;
      out.push({ kind: 'ver', t: id, s: '已安装版本', id: id });
    });
    return out.slice(0, 6);
  }

  function doSearch(q) {
    var list = [];
    var term = q.trim().toLowerCase();
    if (!term) return list;

    versionResults(term).forEach(function (v) { list.push(v); });

    SEARCH_ITEMS.forEach(function (it) {
      var hay = (it.t + ' ' + it.s).toLowerCase();
      if (hay.indexOf(term) >= 0) list.push({ kind: 'set', t: it.t, s: '设置 · ' + it.t, tab: it.tab, sel: it.sel });
    });

    return list.slice(0, 12);
  }

  function ensureSearch() {
    var panel = doc.getElementById('m240Search');
    if (!panel) {
      panel = doc.createElement('div');
      panel.className = 'm240-sr';
      panel.id = 'm240Search';
      panel.hidden = true;
      doc.body.appendChild(panel);
    }
    return panel;
  }

  function paintSearch(q) {
    var panel = ensureSearch();
    srRows = doSearch(q);
    srIdx = 0;
    if (!srRows.length) {
      panel.innerHTML = '<div class="m240-empty">没有匹配的版本或设置项</div>';
    } else {
      var html = '<div class="m240-sh">找到 ' + srRows.length + ' 项 · ↑↓ 选择，回车直达</div>';
      html += srRows.map(function (r, i) {
        return '<div class="m240-si' + (i === srIdx ? ' on' : '') + '" data-i="' + i + '">' +
          '<span class="m240-sm"><b>' + esc(r.t) + '</b><span>' + esc(r.s) + '</span></span>' +
        '</div>';
      }).join('');
      panel.innerHTML = html;
    }
    panel.hidden = false;
    var input = doc.getElementById('searchInput');
    if (input) {
      var r = input.getBoundingClientRect();
      panel.style.top = Math.round(r.bottom + 8) + 'px';
      panel.style.left = Math.round(Math.max(12, r.left - 40)) + 'px';
    }
  }

  function moveSearch(d) {
    if (!srRows.length) return;
    srIdx = (srIdx + d + srRows.length) % srRows.length;
    $$('#m240Search .m240-si').forEach(function (el, i) { el.classList.toggle('on', i === srIdx); });
  }

  function pickSearch(i) {
    var r = srRows[i];
    if (!r) return;
    var panel = doc.getElementById('m240Search');
    if (panel) panel.hidden = true;
    var input = doc.getElementById('searchInput');
    if (input) input.blur();

    if (r.kind === 'ver') {
      goSettings('general', null);
      /* 版本直达安装页并高亮 */
      var rail = doc.querySelector('.rail-btn[data-page="install"]');
      if (rail) rail.click();
      setTimeout(function () {
        $$('#verList .ver').forEach(function (el) {
          var id = el.getAttribute('data-ver') || '';
          if (id && id === r.id) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            el.classList.add('m240-hl');
            setTimeout(function () { el.classList.remove('m240-hl'); }, 1300);
          }
        });
      }, 420);
      return;
    }
    goSettings(r.tab, r.sel);
  }

  function bindSearch() {
    var input = doc.getElementById('searchInput');
    if (!input || input.__m240) return;
    input.__m240 = true;

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (!q) { var p = doc.getElementById('m240Search'); if (p) p.hidden = true; return; }
      paintSearch(q);
    });

    input.addEventListener('keydown', function (e) {
      var panel = doc.getElementById('m240Search');
      var open = panel && !panel.hidden;
      if (e.key === 'ArrowDown') { if (open) { e.preventDefault(); moveSearch(1); } }
      else if (e.key === 'ArrowUp') { if (open) { e.preventDefault(); moveSearch(-1); } }
      else if (e.key === 'Enter') { if (open && srRows.length) { e.preventDefault(); pickSearch(srIdx); } }
      else if (e.key === 'Escape') { if (open) { panel.hidden = true; } input.blur(); }
    });

    doc.addEventListener('click', function (e) {
      var panel = doc.getElementById('m240Search');
      if (!panel || panel.hidden) return;
      var item = e.target.closest && e.target.closest('#m240Search .m240-si');
      if (item) { pickSearch(Number(item.getAttribute('data-i'))); return; }
      if (e.target === input || input.contains(e.target)) return;
      panel.hidden = true;
    });
  }

  /* ---------------- 挂载 ---------------- */
  function mount() {
    if (!doc.getElementById('page-settings')) return;
    injectCss();
    ensurePane();
    var b = tabButton();
    /* 已经停在账号页时（比如刷新后恢复的标签）要把内容画出来 */
    if (b && b.classList.contains('on')) renderPane();
    bindHome();
    bindSearch();
  }

  seed();
  syncUi();

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { setTimeout(mount, 700); });
  } else {
    setTimeout(mount, 700);
  }
  setTimeout(mount, 1800);
  setTimeout(mount, 4000);
  setTimeout(mount, 8000);
})();
