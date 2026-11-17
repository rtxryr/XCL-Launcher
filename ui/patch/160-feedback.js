/* ------------------------------------------------------------------
 * patch/160-feedback.js — Toast 升级 / Tooltip 揭示 / 错误抖动
 * 参考 uimotion.fyi：Toast Notification（滑入不突兀）、Tooltip Reveal（不早不晚）、
 *                    Wiggle Error（说不了话就摇头）
 * 注意：不接管 #toastWrap 的增删逻辑，只给新节点加类；不改原 toast() 函数。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__xclPatch160) return;
  window.__xclPatch160 = true;

  var doc = document;
  var root = doc.documentElement;
  var STYLE_ID = 'patch-160-style';

  function motionOn() { return root.dataset.motion !== 'off'; }

  function injectCss() {
    if (doc.getElementById(STYLE_ID)) return;
    var css = [
      /* ---------- A. Toast：从右侧滑入 + 类型色竖条 ---------- */
      '@keyframes m160Slide{from{opacity:0;transform:translate3d(30px,0,0) scale(.965)}',
      '  62%{opacity:1;transform:translate3d(-2px,0,0) scale(1.005)}',
      '  to{opacity:1;transform:none}}',
      '.toast.m160-toast{position:relative;overflow:hidden;',
      '  animation:m160Slide .44s cubic-bezier(.16,1.02,.3,1) both}',
      '.toast.m160-toast::before{content:"";position:absolute;left:0;top:50%;',
      '  width:3px;height:58%;transform:translateY(-50%);border-radius:999px;',
      '  background:currentColor;opacity:.55}',
      '.toast.m160-ok{color:var(--txt)}',
      '.toast.m160-ok::before{background:var(--accent);opacity:1}',
      '.toast.m160-bad{border-color:var(--danger)}',
      '.toast.m160-bad::before{background:var(--danger);opacity:1}',
      '.toast.m160-bad svg{color:var(--danger)}',
      '.toast.m160-info::before{background:var(--txt-3);opacity:1}',

      /* ---------- B. Tooltip：悬停 220ms 后才出现 ---------- */
      'html[data-motion="on"] .rail-btn .rail-pop{transition-delay:.22s,.22s}',
      'html[data-motion="on"] .rail-btn:not(:hover):not(.force-pop) .rail-pop{transition-delay:0s,0s}',
      'html[data-motion="on"] .rail-btn:hover .rail-pop{',
      '  transition-timing-function:cubic-bezier(.2,.9,.3,1),cubic-bezier(.2,.9,.3,1)}',

      /* ---------- C. 错误抖动 ---------- */
      '@keyframes m160Shake{0%,100%{transform:translate3d(0,0,0)}',
      '  18%{transform:translate3d(-6px,0,0)}36%{transform:translate3d(5px,0,0)}',
      '  54%{transform:translate3d(-4px,0,0)}72%{transform:translate3d(2px,0,0)}}',
      '.m160-shake{animation:m160Shake .42s cubic-bezier(.36,.07,.19,.97) both}',

      /* ---------- 关闭 / 减少动效 ---------- */
      'html[data-motion="off"] .toast.m160-toast{animation:none!important}',
      'html[data-motion="off"] .rail-btn .rail-pop{transition-delay:0s,0s!important}',
      'html[data-motion="off"] .m160-shake{animation:none!important}',
      '@media (prefers-reduced-motion:reduce){',
      '  .toast.m160-toast{animation:none!important}',
      '  .rail-btn .rail-pop{transition-delay:0s,0s!important}',
      '  .m160-shake{animation:none!important}',
      '}'
    ].join('\n');

    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (doc.head || root).appendChild(st);
  }

  /* ---------------- A. Toast 接管 ---------------- */
  var BAD = /失败|错误|出错|无法|不能|不可|异常|超时|拒绝|缺少/i;
  var OK = /成功|完成|已保存|已复制|已删除|已生成|已切换|已就绪|^已/i;

  function decorate(el) {
    if (!el || el.dataset.m160 === '1') return;
    el.dataset.m160 = '1';
    var txt = (el.textContent || '').trim();
    el.classList.add('m160-toast');
    if (BAD.test(txt)) el.classList.add('m160-bad');
    else if (OK.test(txt)) el.classList.add('m160-ok');
    else el.classList.add('m160-info');

    /* 第 3 条起加一点错落，避免几条同时弹成一坨 */
    var sibs = el.parentNode ? el.parentNode.children : [];
    if (sibs.length > 1) {
      el.style.animationDelay = ((sibs.length - 1) * 40) + 'ms';
    }
  }

  function bindToast() {
    var wrap = doc.getElementById('toastWrap');
    if (!wrap) return false;
    /* 已在里面的（理论上不会有）也补齐 */
    for (var i = 0; i < wrap.children.length; i++) decorate(wrap.children[i]);

    var mo = new MutationObserver(function (recs) {
      for (var k = 0; k < recs.length; k++) {
        var added = recs[k].addedNodes;
        for (var n = 0; n < added.length; n++) {
          if (added[n].nodeType === 1 && added[n].classList.contains('toast')) decorate(added[n]);
        }
      }
    });
    mo.observe(wrap, { childList: true });
    return true;
  }

  /* ---------------- C. 抖动 ---------------- */
  function shake(el) {
    if (!el || !el.classList || !motionOn()) return;
    el.classList.remove('m160-shake');
    /* 强制回流，保证连点能重播 */
    void el.offsetWidth;
    el.classList.add('m160-shake');
    el.addEventListener('animationend', function () {
      el.classList.remove('m160-shake');
    }, { once: true });
    setTimeout(function () { el.classList.remove('m160-shake'); }, 900);
  }

  /* 自动触发：toast 是错误类、或输入框被标 aria-invalid */
  function watchErrors() {
    var wrap = doc.getElementById('toastWrap');
    if (wrap) {
      var mo = new MutationObserver(function (recs) {
        for (var k = 0; k < recs.length; k++) {
          var added = recs[k].addedNodes;
          for (var n = 0; n < added.length; n++) {
            var el = added[n];
            if (el.nodeType !== 1) continue;
            var t = (el.textContent || '');
            if (!BAD.test(t)) continue;
            /* 找一个该抖的目标：当前页第一个可见输入框，否则当前页首卡 */
            var page = doc.querySelector('.page.active');
            if (!page) continue;
            var target = null;
            var ins = page.querySelectorAll('input, textarea');
            for (var i = 0; i < ins.length; i++) {
              if (ins[i].offsetParent !== null && !ins[i].readOnly && !ins[i].disabled) { target = ins[i]; break; }
            }
            if (!target) target = page.querySelector('.glass');
            if (target && !/复制|粘贴|剪贴板/.test(t)) shake(target);
          }
        }
      });
      mo.observe(wrap, { childList: true });
    }

    /* aria-invalid 变化 */
    var mo2 = new MutationObserver(function (recs) {
      for (var k = 0; k < recs.length; k++) {
        var t = recs[k].target;
        if (t.getAttribute('aria-invalid') === 'true') shake(t);
      }
    });
    mo2.observe(doc.body, {
      subtree: true, attributes: true, attributeFilter: ['aria-invalid']
    });
  }

  function boot() {
    injectCss();
    if (!bindToast()) {
      /* #toastWrap 还没出来，短轮询几次 */
      var n = 0;
      var t = setInterval(function () { if (bindToast() || ++n > 40) clearInterval(t); }, 200);
    }
    watchErrors();
    window.M160 = { shake: shake, decorate: decorate };
    console.log('[patch 160] ready');
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
