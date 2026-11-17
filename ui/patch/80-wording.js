/* ------------------------------------------------------------------
 * patch/80-wording.js — 术语统一：游戏版本「实例」→「版本」
 * 作用域：只改用户可见文案的文本节点，不动 DOM 结构、不动样式
 * 说明：这里的「实例」指可启动的 Minecraft 版本安装（如 1.20.1 + Fabric），
 *       不是 saves/ 里的存档，所以不能改写成「存档」。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch80) return;
  window.__xclPatch80 = true;

  var doc = document;

  // 整串（trim 后全等）替换：不做模糊匹配，避免误伤别的长句
  var EXACT = {
    '当前实例信息与启动入口都在这里。': '当前版本信息与启动入口都在这里。',
    '下载游戏本体与加载器，安装一个新的可启动实例。': '下载游戏本体与加载器，安装一个新的可启动版本。',
    '当前实例': '当前版本',
    '切换当前实例': '切换版本',
    '设为当前实例': '用这个版本'
  };

  // 前缀/子串替换：只用于运行时拼接出来的瞬时提示（如 toast）
  var FRAG = [
    ['当前实例已切换为 ', '当前版本已切换为 ']
  ];

  var SKIP_TAG = {
    SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, TITLE: 1, OPTION: 1
  };

  /* 拆出首尾空白，只对中间的正文做整串匹配 */
  function swapWhole(text) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    if (!m) return null;
    var core = m[2];
    if (!Object.prototype.hasOwnProperty.call(EXACT, core)) return null;
    return m[1] + EXACT[core] + m[3];
  }

  function swapFrag(text) {
    var out = text;
    for (var i = 0; i < FRAG.length; i++) {
      if (out.indexOf(FRAG[i][0]) !== -1) out = out.split(FRAG[i][0]).join(FRAG[i][1]);
    }
    return out;
  }

  function fixTextNode(node) {
    if (!node || node.nodeType !== 3) return false;
    var val = node.nodeValue;
    if (!val || val.indexOf('实例') === -1) return false;
    var next = swapWhole(val);
    if (next === null) next = swapFrag(val);
    if (next === val) return false;
    node.nodeValue = next;
    return true;
  }

  function canTouch(node) {
    var p = node && node.parentNode;
    if (!p) return false;
    return !SKIP_TAG[p.nodeName];
  }

  /* 遍历一棵子树里的文本节点做精确替换（先收集再改，避免 walker 失效） */
  function sweep(root) {
    if (!root) return 0;
    if (!doc.createTreeWalker) return 0;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return canTouch(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    }, false);
    var list = [];
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.indexOf('实例') !== -1) list.push(n);
    }
    var done = 0;
    for (var i = 0; i < list.length; i++) {
      if (fixTextNode(list[i])) done++;
    }
    return done;
  }

  /* 纯文本元素（标题/按钮）直接改 textContent，返回是否改动 */
  function fixPlainEl(el) {
    if (!el) return false;
    var t = el.textContent;
    if (typeof t !== 'string' || t.indexOf('实例') === -1) return false;
    var next = swapWhole(t);
    if (next === null || next === t) next = swapFrag(t);
    if (next === t) return false;
    el.textContent = next;
    return true;
  }

  /* 版本选择弹窗：#vpTitle / #vpGo 是运行时赋值的，必须监听 +
     兜底；替换后的文本不再命中规则，所以不会自激循环 */
  function watchPicker() {
    var ids = ['vpTitle', 'vpGo'];
    for (var i = 0; i < ids.length; i++) {
      (function (id) {
        var el = doc.getElementById(id);
        if (!el) return;
        if (el.__xclW80) { fixPlainEl(el); return; }
        el.__xclW80 = true;
        try {
          var mo = new MutationObserver(function () { fixPlainEl(el); });
          mo.observe(el, { childList: true, characterData: true, subtree: true });
        } catch (e) {
          console.warn('[patch 80] observe ' + id, e);
        }
        fixPlainEl(el);
      })(ids[i]);
    }
  }

  /* toast 文案是拼出来的、且原函数在闭包里没法安全包装，
     改为盯住 #toastWrap 新增节点做文本纠正：不碰原函数，坏不了 toast */
  function watchToast() {
    var wrap = doc.getElementById('toastWrap');
    if (!wrap || wrap.__xclW80) return;
    wrap.__xclW80 = true;
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var nd = added[j];
            if (nd.nodeType === 1) sweep(nd);
            else if (nd.nodeType === 3) fixTextNode(nd);
          }
        }
      });
      mo.observe(wrap, { childList: true, subtree: true, characterData: true });
    } catch (e) {
      console.warn('[patch 80] observe toast', e);
    }
  }

  function init() {
    try {
      sweep(doc.body);
      watchPicker();
      watchToast();
      // 再兜一次：有些卡片是首帧后才渲染进 DOM 的
      setTimeout(function () {
        try { sweep(doc.body); watchPicker(); watchToast(); }
        catch (e) { console.warn('[patch 80]', e); }
      }, 800);
    } catch (e) {
      console.warn('[patch 80]', e);
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();

  console.log('[patch 80] ready');
})();
