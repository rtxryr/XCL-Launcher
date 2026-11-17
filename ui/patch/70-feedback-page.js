/* ------------------------------------------------------------------
 * patch/70-feedback-page.js — 侧栏「反馈」页 + 诊断包面板 + 异常退出兜底
 * 作用域：只新增一个 .rail-btn[data-page="feedback"]（插在「设置」之前）、
 *         一个 #page-feedback 页面（append 到 #pages）、一个 #fbpConfirm 弹窗，
 *         以及在 #taskCard 里追加 / 守护一行 #fbpExitRow（游戏异常退出时）。
 *         不改 index.html、不改其它补丁、不写死颜色、不用 emoji 图标。
 * 数据来源：diag:status / diag:pack / diag:reveal / diag:clear + diag:ready 事件。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }

  var CSS_ID   = 'patch-70-style';
  var PAGE_ID  = 'page-feedback';
  var PAGE_KEY = 'feedback';
  var SITE_URL = 'https://rj-app-download.app.workbuddy.host/xcl/?sharecode=4XX2XCSHDN#changelog';
  var MAX_NOTE = 500;
  var TIP_IDLE = '把诊断包里的 summary.txt 一起发过去更快';
  var TIP_COPIED = '已复制，粘贴过去就行';
  var MAX_SHOW = 8;
  var HOLD_MS  = 60000;

  var REASON = {
    'game-crash': '游戏异常退出',
    'main-exception': '启动器异常',
    'renderer-gone': '界面崩溃',
    'manual': '手动打包'
  };

  /* ---------------- 图标（统一 24 视框、1.7 描边，无 emoji） ---------------- */
  var P_CHAT    = '<path d="M20.4 11.6c0 3.6-3.8 6.5-8.4 6.5-1 0-1.9-.1-2.8-.4L5 19.7l1.2-3.3a6.2 6.2 0 0 1-2.6-4.8c0-3.6 3.8-6.5 8.4-6.5s8.4 2.9 8.4 6.5Z"/><path d="M8.8 11.5h.01M12 11.5h.01M15.2 11.5h.01"/>';
  var P_ARCHIVE = '<rect x="3.7" y="4.7" width="16.6" height="4.6" rx="1.6"/><path d="M5.5 9.3v8.3a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9.3"/><path d="M10 13.2h4"/>';
  var P_FOLDER  = '<path d="M3.6 7.6a2 2 0 0 1 2-2h3.2l1.8 2.1h5.8a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z"/>';
  var P_TRASH   = '<path d="M4.7 7.4h14.6"/><path d="M9.5 7.4V5.7a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="M6.7 7.4l.8 10.9a1.7 1.7 0 0 0 1.7 1.6h5.6a1.7 1.7 0 0 0 1.7-1.6l.8-10.9"/><path d="M10.5 11v5.1M13.5 11v5.1"/>';
  var P_COPY    = '<rect x="8.7" y="8.7" width="10.6" height="11.6" rx="2.4"/><path d="M15.3 8.7V6.3a2.2 2.2 0 0 0-2.2-2.2H6.5a2.2 2.2 0 0 0-2.2 2.2v8.4a2.2 2.2 0 0 0 2.2 2.2h1.6"/>';
  var P_REFRESH = '<path d="M20.2 12a8.2 8.2 0 1 1-2.5-5.9"/><path d="M20.3 4.6v4.7h-4.7"/>';
  var P_LINK    = '<path d="M13.8 4.6h5.6v5.6"/><path d="M19.4 4.6l-7.2 7.2"/><path d="M18.2 14v4.2a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2V8.4a2 2 0 0 1 2-2h4.1"/>';
  var P_CLOSE   = '<path d="M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4"/>';
  var P_WARN    = '<path d="M12 4.8 20 19H4z"/><path d="M12 9.9v4.2"/><path d="M12 16.8h.01"/>';
  var P_SPIN    = '<path d="M12 4.4a7.6 7.6 0 1 1-7.6 7.6"/>';

  function icon(inner, cls) {
    return '<svg' + (cls ? ' class="' + cls + '"' : '') +
      ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  /* ---------------- 状态 ---------------- */
  var state = {
    items: [],
    last: null,
    busy: false,
    loading: false,
    note: '',
    type: '启动失败',
    tipTimer: 0,
    diagBound: false,
    launchBound: false,
    cancelBound: false,
    confirmCb: null,
    escBound: false,
    holdUntil: 0,
    holdTimer: 0,
    mo: null,
    userClosed: false,
    exitCode: null
  };

  /* ---------------- 桥 ---------------- */
  function hasBridge() {
    return !!(window.FMBridge && window.FMBridge.available !== false &&
      typeof window.FMBridge.invoke === 'function');
  }
  function ipc(channel, payload) {
    if (!hasBridge()) return Promise.resolve({ ok: false, error: 'no-bridge' });
    try {
      return Promise.resolve(window.FMBridge.invoke(channel, payload || {})).then(function (r) {
        if (!r || typeof r !== 'object') return { ok: false, error: 'bad-response' };
        return r;
      }, function (e) {
        console.warn('[patch 70] ipc', channel, e);
        return { ok: false, error: (e && e.message) || String(e) };
      });
    } catch (e) {
      console.warn('[patch 70] ipc', channel, e);
      return Promise.resolve({ ok: false, error: (e && e.message) || String(e) });
    }
  }
  function errText(res) {
    var e = (res && res.error) || '未知错误';
    if (e === 'no-bridge' || e === 'bad-response') return '浏览器预览没有后端，请用桌面版';
    if (e === '诊断模块不可用') return '诊断模块还没就绪，稍后再试';
    return String(e);
  }

  /* ---------------- 格式化 ---------------- */
  function fmtSize(n) {
    var v = Number(n) || 0;
    if (v <= 0) return '—';
    if (v < 1024) return v + ' B';
    if (v < 1048576) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + ' KB';
    return (v / 1048576).toFixed(1) + ' MB';
  }
  function p2(x) { return (x < 10 ? '0' : '') + x; }
  function fmtTime(t) {
    var n = Number(t);
    if (!n) return '—';
    var d = new Date(n);
    if (isNaN(d.getTime())) return '—';
    var now = new Date();
    var day = d.getFullYear() === now.getFullYear()
      ? p2(d.getMonth() + 1) + '-' + p2(d.getDate())
      : d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    return day + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function reasonText(r) { return REASON[r] || '手动打包'; }

  /* ---------------- 轻提示（复用页面自带的 .toast 样式） ---------------- */
  function toast(msg) {
    try {
      var wrap = doc.getElementById('toastWrap');
      if (!wrap) return;
      var el = doc.createElement('div');
      el.className = 'toast';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"' +
        ' stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 6.5"/></svg><span></span>';
      el.querySelector('span').textContent = String(msg);
      wrap.appendChild(el);
      setTimeout(function () {
        el.classList.add('out');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 420);
      }, 2300);
    } catch (e) { console.warn('[patch 70] toast', e); }
  }

  /* ---------------- 剪贴板 ---------------- */
  function copyText(text) {
    return new Promise(function (resolve) {
      function fallback() {
        try {
          var ta = doc.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', 'readonly');
          ta.style.position = 'fixed';
          ta.style.top = '-1000px';
          ta.style.opacity = '0';
          doc.body.appendChild(ta);
          ta.select();
          var ok = false;
          try { ok = doc.execCommand('copy'); } catch (e2) { ok = false; }
          doc.body.removeChild(ta);
          resolve(!!ok);
        } catch (e3) { resolve(false); }
      }
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(text).then(function () { resolve(true); }, fallback);
        } else fallback();
      } catch (e) { fallback(); }
    });
  }

  /* ---------------- 样式 ---------------- */
  function injectCss() {
    if (doc.getElementById(CSS_ID)) return;
    var st = doc.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      /* 页面骨架：两栏，窄屏单栏 */
      '#page-feedback{max-width:var(--content-max)}',
      '#page-feedback .fbp-grid{display:grid;grid-template-columns:minmax(0,1.04fr) minmax(0,.96fr);',
      '  gap:16px;align-items:stretch}',
      '#page-feedback .fbp-card{padding:18px 18px 16px;border-radius:20px;transition:border-color calc(.28s * var(--anim-k))}',
      '#page-feedback .fbp-card:hover{border-color:var(--stroke-2)}',
      '#page-feedback #fbpRecent{min-height:352px;display:flex;flex-direction:column}',

      /* 卡片头 */
      '.fbp-head{display:flex;align-items:flex-start;gap:12px;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--stroke)}',
      '.fbp-ico{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;flex-shrink:0;',
      '  background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent)}',
      '.fbp-ico svg{width:17px;height:17px}',
      '.fbp-htext{flex:1;min-width:0}',
      '.fbp-htext b{display:block;font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--txt)}',
      '.fbp-htext span{display:block;margin-top:4px;font-size:12px;line-height:1.6;color:var(--txt-2)}',

      /* 表单 */
      '.fbp-sec{margin-bottom:14px}',
      '.fbp-lbl{display:flex;align-items:baseline;justify-content:space-between;gap:10px;',
      '  margin-bottom:8px;font-size:12px;font-weight:600;color:var(--txt-2)}',
      '.fbp-lbl em{font-style:normal;font-size:11.5px;font-weight:500;color:var(--txt-3);',
      '  font-variant-numeric:tabular-nums;letter-spacing:.01em}',
      '.fbp-chips{display:flex;flex-wrap:wrap;gap:8px}',
      '.fbp-chip{height:32px;padding:0 14px;border-radius:var(--r-pill);font-size:12.5px;',
      '  color:var(--txt-2);background:var(--panel);border:1px solid var(--stroke);',
      '  transition:color calc(.22s * var(--anim-k)),background calc(.22s * var(--anim-k)),border-color calc(.22s * var(--anim-k))}',
      '.fbp-chip:hover{color:var(--txt);background:var(--panel-2);border-color:var(--stroke-2)}',
      '.fbp-chip.on{color:var(--accent);background:var(--accent-soft);border-color:var(--accent-line);font-weight:600}',
      '.fbp-ta{display:block;width:100%;min-height:112px;padding:12px 14px;border-radius:16px;',
      '  font-size:13px;line-height:1.62;color:var(--txt);background:var(--panel);border:1px solid var(--stroke);',
      '  resize:vertical;outline:none;transition:border-color calc(.22s * var(--anim-k)),background calc(.22s * var(--anim-k)),box-shadow calc(.22s * var(--anim-k))}',
      '.fbp-ta::placeholder{color:var(--txt-3)}',
      '.fbp-ta:hover{border-color:var(--stroke-2)}',
      '.fbp-ta:focus{border-color:var(--accent-line);background:var(--panel-2);box-shadow:0 0 0 3px var(--accent-soft)}',

      /* 按钮 */
      '.fbp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;',
      '  padding:0 18px;border-radius:var(--r-pill);font-size:12.5px;font-weight:560;white-space:nowrap;',
      '  color:var(--txt-2);background:var(--panel);border:1px solid var(--stroke);',
      '  transition:color calc(.22s * var(--anim-k)),background calc(.22s * var(--anim-k)),',
      '  border-color calc(.22s * var(--anim-k)),transform calc(.22s * var(--anim-k)),box-shadow calc(.22s * var(--anim-k))}',
      '.fbp-btn svg{width:15px;height:15px;flex-shrink:0}',
      '.fbp-btn:hover{color:var(--txt);background:var(--panel-2);border-color:var(--stroke-2)}',
      '.fbp-btn:active{transform:translateY(1px)}',
      '.fbp-btn[disabled]{opacity:.62;pointer-events:none}',
      '.fbp-btn .fbp-bico{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;flex-shrink:0}',
      '.fbp-btn.primary{color:var(--accent-ink);border-color:transparent;font-weight:650;',
      '  background:linear-gradient(140deg,var(--accent-l),var(--accent) 58%,var(--accent-d));',
      '  box-shadow:0 14px 30px -18px var(--accent),inset 0 1px 0 var(--sheen)}',
      '.fbp-btn.primary:hover{transform:translateY(-1px);box-shadow:0 18px 34px -18px var(--accent)}',
      '.fbp-btn.outline{color:var(--accent);font-weight:600;background:var(--accent-soft);border-color:var(--accent)}',
      '.fbp-btn.outline:hover{color:var(--accent);background:var(--accent-soft);border-color:var(--accent-d);transform:translateY(-1px)}',
      '.fbp-btn.danger{color:var(--danger);background:transparent;border-color:var(--stroke-2)}',
      '.fbp-btn.danger:hover{color:var(--danger);background:var(--panel);border-color:var(--danger)}',
      '.fbp-btn.busy .fbp-bico svg{animation:fbpSpin .9s linear infinite}',
      '@keyframes fbpSpin{to{transform:rotate(360deg)}}',

      /* 行动区 + 结果条 */
      '.fbp-acts{display:flex;flex-wrap:wrap;gap:10px}',
      '.fbp-result{display:flex;align-items:center;gap:11px;margin-top:12px;padding:10px 12px;',
      '  border-radius:14px;background:var(--accent-soft);border:1px solid var(--accent-line)}',
      '.fbp-result[hidden]{display:none}',
      '.fbp-res-ico{width:28px;height:28px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;',
      '  background:var(--panel-2);color:var(--accent)}',
      '.fbp-res-ico svg{width:15px;height:15px}',
      '.fbp-res-main{flex:1;min-width:0}',
      '.fbp-res-main b{display:block;font-size:12.5px;font-weight:580;color:var(--txt);',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fbp-res-main span{display:block;margin-top:2px;font-size:11.5px;color:var(--txt-2)}',
      '.fbp-res-act{display:flex;gap:4px;flex-shrink:0}',

      /* 官网入口 */
      '.fbp-site{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;',
      '  padding-top:14px;border-top:1px solid var(--stroke)}',
      '.fbp-tip{font-size:11.5px;line-height:1.5;color:var(--txt-2)}',

      /* 列表 */
      '.fbp-list{display:flex;flex-direction:column;gap:8px;flex:1}',
      '.fbp-item{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:14px;',
      '  background:var(--panel);border:1px solid var(--stroke);',
      '  transition:background calc(.22s * var(--anim-k)),border-color calc(.22s * var(--anim-k))}',
      '.fbp-item:hover{background:var(--panel-2);border-color:var(--stroke-2)}',
      '.fbp-item.fresh{animation:fbpFlash 1.8s var(--ease)}',
      '@keyframes fbpFlash{0%{background:var(--accent-soft);border-color:var(--accent-line)}100%{background:var(--panel);border-color:var(--stroke)}}',
      '.fbp-item-ico{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;',
      '  background:var(--panel-2);border:1px solid var(--stroke);color:var(--txt-2)}',
      '.fbp-item-ico svg{width:15px;height:15px}',
      '.fbp-item-main{flex:1;min-width:0}',
      '.fbp-item-main b{display:block;font-size:12.5px;font-weight:580;color:var(--txt);',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fbp-item-main span{display:block;margin-top:2px;font-size:11.5px;color:var(--txt-2);',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
      '.fbp-item-act{display:flex;gap:3px;flex-shrink:0}',
      '.fbp-icon-btn{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;flex-shrink:0;',
      '  color:var(--txt-3);background:transparent;border:1px solid transparent;',
      '  transition:color calc(.2s * var(--anim-k)),background calc(.2s * var(--anim-k)),border-color calc(.2s * var(--anim-k))}',
      '.fbp-icon-btn svg{width:14px;height:14px}',
      '.fbp-icon-btn:hover{color:var(--txt);background:var(--panel-3);border-color:var(--stroke)}',

      /* 空态（虚线圆角框） */
      '.fbp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;',
      '  flex:1;padding:30px 20px;margin-top:2px;border-radius:16px;border:1px dashed var(--stroke-2);',
      '  background:var(--panel);text-align:center}',
      '.fbp-empty[hidden]{display:none}',
      '.fbp-empty-ico{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;',
      '  background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--accent)}',
      '.fbp-empty-ico svg{width:20px;height:20px}',
      '.fbp-empty b{font-size:13px;font-weight:600;color:var(--txt-2)}',
      '.fbp-empty span{max-width:260px;font-size:11.5px;line-height:1.6;color:var(--txt-3)}',

      /* 列表脚 */
      '.fbp-foot{display:flex;justify-content:flex-end;padding-top:12px;margin-top:12px;border-top:1px solid var(--stroke)}',
      '.fbp-foot[hidden]{display:none}',
      '.fbp-link{height:28px;padding:0 12px;border-radius:var(--r-pill);font-size:11.5px;color:var(--txt-3);',
      '  transition:color calc(.22s * var(--anim-k)),background calc(.22s * var(--anim-k))}',
      '.fbp-link:hover{color:var(--danger);background:var(--panel-2)}',

      /* 顶部自动生成提示条 */
      '.fbp-auto{display:flex;align-items:center;gap:10px;margin:0 0 14px;padding:10px 12px;border-radius:14px;',
      '  background:var(--accent-soft);border:1px solid var(--accent-line);animation:fbpFlash 1.8s var(--ease)}',
      '.fbp-auto[hidden]{display:none}',
      '.fbp-auto-ico{display:grid;place-items:center;width:26px;height:26px;border-radius:9px;flex-shrink:0;',
      '  background:var(--panel-2);color:var(--accent)}',
      '.fbp-auto-ico svg{width:15px;height:15px}',
      '.fbp-auto-txt{flex:1;min-width:0;font-size:12.5px;line-height:1.5;color:var(--txt);',
      '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

      /* 确认框（复用页面自带的 .pf-mask / .pf-dialog，只补内部） */
      '.fbp-dlg-ico{width:48px;height:48px;margin:0 auto 12px;border-radius:16px;display:grid;place-items:center;',
      '  background:var(--panel-2);border:1px solid var(--stroke);color:var(--danger)}',
      '.fbp-dlg-ico svg{width:22px;height:22px}',
      '.fbp-dlg-body{font-size:12.5px;line-height:1.65;color:var(--txt-2);margin:10px 2px 18px}',
      '.fbp-dlg-foot{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}',

      /* 游戏退出卡片里追加的一行 */
      '.fbp-exit-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;',
      '  padding-top:12px;border-top:1px solid var(--stroke);animation:fbpFade .3s var(--ease)}',
      '@keyframes fbpFade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
      '.fbp-exit-hint{flex:1;min-width:120px;font-size:11.5px;line-height:1.5;color:var(--txt-3)}',
      '.fbp-xbtn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;',
      '  border-radius:var(--r-pill);font-size:11.5px;color:var(--txt-2);background:var(--panel);',
      '  border:1px solid var(--stroke);transition:color calc(.22s * var(--anim-k)),background calc(.22s * var(--anim-k)),border-color calc(.22s * var(--anim-k))}',
      '.fbp-xbtn svg{width:13px;height:13px;flex-shrink:0}',
      '.fbp-xbtn:hover{color:var(--accent);background:var(--accent-soft);border-color:var(--accent-line)}',

      /* 窄屏单栏 */
      '@media (max-width:1080px){',
      '  #page-feedback .fbp-grid{grid-template-columns:minmax(0,1fr)}',
      '  #page-feedback #fbpRecent{min-height:0}',
      '}'
    ].join('\n');
    doc.head.appendChild(st);
  }

  /* ---------------- 侧栏按钮（插在「设置」之前） ---------------- */
  function buildRail() {
    if ($('.rail-btn[data-page="' + PAGE_KEY + '"]')) return;
    var settings = $('.rail-btn[data-page="settings"]');
    if (!settings || !settings.parentNode) return;
    var b = doc.createElement('button');
    b.className = 'rail-btn';
    b.setAttribute('type', 'button');
    b.setAttribute('data-page', PAGE_KEY);
    b.innerHTML =
      '<span class="rb-ico">' + icon(P_CHAT) + '</span>' +
      '<span class="rb-label">反馈</span>' +
      '<span class="rail-pop">' +
        '<span class="pop-t">' + icon(P_CHAT) + '反馈</span>' +
        '<span class="pop-d">出问题先打包诊断信息，再带上描述去官网反馈，比口头说明清楚得多。</span>' +
        '<span class="pop-kv"><span>诊断包</span><b id="fbpPopCount">—</b></span>' +
      '</span>';
    b.addEventListener('click', function (e) {
      try { e.preventDefault(); } catch (err) {}
      showFeedback();
    });
    settings.parentNode.insertBefore(b, settings);
  }

  /* ---------------- 页面 ---------------- */
  function pageHtml() {
    return [
      '<div class="sec-head" style="margin-top:2px">',
      '  <h2>反馈 <span class="cnt" id="fbpCnt" hidden>0</span></h2>',
      '</div>',

      '<div class="fbp-auto" id="fbpAuto" hidden>',
      '  <span class="fbp-auto-ico">' + icon(P_WARN) + '</span>',
      '  <span class="fbp-auto-txt" id="fbpAutoTxt"></span>',
      '  <button class="fbp-icon-btn" id="fbpAutoClose" type="button" title="关闭提示">' + icon(P_CLOSE) + '</button>',
      '</div>',

      '<div class="fbp-grid">',

      /* ---- 左：遇到问题了 ---- */
      '  <div class="glass fbp-card" id="fbpAsk">',
      '    <div class="fbp-head">',
      '      <span class="fbp-ico">' + icon(P_CHAT) + '</span>',
      '      <div class="fbp-htext">',
      '        <b>遇到问题了？</b>',
      '        <span>出问题先打包诊断信息，比口头描述清楚得多——版本、系统、日志和退出码都会一起收进 zip。</span>',
      '      </div>',
      '    </div>',
      '    <div class="fbp-sec">',
      '      <div class="fbp-lbl">问题类型</div>',
      '      <div class="fbp-chips" id="fbpChips">',
      '        <button class="fbp-chip on" type="button" data-type="启动失败">启动失败</button>',
      '        <button class="fbp-chip" type="button" data-type="游戏闪退">游戏闪退</button>',
      '        <button class="fbp-chip" type="button" data-type="界面错乱">界面错乱</button>',
      '        <button class="fbp-chip" type="button" data-type="其它">其它</button>',
      '      </div>',
      '    </div>',
      '    <div class="fbp-sec">',
      '      <div class="fbp-lbl">发生了什么 <em><span id="fbpNoteCnt">0</span> / 500</em></div>',
      '      <textarea class="fbp-ta" id="fbpNote" maxlength="500" spellcheck="false"',
      '        placeholder="说具体点：点了什么、看到什么、期望什么结果"></textarea>',
      '    </div>',
      '    <div class="fbp-acts">',
      '      <button class="fbp-btn primary" id="fbpPack" type="button">',
      '        <span class="fbp-bico">' + icon(P_ARCHIVE) + '</span><span id="fbpPackTxt">打包诊断信息</span>',
      '      </button>',
      '      <button class="fbp-btn" id="fbpDigest" type="button">' + icon(P_COPY) + '<span>复制诊断摘要</span></button>',
      '    </div>',
      '    <div class="fbp-result" id="fbpResult" hidden>',
      '      <span class="fbp-res-ico">' + icon(P_ARCHIVE) + '</span>',
      '      <div class="fbp-res-main"><b id="fbpResName">—</b><span id="fbpResMeta">—</span></div>',
      '      <div class="fbp-res-act">',
      '        <button class="fbp-icon-btn" id="fbpReveal" type="button" title="打开所在文件夹">' + icon(P_FOLDER) + '</button>',
      '        <button class="fbp-icon-btn" id="fbpCopySum" type="button" title="复制摘要">' + icon(P_COPY) + '</button>',
      '      </div>',
      '    </div>',
      '    <div class="fbp-site">',
      '      <button class="fbp-btn outline" id="fbpSite" type="button">' + icon(P_LINK) + '<span>前往官网反馈</span></button>',
      '      <span class="fbp-tip" id="fbpTip">' + TIP_IDLE + '</span>',
      '    </div>',
      '  </div>',

      /* ---- 右：最近的诊断包 ---- */
      '  <div class="glass fbp-card" id="fbpRecent">',
      '    <div class="fbp-head">',
      '      <span class="fbp-ico">' + icon(P_ARCHIVE) + '</span>',
      '      <div class="fbp-htext">',
      '        <b>最近的诊断包</b>',
      '        <span>手动打包与异常自动生成都会留在这里，最多保留 20 个。</span>',
      '      </div>',
      '      <button class="fbp-icon-btn" id="fbpRefresh" type="button" title="刷新列表">' + icon(P_REFRESH) + '</button>',
      '    </div>',
      '    <div class="fbp-list" id="fbpList"></div>',
      '    <div class="fbp-empty" id="fbpEmpty">',
      '      <span class="fbp-empty-ico">' + icon(P_ARCHIVE) + '</span>',
      '      <b>还没有诊断包</b>',
      '      <span>出问题时点左边打包，会把日志一起收进来。</span>',
      '    </div>',
      '    <div class="fbp-foot" id="fbpListFoot" hidden>',
      '      <button class="fbp-link" id="fbpClearAll" type="button">清空全部</button>',
      '    </div>',
      '  </div>',

      '</div>'
    ].join('\n');
  }

  function buildPage() {
    if (doc.getElementById(PAGE_ID)) return;
    var pages = doc.getElementById('pages');
    if (!pages) return;
    var sec = doc.createElement('section');
    sec.className = 'page';
    sec.id = PAGE_ID;
    sec.innerHTML = pageHtml();
    pages.appendChild(sec);
  }

  /* ---------------- 确认框（复用 .pf-mask / .pf-dialog） ---------------- */
  function buildConfirm() {
    if (doc.getElementById('fbpConfirm')) return;
    var mask = doc.createElement('div');
    mask.className = 'pf-mask';
    mask.id = 'fbpConfirm';
    mask.setAttribute('role', 'presentation');
    mask.innerHTML = [
      '<div class="pf-dialog" role="dialog" aria-modal="true" aria-labelledby="fbpDlgTitle">',
      '  <span class="fbp-dlg-ico">' + icon(P_TRASH) + '</span>',
      '  <div class="pf-title" id="fbpDlgTitle">清空全部诊断包？</div>',
      '  <div class="fbp-dlg-body" id="fbpDlgBody"></div>',
      '  <div class="fbp-dlg-foot">',
      '    <button class="fbp-btn" id="fbpDlgNo" type="button">再想想</button>',
      '    <button class="fbp-btn danger" id="fbpDlgYes" type="button">清空</button>',
      '  </div>',
      '</div>'
    ].join('');
    doc.body.appendChild(mask);

    mask.addEventListener('click', function (e) {
      if (e.target === mask) closeConfirm();
    });
    $('#fbpDlgNo').addEventListener('click', closeConfirm);
    $('#fbpDlgYes').addEventListener('click', function () {
      var cb = state.confirmCb;
      closeConfirm();
      if (typeof cb === 'function') { try { cb(); } catch (e) { console.warn('[patch 70] confirm', e); } }
    });
    if (!state.escBound) {
      state.escBound = true;
      doc.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeConfirm();
      });
    }
  }
  function askConfirm(title, body, okText, cb) {
    var mask = doc.getElementById('fbpConfirm');
    if (!mask) { if (typeof cb === 'function') cb(); return; }
    var t = doc.getElementById('fbpDlgTitle');
    var b = doc.getElementById('fbpDlgBody');
    var y = doc.getElementById('fbpDlgYes');
    if (t) t.textContent = title;
    if (b) b.textContent = body;
    if (y) y.textContent = okText || '确定';
    state.confirmCb = cb;
    mask.classList.add('on');
  }
  function closeConfirm() {
    var mask = doc.getElementById('fbpConfirm');
    if (mask) mask.classList.remove('on');
    state.confirmCb = null;
  }

  /* ---------------- 导航（复刻 index.html 里闭包内的 go()） ---------------- */
  function showFeedback() {
    try {
      $$('.rail-btn[data-page]').forEach(function (x) {
        x.classList.toggle('active', x.dataset.page === PAGE_KEY);
      });
      $$('.page').forEach(function (p) {
        p.classList.toggle('active', p.id === PAGE_ID);
      });
      var lbl = doc.getElementById('pageLabel');
      if (lbl) lbl.textContent = 'Feedback';
      var pages = doc.getElementById('pages');
      if (pages && pages.scrollTo) pages.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { console.warn('[patch 70] nav', e); }
    loadStatus(true);
  }

  /* ---------------- 列表 ---------------- */
  function makeItem(it, fresh) {
    var row = doc.createElement('div');
    row.className = 'fbp-item' + (fresh ? ' fresh' : '');

    var ico = doc.createElement('span');
    ico.className = 'fbp-item-ico';
    ico.innerHTML = icon(P_ARCHIVE);

    var main = doc.createElement('div');
    main.className = 'fbp-item-main';
    var b = doc.createElement('b');
    b.textContent = it.name || 'diagnostic.zip';
    var meta = doc.createElement('span');
    meta.textContent = fmtSize(it.size) + ' · ' + reasonText(it.reason) + ' · ' + fmtTime(it.at);
    main.appendChild(b);
    main.appendChild(meta);

    var act = doc.createElement('div');
    act.className = 'fbp-item-act';

    var reveal = doc.createElement('button');
    reveal.className = 'fbp-icon-btn';
    reveal.type = 'button';
    reveal.title = '打开所在文件夹';
    reveal.innerHTML = icon(P_FOLDER);
    reveal.addEventListener('click', function () {
      ipc('diag:reveal', { file: it.file }).then(function (res) {
        if (!res || !res.ok) toast('打不开文件夹：' + errText(res));
      });
    });

    var del = doc.createElement('button');
    del.className = 'fbp-icon-btn';
    del.type = 'button';
    del.title = '删除这个诊断包';
    del.innerHTML = icon(P_TRASH);
    /* 只删一条、风险低，直接删不给确认框；确认框只留给「清空全部」 */
    del.addEventListener('click', function () { doDelete(it.file); });

    act.appendChild(reveal);
    act.appendChild(del);
    row.appendChild(ico);
    row.appendChild(main);
    row.appendChild(act);
    return row;
  }

  function renderList() {
    var list = doc.getElementById('fbpList');
    if (!list) return;
    var shown = state.items.slice(0, MAX_SHOW);
    list.innerHTML = '';
    shown.forEach(function (it) { list.appendChild(makeItem(it, false)); });

    var empty = doc.getElementById('fbpEmpty');
    if (empty) empty.hidden = shown.length > 0;
    var foot = doc.getElementById('fbpListFoot');
    if (foot) foot.hidden = state.items.length === 0;

    var cnt = doc.getElementById('fbpCnt');
    if (cnt) {
      cnt.hidden = state.items.length === 0;
      cnt.textContent = String(state.items.length);
    }
    var pop = doc.getElementById('fbpPopCount');
    if (pop) pop.textContent = state.items.length ? (state.items.length + ' 个') : '暂无';
  }

  function prependItem(it, fresh) {
    if (!it || !it.file) return;
    var kept = state.items.filter(function (x) { return x.file !== it.file; });
    kept.unshift({
      file: it.file,
      name: it.name || String(it.file).split(/[\\/]/).pop(),
      size: it.size,
      at: it.at || Date.now(),
      reason: it.reason || 'manual'
    });
    state.items = kept;
    renderList();
    if (fresh) {
      var first = doc.querySelector('#fbpList .fbp-item');
      if (first && first.classList) {
        first.classList.add('fresh');
        setTimeout(function () { if (first.classList) first.classList.remove('fresh'); }, 1900);
      }
    }
  }

  function loadStatus(silent) {
    if (state.loading) return;
    state.loading = true;
    ipc('diag:status', {}).then(function (res) {
      state.loading = false;
      if (!res || !res.ok || !res.data || !res.data.items) {
        /* 不可用：保留当前列表（浏览器预览里就是空态），不报错不弹窗 */
        if (!silent) toast('读不到诊断包列表：' + errText(res));
        renderList();
        return;
      }
      state.items = res.data.items.slice();
      renderList();
    });
  }

  /* ---------------- 打包 / 复制 ---------------- */
  function buildNote() {
    var t = String(state.note || '').replace(/\s+$/, '');
    var head = state.type ? ('【' + state.type + '】') : '';
    var s = head + t;
    return s.length > MAX_NOTE ? s.slice(0, MAX_NOTE) : s;
  }

  function digest() {
    var verEl = doc.getElementById('aboutVer');
    var ver = verEl ? String(verEl.textContent || '').trim() : '';
    var lines = [];
    lines.push('X Craft Launcher 诊断摘要');
    lines.push('版本：' + (ver || '未知'));
    lines.push('系统：' + (navigator.platform || '未知') + ' / ' + window.screen.width + '×' + window.screen.height);
    lines.push('时间：' + new Date().toLocaleString('zh-CN'));
    if (state.type) lines.push('问题类型：' + state.type);
    var note = String(state.note || '').trim();
    if (note) lines.push('描述：' + note);
    if (state.last && state.last.name) lines.push('最近诊断包：' + state.last.name);
    lines.push('UA：' + (navigator.userAgent || ''));
    return lines.join('\n');
  }

  /* 复制成功后小字临时变成「已复制」，3 秒复原 */
  function flashTip() {
    var tip = doc.getElementById('fbpTip');
    if (!tip) return;
    tip.textContent = TIP_COPIED;
    if (state.tipTimer) clearTimeout(state.tipTimer);
    state.tipTimer = setTimeout(function () {
      state.tipTimer = 0;
      if (tip) tip.textContent = TIP_IDLE;
    }, 3000);
  }

  function setBusy(on) {
    state.busy = !!on;
    var btn = doc.getElementById('fbpPack');
    if (!btn) return;
    var txt = doc.getElementById('fbpPackTxt');
    var bico = btn.querySelector('.fbp-bico');
    if (on) btn.classList.add('busy'); else btn.classList.remove('busy');
    btn.disabled = !!on;
    if (txt) txt.textContent = on ? '正在打包…' : '打包诊断信息';
    if (bico) bico.innerHTML = icon(on ? P_SPIN : P_ARCHIVE);
  }

  function renderResult(d) {
    var box = doc.getElementById('fbpResult');
    if (!box || !d) return;
    var name = doc.getElementById('fbpResName');
    var meta = doc.getElementById('fbpResMeta');
    if (name) name.textContent = d.name || (String(d.file || '').split(/[\\/]/).pop()) || '诊断包';
    if (meta) meta.textContent = fmtSize(d.size) + ' · ' + fmtTime(d.at || Date.now());
    box.hidden = false;
  }

  function doPack(opts) {
    if (state.busy) return Promise.resolve(null);
    setBusy(true);
    var reason = (opts && opts.reason) || 'manual';
    var payload = { reason: reason, note: buildNote(), includeGameLogs: true };
    return ipc('diag:pack', payload).then(function (res) {
      setBusy(false);
      if (!res || !res.ok || !res.data) {
        toast('打包失败：' + errText(res));
        return null;
      }
      var d = res.data;
      state.last = d;
      renderResult(d);
      prependItem({
        file: d.file,
        name: d.name,
        size: d.size,
        at: d.at,
        reason: reason
      }, true);
      toast('诊断包已生成');
      return d;
    });
  }

  /* 老版本主进程没有 diag:delete 时返回「未知…」，这种才退回全清；其它错误绝不顺手清空 */
  function channelMissing(res) {
    var e = String((res && res.error) || '');
    return /未知|unknown|not\s*(found|supported)|不支持|没有这个通道|未实现/i.test(e);
  }

  /* 兜底：只有通道缺失才走「清空全部」，且保留二次确认与原本文案 */
  function askClearFallback(file) {
    var name = String(file || '').split(/[\\/]/).pop() || '这个诊断包';
    askConfirm('当前版本不支持单个删除',
      '要删掉 ' + name + ' 只能清空全部诊断包（本地所有诊断 zip 与临时目录），删除后无法恢复。',
      '清空全部', doClear);
  }

  /* 单个删除：diag:delete 幂等（文件已不存在也返回 ok/removed:false），两种都当已删除处理 */
  function doDelete(file) {
    if (!file) return Promise.resolve(false);
    return ipc('diag:delete', { file: file }).then(function (res) {
      if (!res || !res.ok) {
        if (channelMissing(res)) { askClearFallback(file); return false; }
        toast('删除失败：' + errText(res));
        return false;
      }
      var removed = !!(res.data && res.data.removed);
      state.items = state.items.filter(function (x) { return x.file !== file; });
      if (state.last && state.last.file === file) {
        state.last = null;
        var box = doc.getElementById('fbpResult');
        if (box) box.hidden = true;
      }
      renderList();
      toast(removed ? '已删除该诊断包' : '文件已经不在了，已从列表移除');
      return true;
    });
  }

  function doClear() {
    askConfirm('清空全部诊断包？',
      '会删除本地所有诊断 zip 与临时目录，删除后无法恢复。',
      '清空', function () {
        ipc('diag:clear', {}).then(function (res) {
          if (res && res.ok) {
            var n = (res.data && res.data.removed) || 0;
            state.items = [];
            state.last = null;
            var box = doc.getElementById('fbpResult');
            if (box) box.hidden = true;
            renderList();
            toast('已清空 ' + n + ' 个诊断包');
          } else {
            toast('清空失败：' + errText(res));
          }
        });
      });
  }

  /* ---------------- 顶部提示条 ---------------- */
  function showAuto(d) {
    var bar = doc.getElementById('fbpAuto');
    var txt = doc.getElementById('fbpAutoTxt');
    if (!bar || !txt) return;
    var n = (d && (d.name || d.file)) || '诊断包';
    if (d && d.name) n = d.name;
    else if (d && d.file) n = String(d.file).split(/[\\/]/).pop();
    txt.textContent = '检测到异常，已自动生成诊断包 ' + n;
    txt.title = txt.textContent;
    bar.hidden = false;
  }

  /* ---------------- 事件绑定 ---------------- */
  function wirePage() {
    var chips = doc.getElementById('fbpChips');
    if (chips && !chips.__fbpBound) {
      chips.__fbpBound = true;
      chips.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.fbp-chip') : null;
        if (!btn) return;
        $$('.fbp-chip', chips).forEach(function (x) { x.classList.remove('on'); });
        btn.classList.add('on');
        state.type = btn.getAttribute('data-type') || '其它';
      });
    }

    var ta = doc.getElementById('fbpNote');
    if (ta && !ta.__fbpBound) {
      ta.__fbpBound = true;
      ta.addEventListener('input', function () {
        var v = String(ta.value || '');
        if (v.length > MAX_NOTE) { v = v.slice(0, MAX_NOTE); ta.value = v; }
        state.note = v;
        var c = doc.getElementById('fbpNoteCnt');
        if (c) c.textContent = String(v.length);
      });
    }

    var pack = doc.getElementById('fbpPack');
    if (pack && !pack.__fbpBound) {
      pack.__fbpBound = true;
      pack.addEventListener('click', function () { doPack({ reason: 'manual' }); });
    }

    var digestBtn = doc.getElementById('fbpDigest');
    if (digestBtn && !digestBtn.__fbpBound) {
      digestBtn.__fbpBound = true;
      digestBtn.addEventListener('click', function () {
        copyText(digest()).then(function (ok) {
          if (ok) flashTip();
          toast(ok ? '诊断摘要已复制，去官网粘贴即可' : '复制失败，请手动选择文本复制');
        });
      });
    }

    var reveal = doc.getElementById('fbpReveal');
    if (reveal && !reveal.__fbpBound) {
      reveal.__fbpBound = true;
      reveal.addEventListener('click', function () {
        var p = state.last && state.last.file ? { file: state.last.file } : {};
        ipc('diag:reveal', p).then(function (res) {
          if (!res || !res.ok) toast('打不开文件夹：' + errText(res));
        });
      });
    }

    var copySum = doc.getElementById('fbpCopySum');
    if (copySum && !copySum.__fbpBound) {
      copySum.__fbpBound = true;
      copySum.addEventListener('click', function () {
        var t = (state.last && state.last.summary) ? state.last.summary : digest();
        copyText(t).then(function (ok) {
          if (ok) flashTip();
          toast(ok ? '摘要已复制' : '复制失败，请手动选择文本复制');
        });
      });
    }

    var site = doc.getElementById('fbpSite');
    if (site && !site.__fbpBound) {
      site.__fbpBound = true;
      site.addEventListener('click', function () {
        try { window.open(SITE_URL, '_blank'); }
        catch (e) { console.warn('[patch 70] open', e); }
      });
    }

    var refresh = doc.getElementById('fbpRefresh');
    if (refresh && !refresh.__fbpBound) {
      refresh.__fbpBound = true;
      refresh.addEventListener('click', function () { loadStatus(false); });
    }

    var clearAll = doc.getElementById('fbpClearAll');
    if (clearAll && !clearAll.__fbpBound) {
      clearAll.__fbpBound = true;
      clearAll.addEventListener('click', doClear);
    }

    var autoClose = doc.getElementById('fbpAutoClose');
    if (autoClose && !autoClose.__fbpBound) {
      autoClose.__fbpBound = true;
      autoClose.addEventListener('click', function () {
        var bar = doc.getElementById('fbpAuto');
        if (bar) bar.hidden = true;
      });
    }
  }

  /* ---------------- 诊断事件 ---------------- */
  function bindDiag() {
    if (state.diagBound) return;
    var B = window.FMBridge;
    if (!B || typeof B.on !== 'function' || B.available === false) return;
    state.diagBound = true;
    try {
      B.on('diag:ready', function (d) {
        try {
          if (!d) return;
          prependItem(d, true);
          if (d.auto === true) showAuto(d);
        } catch (e) { console.warn('[patch 70] diag:ready', e); }
      });
    } catch (e) { console.warn('[patch 70] diag on', e); }
  }

  /* ---------------- 游戏异常退出：卡片守护 + 一行按钮 ---------------- */
  /* #taskSub 已经被 launchState 写成「退出码 N」时，这行只做引导，避免重复 */
  function exitHint(code) {
    var tip = '先打包诊断信息再反馈，官方能直接看到日志';
    var sub = doc.getElementById('taskSub');
    var t = sub ? String(sub.textContent || '') : '';
    if (t.indexOf('退出码') >= 0) return tip;
    return '退出码 ' + code + '，' + tip;
  }

  function buildExitRow(code) {
    var row = doc.createElement('div');
    row.className = 'fbp-exit-row';
    row.id = 'fbpExitRow';

    var hint = doc.createElement('span');
    hint.className = 'fbp-exit-hint';
    hint.textContent = exitHint(code);

    var b1 = doc.createElement('button');
    b1.className = 'fbp-xbtn';
    b1.type = 'button';
    b1.innerHTML = icon(P_ARCHIVE) + '<span>查看诊断包</span>';
    b1.addEventListener('click', function () {
      try {
        showFeedback();
        doPack({ reason: 'game-crash' });
      } catch (e) { console.warn('[patch 70] exit pack', e); }
    });

    var b2 = doc.createElement('button');
    b2.className = 'fbp-xbtn';
    b2.type = 'button';
    b2.innerHTML = icon(P_LINK) + '<span>前往官网反馈</span>';
    b2.addEventListener('click', function () {
      try { window.open(SITE_URL, '_blank'); } catch (e) { console.warn('[patch 70] exit open', e); }
    });

    row.appendChild(hint);
    row.appendChild(b1);
    row.appendChild(b2);
    return row;
  }

  function stopHold() {
    if (state.holdTimer) { clearInterval(state.holdTimer); state.holdTimer = 0; }
    if (state.mo) {
      try { state.mo.disconnect(); } catch (e) {}
      state.mo = null;
    }
    state.holdUntil = 0;
  }

  function releaseTaskCard(hide) {
    stopHold();
    var row = doc.getElementById('fbpExitRow');
    if (row && row.parentNode) row.parentNode.removeChild(row);
    if (hide) {
      var card = doc.getElementById('taskCard');
      if (card) card.hidden = true;
    }
  }

  function holdTaskCard(code) {
    var card = doc.getElementById('taskCard');
    if (!card) return;
    try {
      var old = doc.getElementById('fbpExitRow');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      card.appendChild(buildExitRow(code));
      card.hidden = false;
      state.userClosed = false;
      state.holdUntil = Date.now() + HOLD_MS;

      if (!state.mo && window.MutationObserver) {
        state.mo = new MutationObserver(function () {
          try {
            if (state.userClosed) { stopHold(); return; }
            if (Date.now() > state.holdUntil) { releaseTaskCard(true); return; }
            if (card.hidden) card.hidden = false;
          } catch (e) { console.warn('[patch 70] mo', e); }
        });
        state.mo.observe(card, { attributes: true, attributeFilter: ['hidden'] });
      }
      if (state.holdTimer) clearInterval(state.holdTimer);
      state.holdTimer = setInterval(function () {
        try {
          if (state.userClosed) { stopHold(); return; }
          if (Date.now() > state.holdUntil) { releaseTaskCard(true); return; }
          if (card.hidden) card.hidden = false;
        } catch (e) { console.warn('[patch 70] hold', e); }
      }, 1000);
    } catch (e) { console.warn('[patch 70] holdTaskCard', e); }
  }

  function onLaunchState(d) {
    if (!d) return;
    if (d.state === 'exit') {
      var code = d.code;
      var abnormal = (code !== 0 && code !== null && code !== undefined);
      if (abnormal) holdTaskCard(code);
      else releaseTaskCard(false);
    } else if (d.state === 'prepare' || d.state === 'starting' || d.state === 'running') {
      releaseTaskCard(false);
    }
  }

  function bindLaunch() {
    if (state.launchBound) return;
    var B = window.FMBridge;
    if (!B || typeof B.on !== 'function' || B.available === false) return;
    state.launchBound = true;
    try {
      B.on('game:launchState', function (d) {
        try { onLaunchState(d); } catch (e) { console.warn('[patch 70] launch', e); }
      });
    } catch (e) { console.warn('[patch 70] launch on', e); }
  }

  function wireTaskCancel() {
    if (state.cancelBound) return;
    var cancel = doc.getElementById('taskCancel');
    if (!cancel) return;
    state.cancelBound = true;
    /* 用户主动关掉卡片：停止守护，别把卡片又拽回来 */
    cancel.addEventListener('click', function () {
      state.userClosed = true;
      stopHold();
    }, true);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    try {
      if (window.__xclPatch70 && doc.getElementById(PAGE_ID)) return;
      injectCss();
      buildRail();
      buildPage();
      buildConfirm();
      wirePage();
      bindDiag();
      bindLaunch();
      wireTaskCancel();
      if (doc.getElementById(PAGE_ID)) {
        window.__xclPatch70 = true;
        renderList();
      }
    } catch (e) { console.warn('[patch 70]', e); }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();

console.log('[patch 70] ready');
