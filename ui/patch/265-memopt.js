/* ------------------------------------------------------------------
 * patch/265-memopt.js — 性能设置「内存优化」（默认关闭）
 *
 * 开启后：
 *   主进程每 20s 看一次可用内存，低于阈值（<10% 且 <1.2GB）推一条 mem:alarm；
 *   右下角浮出一张单层卡片列出「空闲且占用较低」的后台进程（默认全不勾，由用户自己选），
 *   清理后同一张卡片原地变结果，几秒后自动消失 —— 全程只有一层，无需逐层关闭。
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
  var LS_SNOOZE = 'mc.memOptSnooze';   /* 用户选「1 小时内不提醒」的时间戳 */
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

      /* ---------- 单层浮卡（替代「遮罩弹窗 + 结果 toast」两层） ---------- */
      '@keyframes m265PopIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}',
      '.m265-pop{position:fixed;right:20px;bottom:20px;z-index:980;width:min(318px,calc(100vw - 40px));',
      '  padding:14px 15px 13px;border-radius:18px;color:var(--txt);',
      '  background:linear-gradient(165deg,var(--glass-a),var(--glass-b)),var(--panel-2);',
      '  border:1px solid var(--stroke);box-shadow:0 30px 70px -34px var(--shadow-2);',
      '  backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%);',
      '  animation:m265PopIn .34s cubic-bezier(.2,1.1,.4,1) both}',
      '.m265-pop.out{opacity:0;transform:translateY(8px);transition:opacity .26s ease,transform .26s ease;pointer-events:none}',
      '.m265-hd{display:flex;align-items:flex-start;gap:9px}',
      '.m265-hd svg{width:18px;height:18px;flex:0 0 auto;margin-top:1px;color:#e0a34a}',
      '.m265-hd.ok svg{color:var(--accent)}',
      '.m265-hd b{display:block;font-size:13.5px;font-weight:650;letter-spacing:-.01em}',
      '.m265-hd span{display:block;margin-top:2px;font-size:11px;color:var(--txt-3);',
      '  font-variant-numeric:tabular-nums;line-height:1.55}',
      '.m265-lvl{margin:10px 0 0;height:5px;border-radius:999px;background:var(--panel-3,rgba(255,255,255,.08));overflow:hidden}',
      '.m265-lvl i{display:block;height:100%;border-radius:999px;background:#e0a34a;transition:width .45s ease}',
      '.m265-sum{margin:9px 0 0;font-size:11px;line-height:1.5;color:var(--txt-3)}',
      '.m265-sum b{color:var(--txt-2);font-weight:600;font-variant-numeric:tabular-nums}',
      '.m265-rows{margin:10px 0 0;max-height:162px;overflow:auto;border-radius:12px;',
      '  background:var(--panel-3,rgba(255,255,255,.04));border:1px solid var(--stroke)}',
      '.m265-row{display:flex;align-items:center;gap:9px;padding:6px 9px;cursor:pointer;transition:background .16s}',
      '.m265-row:hover{background:var(--panel-2)}',
      '.m265-row input{appearance:none;width:14px;height:14px;flex:0 0 auto;border-radius:4.5px;cursor:pointer;',
      '  border:1.5px solid var(--stroke);background:var(--panel-2);position:relative;transition:background .16s,border-color .16s}',
      '.m265-row input:checked{background:var(--accent);border-color:transparent}',
      '.m265-row input:checked::after{content:"";position:absolute;left:3.6px;top:.6px;width:3.6px;height:7.4px;',
      '  border:1.9px solid var(--on-accent,#08120e);border-top:0;border-left:0;transform:rotate(42deg)}',
      '.m265-row .n{flex:1 1 auto;min-width:0;font-size:11.5px;color:var(--txt-2);overflow:hidden;',
      '  text-overflow:ellipsis;white-space:nowrap}',
      '.m265-row .m{font-size:10.5px;color:var(--txt-3);font-variant-numeric:tabular-nums}',
      '.m265-row .tag{font-size:9px;padding:1px 5px;border-radius:999px;color:var(--accent);',
      '  background:var(--accent-soft,rgba(120,200,160,.14))}',
      '.m265-ft{display:flex;align-items:center;gap:8px;margin-top:11px}',
      '.m265-ft .m265-ghost{margin-right:auto;padding:4px 2px;border:none;background:none;cursor:pointer;',
      '  font-size:11px;color:var(--txt-3);transition:color .18s}',
      '.m265-ft .m265-ghost:hover{color:var(--txt-2)}',
      '.m265-ft button{padding:7px 14px;border-radius:999px;font-size:12px;cursor:pointer;',
      '  border:1px solid var(--stroke);background:var(--panel-2);color:var(--txt-2);transition:color .2s,filter .2s}',
      '.m265-ft button:hover{color:var(--txt)}',
      '.m265-ft button.m265-primary{background:var(--accent);border-color:transparent;',
      '  color:var(--on-accent,#08120e);font-weight:600}',
      '.m265-ft button[disabled]{opacity:.45;pointer-events:none}',
      'html[data-motion="off"] .m265-pop{animation:none}',
      '.m265-toast{position:fixed;right:22px;bottom:22px;z-index:9999;padding:11px 18px;border-radius:var(--r-m);',
      '  background:var(--panel-2);color:var(--txt);border:1px solid var(--stroke);font-size:12.5px;',
      '  box-shadow:0 20px 44px -24px var(--shadow-2);max-width:340px;line-height:1.6}',
      '.m265-toast.ok{border-color:color-mix(in srgb,var(--accent) 45%,transparent)}',
      '.m265-toast.bad{border-color:#e0705f66}',
      /* 提示卡出现时，右下角工具栏让位，避免两个浮层叠在一起 */
      'body.m265-holding #m200Dock{opacity:0;pointer-events:none;transition:opacity .2s ease}'
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
        '只在内存紧张时在右下角问一次，不会自行结束任何进程；系统进程、启动器本身和正在运行的游戏永远不会被列入清理范围。' +
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

  /* ---------------- 告警浮卡（单层：清理后原地变结果并自动消失） ---------------- */
  var alarmShowing = false;
  var cardEl = null;

  function motionOn() { return doc.documentElement.dataset.motion !== 'off'; }

  function holdDock(on) {
    /* 提示卡占的就是右下角，直接把工具栏淡出，避免两个浮层叠在一起 */
    try { doc.body.classList.toggle('m265-holding', !!on); } catch (e) {}
    var dock = doc.getElementById('m200Dock');
    if (dock) {
      dock.style.transition = 'opacity .2s ease';
      dock.style.opacity = on ? '0' : '';
      dock.style.pointerEvents = on ? 'none' : '';
    }
  }

  function dismissCard(wait) {
    if (!cardEl) return;
    var el = cardEl;
    cardEl = null;
    alarmShowing = false;
    holdDock(false);
    if (!wait) { el.remove(); return; }
    el.classList.add('out');
    setTimeout(function () { el.remove(); }, 280);
  }

  function snooze(ms) {
    try { localStorage.setItem(LS_SNOOZE, String(Date.now() + ms)); } catch (e) {}
  }

  function headIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3.2 20.4 18H3.6L12 3.2Z"/><path d="M12 9.4v4.2"/>' +
      '<circle cx="12" cy="16.1" r=".9" fill="currentColor"/></svg>';
  }

  function showResult(freedMB, killedN) {
    if (!cardEl) return;
    cardEl.innerHTML =
      '<div class="m265-hd ok">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/>' +
        '<path d="m8.4 12.3 2.5 2.5 4.7-4.9"/></svg>' +
        '<div><b>' + (freedMB > 0 ? '已释放 ' + mbText(freedMB) : '已清理 ' + killedN + ' 个进程') + '</b>' +
        '<span>关闭了 ' + killedN + ' 个空闲进程，回收会逐步生效</span></div>' +
      '</div>';
    setTimeout(function () { dismissCard(true); }, motionOn() ? 4200 : 5200);
    poll();
  }

  function showAlarm(info) {
    if (alarmShowing) return;
    var enabled = false;
    try { enabled = localStorage.getItem(LS) === 'on'; } catch (e) {}
    if (!enabled) return;

    var until = 0;
    try { until = Number(localStorage.getItem(LS_SNOOZE)) || 0; } catch (e) {}
    if (until > Date.now()) return;

    alarmShowing = true;
    injectCss();

    var freeMB = Number(info && info.freeMB) || 0;
    var totalMB = Number(info && info.totalMB) || 0;
    var pct = totalMB > 0 ? Math.max(2, Math.min(100, Math.round((freeMB / totalMB) * 100))) : 0;

    var el = doc.createElement('div');
    el.className = 'm265-pop';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-label', '可用内存偏低');
    el.innerHTML =
      '<div class="m265-hd">' + headIcon() +
        '<div><b>可用内存偏低</b>' +
        '<span>可用 ' + esc(mbText(freeMB)) + ' / ' + esc(mbText(totalMB)) + ' · 剩 ' + pct + '%</span></div>' +
      '</div>' +
      '<div class="m265-lvl"><i style="width:' + pct + '%"></i></div>' +
      '<div class="m265-sum" id="m265Sum">正在检查空闲进程…</div>' +
      '<div class="m265-rows" id="m265Rows"><div class="m265-row"><span class="n">正在看看谁在占内存…</span></div></div>' +
      '<div class="m265-ft">' +
        '<button type="button" class="m265-ghost" data-act="snooze">1 小时内不提醒</button>' +
        '<button type="button" class="m265-primary" data-act="ok" disabled>清理所选</button>' +
      '</div>';

    doc.body.appendChild(el);
    cardEl = el;
    holdDock(true);

    var rowsEl = el.querySelector('#m265Rows');
    var okBtn = el.querySelector('[data-act="ok"]');

    function syncBtn() {
      var boxes = el.querySelectorAll('.m265-row input:checked');
      if (!okBtn) return;
      okBtn.disabled = boxes.length === 0;
      okBtn.textContent = boxes.length ? '清理 ' + boxes.length + ' 项' : '清理所选';
    }

    bridge('mem:candidates', {}).then(function (r) {
      var rows = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
      /* 后端返回的是 memMB，旧代码读的 mb 一直取不到值（列表里全是 0 MB） */
      rows = rows.map(function (x) {
        return { pid: x.pid, name: x.name, mb: Number(x.memMB != null ? x.memMB : x.mb) || 0 };
      });

      var sumEl = el.querySelector('#m265Sum');
      if (!rows.length) {
        if (sumEl) sumEl.textContent = '没有可安全清理的空闲进程';
        rowsEl.innerHTML = '<div class="m265-row"><span class="n" style="color:var(--txt-3)">' +
          '先关掉几个不用的窗口，比清理更有效</span></div>';
        if (okBtn) okBtn.style.display = 'none';
        setTimeout(function () { dismissCard(true); }, motionOn() ? 8000 : 10000);
        return;
      }

      var total = 0;
      rowsEl.innerHTML = rows.map(function (x) {
        total += x.mb;
        return '<label class="m265-row">' +
          '<input type="checkbox" data-pid="' + x.pid + '" data-mb="' + x.mb + '">' +
          '<span class="n">' + esc(x.name) + '</span>' +
          '<span class="m">' + esc(mbText(x.mb)) + '</span>' +
        '</label>';
      }).join('');
      if (sumEl) {
        sumEl.innerHTML = '找到 <b>' + rows.length + '</b> 个空闲进程，全清理约 <b>' + esc(mbText(total)) + '</b>';
      }
      rowsEl.addEventListener('change', syncBtn);
      syncBtn();
    });

    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;

      if (b.getAttribute('data-act') === 'snooze') {
        snooze(60 * 60 * 1000);
        dismissCard(true);
        return;
      }
      if (b.getAttribute('data-act') !== 'ok') return;

      var boxes = el.querySelectorAll('.m265-row input:checked');
      var pids = [];
      for (var i = 0; i < boxes.length; i++) pids.push(Number(boxes[i].getAttribute('data-pid')));
      if (!pids.length) return;

      okBtn.disabled = true;
      okBtn.textContent = '正在清理…';

      bridge('mem:cleanup', { pids: pids }).then(function (res) {
        if (!res || !res.ok) {
          if (!cardEl) return;
          cardEl.innerHTML = '<div class="m265-hd">' + headIcon() +
            '<div><b>清理没成功</b><span>' + esc((res && res.error) || '未知错误') + '</span></div></div>';
          setTimeout(function () { dismissCard(true); }, 3800);
          return;
        }
        var d = res.data || {};
        var n = (d.killed || []).length;
        if (!n) {
          if (!cardEl) return;
          cardEl.innerHTML = '<div class="m265-hd">' + headIcon() +
            '<div><b>没有可以清理的进程</b><span>它们可能已经自己退出了</span></div></div>';
          setTimeout(function () { dismissCard(true); }, 3200);
          return;
        }
        showResult(d.freedMB || 0, n);
      });
    });

    /* 一直没人理就先收起来，别在右下角杵着 */
    var touched = false;
    el.addEventListener('click', function () { touched = true; }, true);
    el.addEventListener('change', function () { touched = true; }, true);
    setTimeout(function () {
      if (cardEl === el && !touched) dismissCard(true);
    }, 18000);
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
