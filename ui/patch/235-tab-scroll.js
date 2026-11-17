/* ------------------------------------------------------------------
 * patch/235-tab-scroll.js — 设置页各分栏独立滚动位置
 *
 * 问题：设置页所有分栏（通用 / 账号 / 外观 / 性能 / 更新 / 关于）都放在
 * 同一个滚动容器 `.pages` 里，切换分栏只是 display 切换，滚动位置是共享的。
 * 于是在「通用」里往下翻到一半，切到「外观」也停在一半，看起来像错位。
 *
 * 做法：按分栏记录各自的 scrollTop，切换时保存旧的、恢复新的（瞬时，不走平滑
 * 滚动），第一次进入某一栏固定从顶部开始。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch235) return;
  window.__xclPatch235 = true;

  var doc = document;
  var memo = Object.create(null);   /* { tabName: scrollTop } */
  var currentTab = null;
  var restoring = false;

  function scroller() {
    var page = doc.getElementById('page-settings');
    return page ? page.closest('.pages') : null;
  }

  function tabOf(btn) {
    return btn && btn.getAttribute ? btn.getAttribute('data-tab') : null;
  }

  function activeBtn() {
    var seg = doc.getElementById('setSeg');
    if (!seg) return null;
    var list = seg.querySelectorAll('button[data-tab]');
    for (var i = 0; i < list.length; i++) {
      if (list[i].classList.contains('on')) return list[i];
    }
    return null;
  }

  function setScroll(v) {
    var sc = scroller();
    if (!sc) return;
    restoring = true;
    try {
      /* 容器有 scroll-behavior:smooth，用 instant 强制瞬时归位，
         否则切换分栏时会看到一段无关的滚动动画 */
      if ('scrollBehavior' in doc.documentElement.style) {
        sc.scrollTo({ top: v, left: 0, behavior: 'instant' });
      } else {
        sc.scrollTop = v;
      }
    } catch (e) {
      sc.scrollTop = v;
    }
    requestAnimationFrame(function () { restoring = false; });
  }

  /* 记住当前分栏的滚动位置（切走之前调用） */
  function remember() {
    var sc = scroller();
    if (!sc || !currentTab || restoring) return;
    memo[currentTab] = sc.scrollTop;
  }

  /* 捕获阶段：此时旧分栏还可见、scrollTop 还是旧的 */
  doc.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest('#setSeg button[data-tab]');
    if (!btn) return;

    var next = tabOf(btn);
    if (!next || next === currentTab) return;

    remember();
    var keep = memo[next] || 0;
    currentTab = next;

    /* 内置切换逻辑（冒泡阶段）会把新分栏显示出来，等它跑完再恢复位置 */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { setScroll(keep); });
    });
  }, true);

  /* 首次同步当前分栏 */
  function init() {
    var b = activeBtn();
    currentTab = b ? tabOf(b) : (localStorage.getItem('mc.setTab') || 'general');
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { setTimeout(init, 60); });
  } else {
    setTimeout(init, 60);
  }
})();
