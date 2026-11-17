/* ------------------------------------------------------------------
 * patch/245-notify.js — 未读红点：常驻呼吸缩放 + 外圈扩散环
 * 作用域：只改 .nt-dot 的观感（侧栏「通知」图标 + 右上角铃铛共用同一个 class）。
 *         通知的出现时机 / 已读逻辑在 ui/index.html 的通知中心里，这里不碰。
 * 约定：有未读 → 红点可见并持续缩放（1.6s 一轮，scale .86 ↔ 1.14）；
 *       未读清零 → 元素 hidden（display:none），动画自然停。
 *       html[data-motion="off"] 或 prefers-reduced-motion → 红点仍在，但不缩放。
 * 性能：只动 transform / opacity，不触发布局与重绘。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch245) return;
  window.__xclPatch245 = true;

  var STYLE_ID = 'patch-245-style';
  var DUR = '1.6s';

  var css = [
    /* 呼吸：整体缩放（0.86 ↔ 1.14，幅度与 0.85↔1.18 一致但更收敛，7px 上不糊） */
    '@keyframes ntDotBreath{',
    '  0%,100%{transform:scale(.86)}',
    '  50%{transform:scale(1.14)}',
    '}',
    /* 扩散环：从点本身向外扩一圈并淡出 */
    '@keyframes ntDotHalo{',
    '  0%{transform:scale(1);opacity:.55}',
    '  70%{opacity:.12}',
    '  100%{transform:scale(2.5);opacity:0}',
    '}',

    /* 覆盖 index.html 里的 ntDotPulse（2.6s 纯 box-shadow），换成持续缩放 */
    '.nt-dot{',
    '  animation:ntDotBreath ' + DUR + ' cubic-bezier(.44,.02,.42,1) infinite;',
    '  box-shadow:0 0 6px -1px var(--nt-dot-glow,rgba(255,77,79,.45));',
    '  transform-origin:50% 50%;',
    '}',
    '.nt-dot::after{',
    '  content:"";position:absolute;inset:0;border-radius:50%;',
    '  background:var(--nt-dot,#ff4d4f);opacity:0;pointer-events:none;',
    '  animation:ntDotHalo ' + DUR + ' cubic-bezier(.22,.61,.36,1) infinite;',
    '}',
    '.nt-dot[hidden]{display:none !important;}',

    /* 动效关闭：红点保留，静止显示 */
    'html[data-motion="off"] .nt-dot,',
    'html[data-motion="off"] .nt-dot::after{animation:none !important;opacity:1}',
    'html[data-motion="off"] .nt-dot::after{display:none}',
    'html[data-motion="off"] .nt-dot{box-shadow:0 0 0 3px var(--nt-dot-glow,rgba(255,77,79,.45))}',
    '@media (prefers-reduced-motion:reduce){',
    '  .nt-dot,.nt-dot::after{animation:none !important}',
    '  .nt-dot::after{display:none}',
    '  .nt-dot{box-shadow:0 0 0 3px var(--nt-dot-glow,rgba(255,77,79,.45))}',
    '}'
  ].join('\n');

  function mount() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
  mount();
})();
