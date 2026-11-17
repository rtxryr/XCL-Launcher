/* ------------------------------------------------------------------
 * patch/20-light-glow.js — 浅色主题自动禁用鼠标跟随光球 + 全局去掉光晕自动流转
 * 作用域：只动 #swGlow / #swOrbs 两个 .opt-row 与 html[data-glow] / html[data-orbs]，
 *         不碰 data-theme 的写入、不碰 data-anim / data-speed / swFrost 等其它开关
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  var D = doc.documentElement;

  var LS_GLOW = 'mc.glow';            /* 与 bindToggle 共用的开关值 */
  var LS_USER = 'mc.glow.user';       /* 用户在深色主题下的真实意愿 */
  var LS_ORBS = 'mc.orbs';
  var LIGHT = { sky: 1, white: 1, lavender: 1 };

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------------- 浅色判定 ----------------
     固定浅色主题：sky / white / lavender。
     自定义主题：applyCustomTheme() 会把 data-theme 写成 white(浅底) 或 dark(深底)，
     基底另存 localStorage['mc.customBase']；因此 custom + data-theme !== 'dark' 即浅色。
     （同时兼容将来若真的出现 data-custom-base 属性时的取值。） */
  function isLight() {
    var t = (D.getAttribute('data-theme') || '').toLowerCase();
    if (LIGHT[t]) return true;
    if (D.getAttribute('data-custom') === 'on') {
      var base = D.getAttribute('data-custom-base') || get('mc.customBase') || (t === 'dark' ? 'dark' : 'light');
      return base !== 'dark';
    }
    return false;
  }

  /* ---------------- 样式 ---------------- */
  function injectCss() {
    if (doc.getElementById('patch-20-style')) return;
    var st = doc.createElement('style');
    st.id = 'patch-20-style';
    st.textContent = [
      /* 整行「变灰」：把 .55 透明度落到图标/标题/说明/开关上，而不是整行，
         否则追加的原因文字会被叠加压到几乎看不清（11px 灰字 × .55 不可读）。 */
      '.opt-row.is-disabled{pointer-events:none}',
      '.opt-row.is-disabled:hover{background:transparent}',
      '.opt-row.is-disabled > .opt-ico,',
      '.opt-row.is-disabled > .opt-main > b,',
      '.opt-row.is-disabled > .opt-main > span:not(.p20-note),',
      '.opt-row.is-disabled > .switch{opacity:.55}',
      '.opt-row.is-disabled .switch{pointer-events:auto;cursor:not-allowed}',
      /* 选择器带上 .opt-main，权重高于页面已有的 .opt-main span */
      '.opt-main .p20-note{display:block;margin-top:5px;font-size:11px;line-height:1.5;color:var(--txt-3)}',
      '.opt-main .p20-note[hidden]{display:none}'
    ].join('');
    doc.head.appendChild(st);
  }

  /* ---------------- 轻提示（页面里的 toast() 在别的闭包里，自建） ---------------- */
  function toast(msg) {
    var wrap = doc.getElementById('toastWrap');
    if (!wrap) return;
    var el = doc.createElement('div');
    el.className = 'toast p20-toast';
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.9v5.4M12 7.7v.1"/></svg><span></span>';
    el.querySelector('span').textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, 2400);
  }

  /* ---------------- DOM 加工 ---------------- */
  function glowRow() {
    var sw = doc.getElementById('swGlow');
    if (!sw || !sw.closest) return null;
    return { sw: sw, row: sw.closest('.opt-row') };
  }

  /* 说明区追加一行灰字（只建一次，用 hidden 控制显隐） */
  function ensureNote() {
    if (doc.getElementById('p20-glow-note')) return;
    var g = glowRow();
    if (!g || !g.row) return;
    var main = g.row.querySelector('.opt-main');
    if (!main) return;
    var s = doc.createElement('span');
    s.id = 'p20-glow-note';
    s.className = 'p20-note';
    s.hidden = true;
    s.textContent = '浅色主题下自动关闭（浅色底上光晕不明显）';
    main.appendChild(s);
  }

  /* 移除「光晕自动流转」整行 */
  function removeOrbsRow() {
    var sw = doc.getElementById('swOrbs');
    if (!sw) return;
    var row = sw.closest ? sw.closest('.opt-row') : null;
    var target = (row && row.parentNode) ? row : sw;
    if (target.parentNode) target.parentNode.removeChild(target);
  }

  /* data-orbs 恒为 off，防别的恢复逻辑回写 */
  function orbsOff() {
    if (D.getAttribute('data-orbs') !== 'off') D.setAttribute('data-orbs', 'off');
    if (get(LS_ORBS) !== 'off') set(LS_ORBS, 'off');
  }

  /* ---------------- 光球锁定 / 还原 ---------------- */
  var locked = false;    /* 当前是否被浅色主题锁住 */
  var prevLight = null;  /* 上一次的判定结果，null = 首次 */

  function lockGlow() {
    if (D.getAttribute('data-glow') !== 'off') D.setAttribute('data-glow', 'off');
    if (get(LS_GLOW) !== 'off') set(LS_GLOW, 'off');
    var g = glowRow();
    if (g) {
      if (g.row) g.row.classList.add('is-disabled');
      g.sw.classList.remove('on');
    }
    var note = doc.getElementById('p20-glow-note');
    if (note) note.hidden = false;
  }

  function unlockGlow() {
    var wish = get(LS_USER) === 'off' ? 'off' : 'on';
    if (D.getAttribute('data-glow') !== wish) D.setAttribute('data-glow', wish);
    if (get(LS_GLOW) !== wish) set(LS_GLOW, wish);
    var g = glowRow();
    if (g) {
      if (g.row) g.row.classList.remove('is-disabled');
      if (wish === 'on') g.sw.classList.add('on');
      else g.sw.classList.remove('on');
    }
    var note = doc.getElementById('p20-glow-note');
    if (note) note.hidden = true;
  }

  /* 统一的判定入口：init 与每次属性变化都跑它 */
  function sync() {
    var light = isLight();
    if (light) {
      if (prevLight !== true) {
        /* 进入浅色（或首次就落在浅色）：记下用户原本的意愿 */
        var known = get(LS_USER);
        var isReloadInLight = (prevLight === null && (known === 'on' || known === 'off'));
        if (!isReloadInLight) set(LS_USER, get(LS_GLOW) === 'off' ? 'off' : 'on');
        locked = true;
      }
      lockGlow();
    } else {
      if (prevLight === true) unlockGlow();
      locked = false;
      /* 深色状态：用户当前的实际选择就是意愿（含本次点击后的值） */
      set(LS_USER, get(LS_GLOW) === 'off' ? 'off' : 'on');
    }
    prevLight = light;
  }

  /* ---------------- 事件 ---------------- */
  /* 浅色下点开关：捕获阶段掐断，阻止 bindToggle 的 target 监听，改为轻提示 */
  function onDocClick(e) {
    if (!locked) return;
    var t = e.target;
    if (t && t.nodeType !== 1) t = t.parentElement;
    if (!t || !t.closest || !t.closest('#swGlow')) return;
    e.preventDefault();
    e.stopPropagation();
    toast('浅色主题下光球不可用，切到深色主题即可开启');
  }

  /* 深色下用户自己拨开关：bindToggle 在元素上先跑完，这里冒泡到 document 时
     localStorage 已是新值，顺手把「用户意愿」同步一份，避免下次进浅色用旧值。 */
  function onDocClickBubble(e) {
    if (locked) return;
    var t = e.target;
    if (t && t.nodeType !== 1) t = t.parentElement;
    if (!t || !t.closest || !t.closest('#swGlow')) return;
    set(LS_USER, get(LS_GLOW) === 'off' ? 'off' : 'on');
  }

  function observe() {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function () {
      orbsOff();  /* 先拉回 data-orbs，再重跑判定；两者都只在值不同时写，不会死循环 */
      sync();
    });
    mo.observe(D, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-custom', 'data-custom-base', 'data-orbs']
    });
  }

  function init() {
    try {
      injectCss();
      ensureNote();
      removeOrbsRow();
      orbsOff();
      sync();
      observe();
      doc.addEventListener('click', onDocClick, true);
      doc.addEventListener('click', onDocClickBubble, false);
    } catch (e) { console.warn('[patch 20]', e); }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();

console.log('[patch 20] ready');
