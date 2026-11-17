/* ------------------------------------------------------------------
 * patch/60-no-dlsrc.js — 设置里不再给「默认下载源」，下载源交给启动器自动选
 * 作用域：只删 设置 → 通用 →「下载与网络」卡里的 #dlSrcSeg 那一行，
 *         顺手删掉安装详情弹窗里的下载源卡（#dtSrc），并在卡片底部补一行自动选源说明；
 *         不碰 并行下载数 / 断点续传 / SHA-1 校验 / 下载自动转后台，不改 mc.dlSrc 键名与取值
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, '') : ''; }

  var CARD_TITLE = '下载与网络';
  var NOTE_ID = 'p60DlSrcNote';
  var NOTE_TEXT = '下载源由启动器按网络状况自动选择（国内走 BMCLAPI，海外走官方源），无需手动设置。';

  function injectCss() {
    if (doc.getElementById('patch-60-style')) return;
    var st = doc.createElement('style');
    st.id = 'patch-60-style';
    st.textContent = [
      /* 卡内的自动选源说明：11.5px 与 .conc-tip 同号，左边 16px 对齐卡片内边距；
         灰度用 --txt-2（不用 --txt-3），浅色主题下 0.4 透明度的小字太飘，脚注要看得清 */
      '.p60-note{display:flex;align-items:flex-start;gap:7px;margin:0 16px 12px;font-size:11.5px;line-height:1.65;color:var(--txt-2)}',
      '.p60-note svg{width:14px;height:14px;flex:0 0 14px;margin-top:1.5px;opacity:.8}',
      '.p60-note span{min-width:0}',
      /* 窄屏：说明换行时图标不上浮 */
      '@media (max-width:960px){.p60-note{gap:6px}}'
    ].join('');
    doc.head.appendChild(st);
  }

  /* 「下载与网络」卡：先用 #dlSrcSeg 定位，删掉后靠 group-title 文本找 */
  function findDownloadCard() {
    var seg = doc.getElementById('dlSrcSeg');
    if (seg && seg.closest) {
      var c = seg.closest('.list-card');
      if (c) return c;
    }
    var titles = $$('.group-title');
    for (var i = 0; i < titles.length; i++) {
      if (txt(titles[i]) === CARD_TITLE) {
        var card = titles[i].closest ? titles[i].closest('.list-card') : null;
        if (card) return card;
      }
    }
    return null;
  }

  /* 删掉的整行若留下空 .form-row，一并清掉，避免卡片上下出现双倍间距 */
  function cleanEmptyRows(card) {
    if (!card) return;
    $$('.form-row', card).forEach(function (row) {
      var kids = row.children ? row.children.length : 0;
      if (!kids && !txt(row)) {
        if (row.parentNode) row.parentNode.removeChild(row);
      }
    });
  }

  function removeSettingsSrc() {
    var seg = doc.getElementById('dlSrcSeg');
    if (!seg) return false;
    var row = seg.closest ? seg.closest('.form-row') : null;
    if (row && row.parentNode) row.parentNode.removeChild(row);
    else if (seg.parentNode) seg.parentNode.removeChild(seg);
    return true;
  }

  /* 安装详情弹窗（点「安装」后的版本详情页）里那张「下载源」卡：整卡摘掉，
     否则会剩一个只有标题的空壳。renderDetail 对 #dtSrc 都有 null 守卫，删掉不会报错。 */
  function removeDetailSrc() {
    var box = doc.getElementById('dtSrc');
    if (!box) return false;
    var card = box.closest ? box.closest('.dt-card') : null;
    if (card && card.parentNode) card.parentNode.removeChild(card);
    else if (box.parentNode) box.parentNode.removeChild(box);
    return true;
  }

  function buildNote() {
    var el = doc.createElement('div');
    el.className = 'p60-note';
    el.id = NOTE_ID;
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.1v5.3M12 7.9v.1"/></svg>' +
      '<span></span>';
    var span = $('span', el);
    if (span) span.textContent = NOTE_TEXT;
    return el;
  }

  /* 说明放在卡片最底部（DOM 顺序上仍在 .conc-tip 之后）：
     紧贴 .conc-tip 会被读成「并行下载数」的注解，放到底部才是整卡的脚注。 */
  function addNote(card) {
    if (!card || doc.getElementById(NOTE_ID)) return;
    card.appendChild(buildNote());
  }

  function init() {
    var card = findDownloadCard();
    removeSettingsSrc();
    removeDetailSrc();
    cleanEmptyRows(card);
    injectCss();
    addNote(card);
  }

  function boot() {
    try { init(); } catch (e) { console.warn('[patch 60]', e); }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[patch 60] ready');
})();
