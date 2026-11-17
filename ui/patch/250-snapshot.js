/* ------------------------------------------------------------------
 * patch/250-snapshot.js — 下载列表里的「26.4 快照版」入口
 *
 * 做法（v2）：不再自制卡片/弹窗，而是把官方清单里的 26.4 快照条目
 * 「当成一条正常版本」插进 MANIFEST.versions 并打 __pin 标记，
 * 由 index.html 的 listItems / rowHTML / renderList 原生渲染，
 * 点击走 openDetail → openDownload，与正式版完全是同一套 DOM、同一套样式、
 * 同一个下载选择界面与下载器。缩略图、按钮、hover、圆角全部自动一致。
 *
 * 唯一额外的东西：下载前的一道风险确认（文案由产品给定，一字不改）。
 *
 * 安全约定：
 *   快照是否真的存在以官方版本清单为准（BMCLAPI / Mojang），
 *   清单里没有就如实提示「尚未发布」并给「刷新清单」，绝不伪造版本号或下载地址。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__xclPatch250) return;
  window.__xclPatch250 = true;

  var doc = document;
  var LIST_ID = 'verList';
  var PIN_KEY = '__pin';
  var SNAP_PREFIX = /^26\.4(?:[-.\s]|$)/;
  var TAG_TEXT = '开发中 · 测试版本';
  var COVER_FALLBACK = 'assets/versions/26.3.jpg';   /* 官方没给快照做宣传图，沿用同系列 26.x 的 */
  var WARN_TEXT = '快照是开发中的测试版本，可能不稳定，甚至有损坏现有存档的风险。体验前强烈建议备份世界，或新建独立游戏目录运行快照，避免影响原有生存存档。';

  var riskEl = null, pendingCb = null, noteEl = null, ticking = false;

  function $(s, r) { return (r || doc).querySelector(s); }
  function api() { return window.__MCI || null; }
  function listEl() { return doc.getElementById(LIST_ID); }

  function toast(msg) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
    var t = doc.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:9999;padding:10px 18px;'
      + 'border-radius:var(--r-pill);background:var(--panel-2);color:var(--txt);border:1px solid var(--stroke);font-size:12.5px';
    doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  function attrEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

  /* ---------------- 样式（只补风险确认框与「尚未发布」提示，卡片样式全部复用正式版） ---------------- */
  function injectCss() {
    if (doc.getElementById('patch-250-style')) return;
    var css = [
      /* 风险确认：外壳直接复用下载弹窗的 .dlg-wrap / .dlg / .dlg-head / .dlg-foot */
      '.m250-warn{display:flex;gap:11px;margin-top:16px;padding:13px 15px;border-radius:var(--r-m);',
      '  background:var(--panel);border:1px solid var(--stroke)}',
      '.m250-warn svg{width:17px;height:17px;flex-shrink:0;margin-top:1px;color:var(--warn)}',
      '.m250-warn p{margin:0;font-size:12.5px;line-height:1.8;color:var(--txt-2)}',
      '.m250-warn .m250-id{color:var(--txt);font-weight:600;word-break:break-all}',
      /* 清单里没有 26.4 快照时的提示行（与正式版的空态同一套视觉） */
      '.m250-note{display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:var(--r-l);',
      '  background:var(--panel);border:1px solid var(--stroke)}',
      '.m250-note svg{width:18px;height:18px;flex-shrink:0;color:var(--txt-3)}',
      '.m250-note .m250-nm{flex:1;min-width:0}',
      '.m250-note b{display:block;font-size:12.5px;font-weight:600;color:var(--txt)}',
      '.m250-note span{display:block;margin-top:3px;font-size:11.5px;line-height:1.6;color:var(--txt-3)}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-250-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  /* ---------------- 从清单里挑最新的 26.4 快照 ---------------- */
  function manifest() {
    var a = api();
    if (!a) return null;
    var m = a.manifest();
    return (m && m.versions && m.versions.length) ? m : null;
  }

  function pinnedId() {
    var m = manifest();
    if (!m) return '';
    for (var i = 0; i < m.versions.length; i++) {
      var v = m.versions[i];
      if (v && v[PIN_KEY]) return String(v.id || '');
    }
    return '';
  }

  function pickSnap() {
    var m = manifest();
    if (!m) return null;
    /* 清单按发布时间倒序；latest.snapshot 是最权威的「当前快照」指针 */
    var lid = m.latest && m.latest.snapshot ? String(m.latest.snapshot) : '';
    if (lid && SNAP_PREFIX.test(lid)) {
      for (var i = 0; i < m.versions.length; i++) {
        if (m.versions[i] && m.versions[i].id === lid) return m.versions[i];
      }
    }
    for (var j = 0; j < m.versions.length; j++) {
      var v = m.versions[j];
      if (!v || v[PIN_KEY]) continue;
      if (v.type !== 'snapshot') continue;
      if (SNAP_PREFIX.test(String(v.id || ''))) return v;
    }
    return null;
  }

  function pinCopy(src) {
    var out = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    out[PIN_KEY] = true;
    return out;   /* url / time / releaseTime / sha1 全部沿用清单里的真实值，不补也不改 */
  }

  /* ---------------- 让卡片与正式版完全一致（只改文案与缩略图，不动结构） ---------------- */
  function decorate() {
    var id = pinnedId();
    if (!id) return;
    var card = $('#verList .ver[data-ver="' + attrEsc(id) + '"]');
    if (!card) return;

    /* 版本号后面的徽章：复用正式版 .vtag（与「正式版」同一个元素样式），只换文案 */
    var head = card.querySelector('.ver-t');
    if (head) {
      var tag = head.querySelector('.vtag.snap') || head.querySelector('.vtag:not(.hot)');
      if (!tag) {
        tag = doc.createElement('span');
        tag.className = 'vtag';
        head.appendChild(tag);
      }
      tag.className = 'vtag';
      if (tag.textContent !== TAG_TEXT) tag.textContent = TAG_TEXT;
    }

    /* 缩略图：正式版卡片是 16:9 通栏封面；快照没有官方宣传图，用同系列 26.x 的封面，
       走和 coverHTML 一样的 <img> 结构（去掉 .noimg 后尺寸/裁切完全一致） */
    var cover = card.querySelector('.ver-cover');
    if (cover && cover.classList.contains('noimg')) {
      var img = doc.createElement('img');
      img.src = COVER_FALLBACK;
      img.alt = 'Minecraft Java Edition ' + id + ' 宣传图';
      img.loading = 'lazy';
      img.draggable = false;
      img.addEventListener('error', function () {
        img.remove();
        cover.classList.add('noimg');
      });
      cover.insertBefore(img, cover.firstChild);
      cover.classList.remove('noimg');
      if (!cover.querySelector('.vc-badge')) {
        var b = doc.createElement('span');
        b.className = 'vc-badge';
        b.textContent = '快照';
        cover.appendChild(b);
      }
    }
  }

  /* ---------------- 尚未发布提示 ---------------- */
  function showNote() {
    var list = listEl();
    if (!list) return;
    if (noteEl && noteEl.isConnected) return;
    if (!list.querySelector('.ver[data-ver]')) return;   /* 列表还没渲染出卡片，先不插 */
    noteEl = doc.createElement('div');
    noteEl.className = 'm250-note';
    noteEl.id = 'm250Note';
    noteEl.innerHTML = ''
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
      + '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.6v5.1M12 16.2v.2"/></svg>'
      + '<div class="m250-nm"><b>26.4 快照版尚未发布</b>'
      + '<span>官方版本清单里暂时没有 26.4 系列快照，等它发布后点「刷新清单」就会出现在这里。</span></div>'
      + '<button class="mini-btn" type="button" data-m250-refresh>刷新清单</button>';
    list.insertBefore(noteEl, list.firstChild);
  }
  function hideNote() {
    if (noteEl) { noteEl.remove(); noteEl = null; }
    var stale = doc.getElementById('m250Note');
    if (stale) stale.remove();
  }

  /* ---------------- 风险确认 ---------------- */
  function buildRisk() {
    var wrap = doc.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.id = 'm250Risk';
    wrap.hidden = true;
    wrap.innerHTML = ''
      + '<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="m250RiskTitle">'
      + '  <div class="dlg-head">'
      + '    <div><b id="m250RiskTitle">26.4 快照版</b>'
      + '      <span class="sub" id="m250RiskSub">Minecraft Java Edition · 开发中测试版本</span></div>'
      + '    <button class="mini-btn" type="button" data-m250-cancel>关闭</button>'
      + '  </div>'
      + '  <div class="m250-warn">'
      + '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
      + '      <path d="M12 4.2 21 19.4H3Z"/><path d="M12 9.7v4.2M12 16.6v.2"/></svg>'
      + '    <p><span class="m250-id" id="m250RiskVer">—</span><br>' + WARN_TEXT + '</p>'
      + '  </div>'
      + '  <div class="dlg-foot">'
      + '    <button class="mini-btn" type="button" data-m250-cancel>取消</button>'
      + '    <button class="ver-btn" type="button" data-m250-ok>我已备份，继续下载</button>'
      + '  </div>'
      + '</div>';
    doc.body.appendChild(wrap);
    riskEl = wrap;

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) { closeRisk(); return; }
      if (e.target.closest('[data-m250-cancel]')) { closeRisk(); return; }
      if (e.target.closest('[data-m250-ok]')) {
        var cb = pendingCb;
        pendingCb = null;
        closeRisk();
        if (typeof cb === 'function') setTimeout(cb, 0);
      }
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && riskEl && !riskEl.hidden) closeRisk();
    });
  }

  function openRisk(cb) {
    if (!riskEl) buildRisk();
    pendingCb = cb;
    var id = pinnedId();
    var sub = doc.getElementById('m250RiskSub');
    var ver = doc.getElementById('m250RiskVer');
    if (sub && id) sub.textContent = id + ' · 开发中测试版本';
    if (ver) ver.textContent = id || '26.4 快照';
    riskEl.hidden = false;
    requestAnimationFrame(function () { riskEl.classList.add('on'); });
    var ok = riskEl.querySelector('[data-m250-ok]');
    if (ok) setTimeout(function () { try { ok.focus(); } catch (e) {} }, 80);
  }

  function closeRisk() {
    if (!riskEl) return;
    riskEl.classList.remove('on');
    var ms = (typeof window.animMs === 'function') ? window.animMs(240) : 240;
    setTimeout(function () { if (riskEl && !riskEl.classList.contains('on')) riskEl.hidden = true; }, ms);
    pendingCb = null;
  }

  /* ---------------- 下载入口：确认后交出控制权给正式版的 openDownload ---------------- */
  function realVersion() {
    var a = api(), id = pinnedId();
    if (!a || !id) return null;
    var m = a.manifest();
    var vs = (m && m.versions) || [];
    for (var i = 0; i < vs.length; i++) if (vs[i] && vs[i].id === id) return vs[i];
    return null;
  }

  function downloadAfterWarn() {
    var a = api(), v = realVersion();
    if (!a || !v) { toast('版本清单还没准备好，稍等一下再试'); return; }
    openRisk(function () { a.openDownload(v); });
  }

  /* ---------------- 主循环 ---------------- */
  function tick() {
    if (ticking) return;
    ticking = true;
    try {
      var m = manifest();
      if (!m) return;
      if (pinnedId()) { hideNote(); decorate(); return; }
      var snap = pickSnap();
      if (!snap) { showNote(); return; }
      hideNote();
      m.versions.unshift(pinCopy(snap));
      var a = api();
      if (a) a.renderList(true);   /* 用正式版同一套渲染函数重建列表 */
      decorate();
    } finally {
      ticking = false;
    }
  }

  function bind() {
    /* 列表内的点击：只管快照卡片上的「下载」按钮，其余交给 index.html 原生逻辑（含卡片 → 详情页） */
    doc.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-install]');
      var id = pinnedId();
      if (!btn || !id) return;
      var row = btn.closest('.ver[data-ver]');
      if (!row || row.dataset.ver !== id) return;
      if (btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      downloadAfterWarn();
    }, true);

    /* 详情页的「确认下载」：同一个界面，点击后先过风险确认，再进正式版下载弹窗 */
    doc.addEventListener('click', function (e) {
      var ok = e.target.closest && e.target.closest('#dtConfirm');
      var id = pinnedId();
      if (!ok || !id) return;
      var shown = doc.getElementById('dtVer');
      if (!shown || shown.textContent !== id) return;
      e.preventDefault();
      e.stopPropagation();
      downloadAfterWarn();
    }, true);

    doc.addEventListener('click', function (e) {
      var r = e.target.closest && e.target.closest('[data-m250-refresh]');
      if (!r) return;
      e.preventDefault();
      var a = api();
      if (!a) { toast('当前环境不支持刷新清单'); return; }
      r.disabled = true;
      r.textContent = '刷新中…';
      Promise.resolve(a.reloadManifest()).then(function () {
        setTimeout(function () {
          if (r.isConnected) { r.disabled = false; r.textContent = '刷新清单'; }
          tick();
        }, 220);
      }).catch(function () {
        if (r.isConnected) { r.disabled = false; r.textContent = '刷新清单'; }
        toast('刷新失败，请检查网络');
      });
    }, true);

    /* 列表被重建（搜索 / 切换视图 / 加载更多）后重新贴徽章与缩略图 */
    var list = listEl();
    if (list && 'MutationObserver' in window) {
      var mo = new MutationObserver(function () { decorate(); });
      mo.observe(list, { childList: true });
    }
  }

  function boot() {
    injectCss();
    bind();
    tick();
    setInterval(tick, 1500);   /* 清单异步加载 / 用户点「刷新版本列表」后自动补回置顶条目 */
    setTimeout(tick, 600);
    setTimeout(tick, 1800);
    setTimeout(tick, 3600);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
