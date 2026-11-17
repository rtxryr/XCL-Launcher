/* ------------------------------------------------------------------
 * patch/260-beta.js — 关于页「内测功能入口」（默认关闭，可选参加）
 *
 * 流程：
 *   关于 → 内测功能入口（默认关）
 *     ↓ 点开关
 *   弹窗：5 秒倒计时确认，倒计时结束才允许点「同意并开启」
 *     ↓ 同意
 *   主进程 beta:enable → 采集设备画像 + 脱敏日志 → 上传官网 /api/v1/beta/report
 *     ↓
 *   卡片上显示最近一次上报时间与结果，可手动再报一次
 *
 * 关闭开关只写本地状态，不发任何请求。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch260) return;
  window.__xclPatch260 = true;

  var doc = document;
  var CARD_ID = 'm260Card';
  var MODAL_ID = 'm260Modal';
  var COUNTDOWN = 5;
  var DISCLAIMER =
    '开启后我们会用您设备的少量资源来验证XCL启动器的部分功能，如Super X渲染引擎，并上传XCL启动器的部分日志。';

  function $(s, r) { return (r || doc).querySelector(s); }
  function bridge(ch, p) {
    if (!window.FMBridge || typeof window.FMBridge.invoke !== 'function' || window.FMBridge.available === false) {
      return Promise.resolve(null);
    }
    return Promise.resolve(window.FMBridge.invoke(ch, p || {})).catch(function () { return null; });
  }
  function toast(msg) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
    var t = doc.createElement('div');
    t.textContent = msg;
    t.className = 'm260-toast';
    doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  /* ---------------- 样式 ---------------- */
  function injectCss() {
    if (doc.getElementById('patch-260-style')) return;
    var css = [
      '#m260Card .m260-badge{display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 7px;border-radius:999px;',
      '  font-size:10px;font-weight:600;color:var(--accent);background:var(--accent-soft,rgba(120,200,160,.16));vertical-align:1px}',
      '#m260Card .m260-status{margin:10px 0 0;padding-top:10px;border-top:1px solid var(--stroke);',
      '  display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11.5px;color:var(--txt-3)}',
      '#m260Card .m260-status b{color:var(--txt-2);font-weight:600}',
      '#m260Card .m260-status .ok{color:var(--accent)}',
      '#m260Card .m260-status .bad{color:#e0705f}',
      '#m260Card .m260-btn{margin-left:auto;padding:5px 13px;border-radius:var(--r-pill);border:1px solid var(--stroke);',
      '  background:var(--panel-2);color:var(--txt-2);font-size:11.5px;cursor:pointer;transition:color .2s,border-color .2s}',
      '#m260Card .m260-btn:hover{color:var(--txt);border-color:var(--accent)}',
      '#m260Card .m260-btn[disabled]{opacity:.45;pointer-events:none}',
      '#m260Card .m260-src{font-size:11px;color:var(--txt-3);line-height:1.65;margin:8px 0 0}',

      /* 弹窗 */
      '.m260-mask{position:fixed;inset:0;z-index:970;display:grid;place-items:center;padding:24px;',
      '  background:rgba(6,12,10,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
      '.m260-mask[hidden]{display:none}',
      '.m260-dlg{width:min(520px,100%);border-radius:var(--r-xl);padding:24px 26px 20px;color:var(--txt);',
      '  background:linear-gradient(165deg,var(--glass-a),var(--glass-b)),var(--panel-2);border:1px solid var(--stroke);',
      '  box-shadow:0 40px 90px -40px var(--shadow-2)}',
      '.m260-dlg h3{margin:0 0 6px;font-size:16.5px;letter-spacing:-.01em;display:flex;align-items:center;gap:9px}',
      '.m260-dlg h3 svg{width:19px;height:19px;color:var(--accent);flex:0 0 auto}',
      '.m260-dlg .m260-sub{margin:0 0 14px;font-size:11.5px;color:var(--txt-3)}',
      '.m260-dlg .m260-body{margin:0 0 16px;padding:14px 16px;border-radius:var(--r-m);font-size:12.5px;line-height:1.85;',
      '  color:var(--txt-2);background:var(--panel-3,rgba(255,255,255,.05));border:1px solid var(--stroke)}',
      '.m260-dlg .m260-body b{color:var(--txt)}',
      '.m260-dlg .m260-foot{display:flex;align-items:center;gap:10px;justify-content:flex-end}',
      '.m260-dlg button{padding:8px 18px;border-radius:var(--r-pill);font-size:12.5px;cursor:pointer;',
      '  border:1px solid var(--stroke);background:var(--panel-2);color:var(--txt-2);transition:color .2s,border-color .2s,filter .2s}',
      '.m260-dlg button:hover{color:var(--txt)}',
      '.m260-dlg button.m260-primary{background:var(--accent);border-color:transparent;color:var(--on-accent,#08120e);font-weight:600}',
      '.m260-dlg button.m260-primary:hover{filter:brightness(1.06)}',
      '.m260-dlg button[disabled]{opacity:.42;pointer-events:none;filter:grayscale(.5)}',
      '.m260-ring{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:999px;',
      '  font-size:10.5px;font-weight:700;color:var(--accent);border:1.6px solid color-mix(in srgb,var(--accent) 45%,transparent);',
      '  background:var(--accent-soft,rgba(120,200,160,.12))}',
      '.m260-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:9999;padding:10px 18px;',
      '  border-radius:var(--r-pill);background:var(--panel-2);color:var(--txt);border:1px solid var(--stroke);font-size:12.5px}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-260-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  /* ---------------- 卡片 ---------------- */
  function buildCard() {
    if (doc.getElementById(CARD_ID)) return;
    var tab = doc.getElementById('tab-about');
    if (!tab) return;
    injectCss();

    var card = doc.createElement('div');
    card.className = 'glass list-card';
    card.id = CARD_ID;
    card.style.marginBottom = '16px';
    card.style.maxWidth = 'var(--content-max)';
    card.innerHTML =
      '<div class="group-title">内测功能入口<span class="m260-badge">可选</span></div>' +
      '<div class="opt-row">' +
        '<div class="opt-ico">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M9 3h6M10.5 3v5.2L5.9 17a3 3 0 0 0 2.6 4.5h7a3 3 0 0 0 2.6-4.5l-4.6-8.8V3"/>' +
          '<path d="M7.4 14.6h9.2" opacity=".65"/></svg>' +
        '</div>' +
        '<div class="opt-main">' +
          '<b>用我的设备帮助验证新功能</b>' +
          '<span>开启后，启动器会用少量设备资源验证部分功能（如 Super X 渲染引擎），并上传一段脱敏日志，方便我们定位问题。</span>' +
        '</div>' +
        '<div class="switch" id="m260Sw" role="switch" aria-checked="false" aria-label="内测功能入口"></div>' +
      '</div>' +
      '<div class="m260-status">' +
        '<span>当前：<b id="m260Now">未开启</b></span>' +
        '<span>最近上报：<b id="m260Last">—</b></span>' +
        '<span id="m260Res"></span>' +
        '<button type="button" class="m260-btn" id="m260Send" disabled>重新上报</button>' +
      '</div>' +
      '<p class="m260-src">只上传设备信息（CPU、内存、系统版本、启动器版本）与日志末尾，' +
        '日志里的授权码、令牌、邮箱会先被抹掉；不上传账号、存档或任何个人文件。可随时关闭。</p>';

    /* 放在「运行环境」卡之前，关于页最上面保持品牌卡 */
    var env = tab.querySelector('.list-card');
    if (env && env.parentNode === tab) tab.insertBefore(card, env);
    else tab.appendChild(card);

    var sw = doc.getElementById('m260Sw');
    if (sw) {
      sw.addEventListener('click', function () {
        if (sw.classList.contains('on')) {
          /* 关闭：只写状态，不发请求 */
          sw.classList.remove('on');
          sw.setAttribute('aria-checked', 'false');
          bridge('beta:disable', {}).then(function (r) {
            if (r && r.ok) toast('内测功能入口已关闭');
            refresh();
          });
          return;
        }
        openDialog();
      });
    }
    var send = doc.getElementById('m260Send');
    if (send) {
      send.addEventListener('click', function () {
        send.disabled = true;
        send.textContent = '上报中…';
        bridge('beta:send', { reason: 'manual' }).then(function (r) {
          send.disabled = false;
          send.textContent = '重新上报';
          if (!r) { toast('桌面端才能上报'); return; }
          if (r.ok) toast('已上报，感谢帮助');
          else toast('上报失败：' + (r.error || '网络异常'));
          refresh();
        });
      });
    }
    refresh();
  }

  /* ---------------- 状态刷新 ---------------- */
  function refresh() {
    bridge('beta:status', {}).then(function (r) {
      var d = (r && r.ok && r.data) || {};
      var sw = doc.getElementById('m260Sw');
      var now = doc.getElementById('m260Now');
      var last = doc.getElementById('m260Last');
      var res = doc.getElementById('m260Res');
      var send = doc.getElementById('m260Send');
      var on = !!d.enabled;
      if (sw) {
        sw.classList.toggle('on', on);
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      if (now) now.textContent = on ? '已开启' : '未开启';
      if (last) {
        last.textContent = d.lastAt ? fmtTime(d.lastAt) + (d.lastBytes ? ' · ' + fmtBytes(d.lastBytes) : '') : '—';
      }
      if (res) {
        if (!d.lastAt) { res.textContent = ''; res.className = ''; }
        else if (d.lastOk) { res.textContent = '成功'; res.className = 'ok'; }
        else { res.textContent = '失败：' + (d.lastError || '未知'); res.className = 'bad'; }
      }
      if (send) send.disabled = !on;
    });
  }

  /* ---------------- 5 秒倒计时确认弹窗 ---------------- */
  function openDialog() {
    injectCss();
    var mask = doc.getElementById(MODAL_ID);
    if (mask) mask.remove();

    mask = doc.createElement('div');
    mask.className = 'm260-mask';
    mask.id = MODAL_ID;
    mask.innerHTML =
      '<div class="m260-dlg" role="dialog" aria-modal="true" aria-label="开启内测功能入口">' +
        '<h3>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3.2 20.4 18H3.6L12 3.2Z"/><path d="M12 9.4v4.2"/><circle cx="12" cy="16.1" r=".9" fill="currentColor"/></svg>' +
          '开启前请先读一下' +
        '</h3>' +
        '<p class="m260-sub">这段说明会说明开启后做什么，请确认后再继续。</p>' +
        '<div class="m260-body">' + DISCLAIMER + '</div>' +
        '<div class="m260-foot">' +
          '<button type="button" data-act="cancel">暂不开启</button>' +
          '<button type="button" class="m260-primary" data-act="ok" disabled>' +
            '<span class="m260-ring" id="m260Cd">' + COUNTDOWN + '</span>&nbsp;同意并开启' +
          '</button>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(mask);

    var left = COUNTDOWN;
    var okBtn = mask.querySelector('[data-act="ok"]');
    var cd = mask.querySelector('#m260Cd');

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    var timer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        stop();
        if (cd) cd.remove();
        if (okBtn) { okBtn.disabled = false; okBtn.textContent = '同意并开启'; }
        return;
      }
      if (cd) cd.textContent = String(left);
    }, 1000);

    function close() { stop(); mask.remove(); }

    mask.addEventListener('click', function (e) {
      if (e.target === mask) { close(); return; }
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'cancel') { close(); return; }
      if (act === 'ok') {
        if (b.disabled) return;
        close();
        doEnable();
      }
    });

    /* 焦点落到取消上，避免误按回车直接开启 */
    var cancel = mask.querySelector('[data-act="cancel"]');
    if (cancel) setTimeout(function () { cancel.focus(); }, 40);
  }

  function doEnable() {
    var sw = doc.getElementById('m260Sw');
    if (sw) { sw.classList.add('on'); sw.setAttribute('aria-checked', 'true'); }
    var now = doc.getElementById('m260Now');
    if (now) now.textContent = '已开启，正在上报…';
    bridge('beta:enable', {}).then(function (r) {
      if (!r) { toast('桌面端才能使用内测功能'); refresh(); return; }
      if (r.ok) toast('已开启，日志已上报');
      else toast('已开启，但上报失败：' + (r.error || '网络异常'));
      refresh();
    });
  }

  /* ---------------- 挂载 ---------------- */
  function mount() {
    if (!doc.getElementById('tab-about')) return;
    buildCard();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { setTimeout(mount, 900); });
  } else {
    setTimeout(mount, 900);
  }
  /* 设置页是懒加载的，补一次重试 */
  setTimeout(mount, 2400);
  setTimeout(mount, 5000);
})();
