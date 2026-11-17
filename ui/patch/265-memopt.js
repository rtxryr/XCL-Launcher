/* ------------------------------------------------------------------
 * patch/265-memopt.js — 性能设置「内存优化」（默认关闭）
 *
 * 开启后：
 *   主进程每 20s 看一次可用内存，低于阈值（<10% 且 <1.2GB）推一条 mem:alarm；
 *   界面弹窗列出「空闲且占用较低」的后台进程供勾选（默认只勾后台辅助进程），
 *   用户确认后结束所选进程，回收后在右下角提示本次释放了多少内存。
 *
 * 安全约定：
 *   - 系统进程、启动器自身、正在运行的游戏（java/javaw）永不入列；
 *   - 普通应用（QQ / 微信 / 浏览器等）默认不勾，必须用户手动选择；
 *   - 关闭开关只是停止监控，不会去动任何进程。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch265) return;
  window.__xclPatch265 = true;

  var doc = document;
  var LS = 'mc.memOpt';
  var MODAL_ID = 'm265Modal';
  var CARD_ID = 'm265Card';

  function $(s, r) { return (r || doc).querySelector(s); }
  function bridge(ch, p) {
    if (!window.FMBridge || typeof window.FMBridge.invoke !== 'function' || window.FMBridge.available === false) {
      return Promise.resolve(null);
    }
    return Promise.resolve(window.FMBridge.invoke(ch, p || {})).catch(function () { return null; });
  }
  function toast(msg, kind) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
    var t = doc.createElement('div');
    t.className = 'm265-toast' + (kind === 'ok' ? ' ok' : kind === 'bad' ? ' bad' : '');
    t.textContent = msg;
    doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function mbText(n) {
    n = Number(n) || 0;
    return n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : Math.round(n) + ' MB';
  }

  function injectCss() {
    if (doc.getElementById('patch-265-style')) return;
    var css = [
      '#m265Card .m265-badge{display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 7px;border-radius:999px;',
      '  font-size:10px;font-weight:600;color:var(--accent);background:var(--accent-soft,rgba(120,200,160,.16));vertical-align:1px}',
      '#m265Card .m265-live{margin:10px 0 0;padding-top:10px;border-top:1px solid var(--stroke);',
      '  display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--txt-3)}',
      '#m265Card .m265-live b{color:var(--txt-2);font-weight:600}',
      '#m265Card .m265-live .warn{color:#e0a34a}',
      '#m265Card .m265-bar{flex:1 1 120px;min-width:90px;height:5px;border-radius:999px;background:var(--panel-3,rgba(255,255,255,.08));overflow:hidden}',
      '#m265Card .m265-bar i{display:block;height:100%;width:0;border-radius:999px;background:var(--accent);transition:width .4s ease}',

      '.m265-mask{position:fixed;inset:0;z-index:965;display:grid;place-items:center;padding:24px;',
      '  background:rgba(6,12,10,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
      '.m265-mask[hidden]{display:none}',
      '.m265-dlg{width:min(560px,100%);max-height:86vh;display:flex;flex-direction:column;border-radius:var(--r-xl);padding:22px 24px 18px;',
      '  color:var(--txt);background:linear-gradient(165deg,var(--glass-a),var(--glass-b)),var(--panel-2);',
      '  border:1px solid var(--stroke);box-shadow:0 40px 90px -40px var(--shadow-2)}',
      '.m265-dlg h3{margin:0 0 6px;font-size:16px;letter-spacing:-.01em;display:flex;align-items:center;gap:9px}',
      '.m265-dlg h3 svg{width:19px;height:19px;color:#e0a34a;flex:0 0 auto}',
      '.m265-dlg .m265-sub{margin:0 0 12px;font-size:11.5px;color:var(--txt-3);line-height:1.7}',
      '.m265-list{flex:1 1 auto;overflow:auto;margin:0 0 12px;padding:4px;border-radius:var(--r-m);',
      '  background:var(--panel-3,rgba(255,255,255,.04));border:1px solid var(--stroke);max-height:290px}',
      '.m265-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-s);cursor:pointer;',
      '  transition:background .16s}',
      '.m265-row:hover{background:var(--panel-2)}',
      '.m265-row input{appearance:none;width:15px;height:15px;flex:0 0 auto;border-radius:5px;cursor:pointer;',
      '  border:1.6px solid var(--stroke);background:var(--panel-2);position:relative;transition:background .16s,border-color .16s}',
      '.m265-row input:checked{background:var(--accent);border-color:transparent}',
      '.m265-row input:checked::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;',
      '  border:2px solid var(--on-accent,#08120e);border-top:0;border-left:0;transform:rotate(42deg)}',
      '.m265-row .n{flex:1 1 auto;min-width:0;font-size:12px;color:var(--txt-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.m265-row .m{font-size:11px;color:var(--txt-3);font-variant-numeric:tabular-nums}',
      '.m265-row .tag{font-size:9.5px;padding:1px 6px;border-radius:999px;color:var(--accent);',
      '  background:var(--accent-soft,rgba(120,200,160,.14))}',
      '.m265-empty{padding:22px 10px;text-align:center;font-size:12px;color:var(--txt-3)}',
      '.m265-foot{display:flex;align-items:center;gap:10px;justify-content:flex-end}',
      '.m265-foot .m265-hint{margin-right:auto;font-size:11px;color:var(--txt-3)}',
      '.m265-dlg button{padding:8px 18px;border-radius:var(--r-pill);font-size:12.5px;cursor:pointer;',
      '  border:1px solid var(--stroke);background:var(--panel-2);color:var(--txt-2);transition:color .2s,filter .2s}',
      '.m265-dlg button:hover{color:var(--txt)}',
      '.m265-dlg button.m265-primary{background:var(--accent);border-color:transparent;color:var(--on-accent,#08120e);font-weight:600}',
      '.m265-dlg button[disabled]{opacity:.45;pointer-events:none}',
      '.m265-toast{position:fixed;right:22px;bottom:22px;z-index:9999;padding:11px 18px;border-radius:var(--r-m);',
      '  background:var(--panel-2);color:var(--txt);border:1px solid var(--stroke);font-size:12.5px;',
      '  box-shadow:0 20px 44px -24px var(--shadow-2);max-width:340px;line-height:1.6}',
      '.m265-toast.ok{border-color:color-mix(in srgb,var(--accent) 45%,transparent)}',
      '.m265-toast.bad{border-color:#e0705f66}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-265-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  /* ---------------- 卡片 ---------------- */
  function buildCard() {
    var pane = doc.getElementById('tab-perf');
    if (!pane) return;
    if (doc.getElementById(CARD_ID)) return;
    injectCss();

    var card = doc.createElement('div');
    card.className = 'glass list-card';
    card.id = CARD_ID;
    card.style.marginBottom = '16px';
    card.innerHTML =
      '<div class="group-title">内存优化<span class="m265-badge">可选</span></div>' +
      '<div class="opt-row">' +
        '<div class="opt-ico">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="4" y="7" width="16" height="10" rx="2.6"/><path d="M7.6 10.4v3.2M11 10.4v3.2M14.4 10.4v3.2"/>' +
          '<path d="M7 4.6v2.4M12 4.6v2.4M17 4.6v2.4M7 17v2.4M12 17v2.4M17 17v2.4" opacity=".55"/></svg>' +
        '</div>' +
        '<div class="opt-main">' +
          '<b>内存优化</b>' +
          '<span>开机后盯着可用内存，一旦严重不足就问你一句，确认后关掉空闲的后台进程，把内存腾出来给游戏。</span>' +
        '</div>' +
        '<div class="switch" id="m265Sw" role="switch" aria-checked="false" aria-label="内存优化"></div>' +
      '</div>' +
      '<div class="m265-live">' +
        '<span>可用 <b id="m265Free">—</b> / <b id="m265Total">—</b></span>' +
        '<span class="m265-bar"><i id="m265Bar"></i></span>' +
        '<span id="m265State">未开启</span>' +
      '</div>' +
      '<p class="m265-src" style="font-size:11px;color:var(--txt-3);line-height:1.65;margin:8px 0 0">' +
        '只在内存紧张时弹窗询问，不会自行结束任何进程；系统进程、启动器本身和正在运行的游戏永远不会被列入清理范围。' +
      '</p>';

    /* 放在性能页最上方，与其它卡保持同一节奏 */
    pane.insertBefore(card, pane.firstChild);

    var sw = doc.getElementById('m265Sw');
    var on = false;
    try { on = localStorage.getItem(LS) === 'on'; } catch (e) {}
    if (sw) {
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      sw.addEventListener('click', function () {
        var next = !sw.classList.contains('on');
        sw.classList.toggle('on', next);
        sw.setAttribute('aria-checked', next ? 'true' : 'false');
        try { localStorage.setItem(LS, next ? 'on' : 'off'); } catch (e) {}
        applyState(next);
        toast(next ? '内存优化已开启' : '内存优化已关闭', next ? 'ok' : '');
      });
    }

    /* 开着的会话要恢复监控 */
    if (on) applyState(true);
    poll();
    setInterval(poll, 15000);
  }

  function applyState(on) {
    bridge('mem:watch', { on: on }).then(function () {
      var s = doc.getElementById('m265State');
      if (s) {
        s.textContent = on ? '监控中' : '未开启';
        s.className = on ? '' : 'warn';
      }
    });
  }

  function poll() {
    bridge('mem:status', {}).then(function (r) {
      var d = (r && r.ok && r.data) || {};
      var free = doc.getElementById('m265Free');
      var total = doc.getElementById('m265Total');
      var bar = doc.getElementById('m265Bar');
      if (!free || !d.totalMB) return;
      free.textContent = mbText(d.freeMB);
      if (total) total.textContent = mbText(d.totalMB);
      if (bar) bar.style.width = Math.max(2, Math.min(100, Math.round((d.ratio || 0) * 100))) + '%';
    });
  }

  /* ---------------- 告警弹窗 ---------------- */
  var alarmShowing = false;

  function showAlarm(info) {
    if (alarmShowing) return;
    var enabled = false;
    try { enabled = localStorage.getItem(LS) === 'on'; } catch (e) {}
    if (!enabled) return;

    alarmShowing = true;
    injectCss();

    var mask = doc.getElementById(MODAL_ID);
    if (mask) mask.remove();

    mask = doc.createElement('div');
    mask.className = 'm265-mask';
    mask.id = MODAL_ID;
    mask.innerHTML =
      '<div class="m265-dlg" role="dialog" aria-modal="true" aria-label="内存不足">' +
        '<h3>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3.2 20.4 18H3.6L12 3.2Z"/><path d="M12 9.4v4.2"/><circle cx="12" cy="16.1" r=".9" fill="currentColor"/></svg>' +
          '可用内存不多了' +
        '</h3>' +
        '<p class="m265-sub">' +
          '当前可用 <b>' + esc(mbText(info && info.freeMB)) + '</b>，总共 ' + esc(mbText(info && info.totalMB)) + '。' +
          '要不要关掉几个空闲的后台程序，把内存腾出来？<br>只关你勾选的，系统进程和正在运行的游戏不会动。' +
        '</p>' +
        '<div class="m265-list" id="m265List"><div class="m265-empty">正在看看谁在占内存…</div></div>' +
        '<div class="m265-foot">' +
          '<span class="m265-hint" id="m265Sum"></span>' +
          '<button type="button" data-act="cancel">暂不清理</button>' +
          '<button type="button" class="m265-primary" data-act="ok" disabled>清理所选</button>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(mask);

    var listEl = mask.querySelector('#m265List');
    var okBtn = mask.querySelector('[data-act="ok"]');
    var sumEl = mask.querySelector('#m265Sum');

    function close() {
      alarmShowing = false;
      mask.remove();
    }

    function refreshSum() {
      var boxes = mask.querySelectorAll('.m265-row input:checked');
      var sum = 0;
      for (var i = 0; i < boxes.length; i++) sum += Number(boxes[i].getAttribute('data-mb')) || 0;
      if (sumEl) sumEl.textContent = boxes.length ? boxes.length + ' 项 · 约 ' + mbText(sum) : '未选择';
      if (okBtn) okBtn.disabled = boxes.length === 0;
    }

    bridge('mem:candidates', {}).then(function (r) {
      var rows = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
      if (!rows.length) {
        listEl.innerHTML = '<div class="m265-empty">没有找到可以安全关闭的空闲后台程序</div>';
        refreshSum();
        return;
      }
      listEl.innerHTML = rows.map(function (x) {
        return '<label class="m265-row">' +
          '<input type="checkbox" data-pid="' + x.pid + '" data-mb="' + x.mb + '"' + (x.safe ? ' checked' : '') + '>' +
          '<span class="n">' + esc(x.name) + '</span>' +
          (x.safe ? '<span class="tag">建议</span>' : '') +
          '<span class="m">' + esc(mbText(x.mb)) + '</span>' +
        '</label>';
      }).join('');
      listEl.addEventListener('change', refreshSum);
      refreshSum();
    });

    mask.addEventListener('click', function (e) {
      if (e.target === mask) { close(); return; }
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'cancel') { close(); return; }
      if (act === 'ok') {
        var boxes = mask.querySelectorAll('.m265-row input:checked');
        var pids = [];
        for (var i = 0; i < boxes.length; i++) pids.push(Number(boxes[i].getAttribute('data-pid')));
        if (!pids.length) return;
        okBtn.disabled = true;
        okBtn.textContent = '正在清理…';
        bridge('mem:cleanup', { pids: pids }).then(function (res) {
          close();
          if (!res || !res.ok) { toast('清理失败：' + ((res && res.error) || '未知错误'), 'bad'); return; }
          var d = res.data || {};
          var n = (d.killed || []).length;
          if (n === 0) {
            toast('没有可清理的进程（可能已经退出了）', 'bad');
            return;
          }
          var freed = d.freedMB || 0;
          var text = freed > 0
            ? '已清理 ' + n + ' 个后台进程，本次释放 ' + mbText(freed) + ' 内存'
            : '已清理 ' + n + ' 个后台进程（释放量较小，系统会继续回收）';
          toast(text, 'ok');
          poll();
        });
      }
    });
  }

  /* ---------------- 订阅主进程告警 ---------------- */
  function subscribe() {
    if (!window.FMBridge || typeof window.FMBridge.on !== 'function') return;
    try {
      window.FMBridge.on('mem:alarm', function (info) { showAlarm(info || {}); });
    } catch (e) {}
  }

  /* ---------------- 挂载 ---------------- */
  function mount() {
    buildCard();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { setTimeout(mount, 1200); });
  } else {
    setTimeout(mount, 1200);
  }
  setTimeout(mount, 3000);
  setTimeout(mount, 6000);
  subscribe();
})();
