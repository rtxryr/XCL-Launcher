/* ------------------------------------------------------------------
 * patch/210-skin-hd.js — 皮肤/装扮 HD 渲染升级器
 * 数据源：window.XCL_SKIN_HD_ITEMS（patch/data-skin-hd.js，32×32 精绘）；
 *        没有对应 HD 数据的项目自动回退到原 16×16，只加质感层，不造新形状。
 * 质感三件套：
 *   1) 自动轮廓 —— 暴露在透明区的像素边，向内描 0.16px 深色线，形体从背景里"立"出来
 *   2) 顶行高光 —— 每列最顶部的实心像素叠一层亮线（左上光源）
 *   3) 底行阴影 —— 每列最底部的实心像素叠一层暗线
 * 幂等：HD 渲染过的 svg 带 data-hd 标记；重复执行不叠加。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__xclPatch210) return;
  window.__xclPatch210 = true;

  var doc = document;
  var root = doc.documentElement;
  var STYLE_ID = 'patch-210-style';
  var OUTLINE_T = 0.16;      /* 轮廓线厚度（viewBox 单位） */
  var SHADE_T = 0.2;         /* 顶亮/底暗线厚度 */

  function injectCss() {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      /* HD 图像渲染：让放大后的边缘更干净 */
      '.skin-pix svg[data-hd]{image-rendering:auto;filter:drop-shadow(0 2px 3px rgba(0,0,0,.18))}',
      '#heroDeco svg[data-hd]{filter:drop-shadow(0 6px 14px rgba(0,0,0,.28))}',
      'html[data-motion="off"] .skin-pix svg[data-hd],html[data-motion="off"] #heroDeco svg[data-hd]{filter:none}'
    ].join('\n');
    (doc.head || root).appendChild(st);
  }

  /* ---------------- 颜色工具 ---------------- */
  function hex2rgb(h) {
    var s = h.replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function darken(h, k) {
    var c = hex2rgb(h);
    var r = Math.round(c[0] * k), g = Math.round(c[1] * k), b = Math.round(c[2] * k);
    var v = (1 << 24) + (r << 16) + (g << 8) + b;
    return '#' + v.toString(16).slice(1);
  }
  function lighten(h, k) {
    var c = hex2rgb(h);
    var r = Math.min(255, Math.round(c[0] + (255 - c[0]) * k));
    var g = Math.min(255, Math.round(c[1] + (255 - c[1]) * k));
    var b = Math.min(255, Math.round(c[2] + (255 - c[2]) * k));
    var v = (1 << 24) + (r << 16) + (g << 8) + b;
    return '#' + v.toString(16).slice(1);
  }
  var outlineCache = {};
  function outlineColor(hex) {
    if (!outlineCache[hex]) outlineCache[hex] = darken(hex, 0.42);
    return outlineCache[hex];
  }

  /* ---------------- HD 渲染 ---------------- */
  /**
   * @param item {art: string[], pal: {}}
   * @param opts {outline?:boolean, shade?:boolean}
   */
  function artSvgHd(item, opts) {
    opts = opts || {};
    var art = item.art, pal = item.pal;
    var H = art.length;
    var W = art[0] ? art[0].length : 0;
    if (!W || !H) return '';

    var solid = [];           // {x,y,color}
    var byColor = {};
    var order = [];
    var grid = [];            // grid[y][x] = color | null
    for (var y = 0; y < H; y++) {
      grid[y] = [];
      var row = art[y];
      for (var x = 0; x < W; x++) {
        var ch = row.charAt(x);
        var color = (ch !== '.' && pal[ch]) ? pal[ch] : null;
        grid[y][x] = color;
        if (color) solid.push({ x: x, y: y, c: color });
      }
    }

    /* 1) 同色合并 path */
    for (var i = 0; i < solid.length; i++) {
      var p = solid[i];
      if (!byColor[p.c]) { byColor[p.c] = ''; order.push(p.c); }
      byColor[p.c] += 'M' + p.x + ' ' + p.y + 'h1v1h-1z';
    }

    var dark = {};
    var light = {};
    for (var k = 0; k < order.length; k++) {
      dark[order[k]] = outlineColor(order[k]);
      light[order[k]] = lighten(order[k], 0.35);
    }

    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" ' +
      'aria-hidden="true" focusable="false" shape-rendering="crispEdges" data-hd="1">';
    /* 底色形体 */
    for (var a = 0; a < order.length; a++) {
      out += '<path fill="' + order[a] + '" d="' + byColor[order[a]] + '"/>';
    }

    /* 2) 自动轮廓：暴露在透明区的边，向内描深色线 */
    if (opts.outline !== false) {
      var olPaths = {};
      for (var s = 0; s < solid.length; s++) {
        var q = solid[s];
        var up = q.y > 0 ? grid[q.y - 1][q.x] : null;
        var dn = q.y < H - 1 ? grid[q.y + 1][q.x] : null;
        var lf = q.x > 0 ? grid[q.y][q.x - 1] : null;
        var rt = q.x < W - 1 ? grid[q.y][q.x + 1] : null;
        var seg = '';
        if (!up) seg += 'M' + q.x + ' ' + q.y + 'h1';
        if (!dn) seg += 'M' + q.x + ' ' + (q.y + 1 - OUTLINE_T) + 'h1';
        if (!lf) seg += 'M' + q.x + ' ' + q.y + 'v1';
        if (!rt) seg += 'M' + (q.x + 1 - OUTLINE_T) + ' ' + q.y + 'v1';
        if (seg) {
          var oc = dark[q.c];
          if (!olPaths[oc]) olPaths[oc] = '';
          olPaths[oc] += seg;
        }
      }
      var olKeys = Object.keys(olPaths);
      for (var m = 0; m < olKeys.length; m++) {
        out += '<path fill="none" stroke="' + olKeys[m] + '" stroke-width="' + OUTLINE_T + '" ' +
          'stroke-linecap="butt" d="' + olPaths[olKeys[m]] + '"/>';
      }
    }

    /* 3) 顶行高光 / 底行阴影 */
    if (opts.shade !== false) {
      var hlTop = {}, hlBot = {};
      for (var c2 = 0; c2 < W; c2++) {
        var top = -1, bot = -1, col = null;
        for (var yy = 0; yy < H; yy++) { if (grid[yy][c2]) { top = yy; col = grid[yy][c2]; break; } }
        for (var y2 = H - 1; y2 >= 0; y2--) { if (grid[y2][c2]) { bot = y2; break; } }
        if (top >= 0 && top === bot) continue;            /* 单像素列不画，免得全描 */
        if (top >= 0) {
          var lk = light[grid[top][c2]];
          if (!hlTop[lk]) hlTop[lk] = '';
          hlTop[lk] += 'M' + c2 + ' ' + top + 'h1';
        }
        if (bot >= 0 && bot !== top) {
          var dk = dark[grid[bot][c2]];
          if (!hlBot[dk]) hlBot[dk] = '';
          hlBot[dk] += 'M' + c2 + ' ' + (bot + 1 - SHADE_T) + 'h1';
        }
      }
      Object.keys(hlTop).forEach(function (kk) {
        out += '<path fill="none" stroke="' + kk + '" stroke-width="' + SHADE_T + '" d="' + hlTop[kk] + '" opacity=".55"/>';
      });
      Object.keys(hlBot).forEach(function (kk) {
        out += '<path fill="none" stroke="' + kk + '" stroke-width="' + SHADE_T + '" d="' + hlBot[kk] + '" opacity=".45"/>';
      });
    }

    return out + '</svg>';
  }

  /* ---------------- 数据索引 ---------------- */
  function hdOf(id) {
    var arr = window.XCL_SKIN_HD_ITEMS || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /* ---------------- 替换页面上的 svg ---------------- */
  function upgradePix() {
    var nodes = doc.querySelectorAll('.skin-pix svg:not([data-hd])');
    for (var i = 0; i < nodes.length; i++) {
      var svg = nodes[i];
      var pix = svg.parentNode;                              /* .skin-pix */
      var btn = pix.closest ? pix.closest('.skin-item') : null;
      if (!btn) continue;
      var id = btn.getAttribute('data-id');
      if (!id) continue;
      var item = hdOf(id);
      if (!item) { svg.setAttribute('data-hd', '0'); continue; }   /* 无 HD 数据：标记跳过 */
      var wrap = doc.createElement('span');
      wrap.innerHTML = artSvgHd(item);
      var nu = wrap.firstChild;
      if (nu) svg.parentNode.replaceChild(nu, svg);
    }

    /* 主页 hero：#heroDeco 里是当前选中项（非默认项时才有内容） */
    var deco = doc.getElementById('heroDeco');
    if (deco && !deco.hidden) {
      var cur = null;
      try { cur = window.XCL_SKIN && window.XCL_SKIN.current(); } catch (e) {}
      var it = cur ? hdOf(cur) : null;
      if (it) {
        var curSvg = deco.querySelector('svg');
        if (curSvg && !curSvg.hasAttribute('data-hd')) {
          var w2 = doc.createElement('span');
          w2.innerHTML = artSvgHd(it);
          if (w2.firstChild) deco.innerHTML = '';
          if (w2.firstChild) deco.appendChild(w2.firstChild);
        }
      }
    }
  }

  /* hero 变化（用户换装）→ 重新 HD 化 */
  function watch() {
    var mo = new MutationObserver(function () {
      /* 异步一帧，等原渲染完成再升级 */
      requestAnimationFrame(upgradePix);
    });
    var deco = doc.getElementById('heroDeco');
    var grids = doc.querySelectorAll('#skinGridSkin, #skinGridDeco, #skinZoomGrid, #skinBody');
    if (deco) mo.observe(deco, { childList: true });
    grids.forEach(function (g) { mo.observe(g, { childList: true, subtree: true }); });
    /* skinBody 整体可能还没生成，兜底短轮询 */
    var n = 0;
    var t = setInterval(function () {
      upgradePix();
      if (++n > 30) clearInterval(t);
    }, 400);
  }

  function boot() {
    injectCss();
    upgradePix();
    watch();
    window.XCL_SKIN_HD = { artSvgHd: artSvgHd, upgrade: upgradePix };
    console.log('[patch 210] ready · HD items:', (window.XCL_SKIN_HD_ITEMS || []).length);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
