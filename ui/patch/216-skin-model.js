/* ------------------------------------------------------------------
 * patch/216-skin-model.js — 装扮「分型建模」库（被 215 调用）
 * ------------------------------------------------------------------
 * 旧实现的根本问题：所有装扮都建一个 BoxGeometry，六个面贴同一张 32×32
 * 全图 —— 方块勉强能看，火把/剑/镐就成了「三张画糊在盒子上」，人物更是
 * 一张纸片。本文件按物品类型分别建模：
 *
 *   · block（草方块/工作台/箱子/南瓜灯）→ 真立方体 + 分面贴图
 *       侧面：程序化生成的侧壁纹理（草皮/木板/木箱/南瓜棱）或 art 正视图
 *       顶面：从 art 顶部色带取主色 + 确定性伪随机颗粒，生成「俯视」纹理
 *       底面：顶面压暗 0.6；后面镜像 + 压暗 0.72
 *   · torch → 细木杆 + 4 段递减像素火焰（emissive）+ 暖色点光
 *   · tool（木镐/钻石镐/钻石剑）→ 按 alpha 轮廓挤出的薄板
 *       前后两张面片 + 逐像素边界挤出的侧壁（真厚度 0.09）
 *   · char（5 个角色）→ MC 标准分块盒子（头/身/双臂/双腿 6 个 mesh）
 *       贴图按 art 非透明包围盒分区裁剪，盔甲类靠裁剪出色，不加几何
 *
 * 对外：window.XCL_SKIN_MODEL = { kindOf, cameraOf, build, clearCache, stats }
 * 贴图按 item.id + 面 缓存，共享 1 个 BoxGeometry；dispose 由 215 触发。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__xclSkinModel) return;
  window.__xclSkinModel = true;

  var doc = document;

  /* ================= 颜色 ================= */
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : Math.round(v)); }
  function rgbOf(h) {
    var s = String(h || '').replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    if (isNaN(n)) return [140, 140, 140];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexOf(r, g, b) {
    var v = (1 << 24) + (clamp255(r) << 16) + (clamp255(g) << 8) + clamp255(b);
    return '#' + v.toString(16).slice(1);
  }
  function mulHex(h, k) { var c = rgbOf(h); return hexOf(c[0] * k, c[1] * k, c[2] * k); }
  function liftHex(h, k) {
    var c = rgbOf(h);
    return hexOf(c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k);
  }
  function lumaOf(h) { var c = rgbOf(h); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }

  /* ================= 确定性随机（同一 item 每次生成同一张图） ================= */
  function seedOf(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rngOf(seed) {
    var s = (seed || 1) >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ================= canvas 工具 ================= */
  function makeCanvas(w, h) {
    var c = doc.createElement('canvas');
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  }
  function gridToCanvas(grid, w, h) {
    var cv = makeCanvas(w, h), g = cv.getContext('2d');
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var c = grid[y] && grid[y][x];
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect(x, y, 1, 1);
      }
    }
    return cv;
  }
  /** 透明处补一层底色：立方体面需要实心，否则圆角/斜边会透出背面 */
  function fillBehind(cv, color) {
    var g = cv.getContext('2d');
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = color || '#000000';
    g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'source-over';
    return cv;
  }
  function mirrorCanvas(cv) {
    var out = makeCanvas(cv.width, cv.height), g = out.getContext('2d');
    g.translate(cv.width, 0);
    g.scale(-1, 1);
    g.drawImage(cv, 0, 0);
    return out;
  }
  function scaleCanvas(cv, tw, th) {
    var out = makeCanvas(tw, th), g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, tw, th);
    return out;
  }

  /* ================= art 取样 ================= */
  function artOf(item) { return (item && item.art) || []; }
  function palOf(item) { return (item && item.pal) || {}; }
  function colorAt(item, x, y) {
    var row = artOf(item)[y];
    if (!row) return null;
    var ch = row.charAt(x);
    if (ch === '.' ) return null;
    return palOf(item)[ch] || null;
  }

  var bboxCache = {};
  /** art 的非透明像素包围盒（定位用，避免切除空白边） */
  function bboxOf(item) {
    if (!item) return null;
    if (bboxCache[item.id]) return bboxCache[item.id];
    var art = artOf(item), H = art.length, W = H ? art[0].length : 0;
    var x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (var y = 0; y < H; y++) {
      var row = art[y];
      for (var x = 0; x < W; x++) {
        if (row.charAt(x) !== '.' && palOf(item)[row.charAt(x)]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    var bb = { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    bboxCache[item.id] = bb;
    return bb;
  }

  /** 按频次取某一行带内的主色（minLuma 过滤近黑描边，避免顶面全黑） */
  function bandColors(item, ya, yb, opt) {
    opt = opt || {};
    var bb = bboxOf(item);
    if (!bb) return [];
    var lo = Math.max(bb.y0, Math.round(ya));
    var hi = Math.min(bb.y1, Math.round(yb));
    var count = {}, order = [];
    for (var y = lo; y <= hi; y++) {
      for (var x = bb.x0; x <= bb.x1; x++) {
        var col = colorAt(item, x, y);
        if (!col) continue;
        if (opt.minLuma && lumaOf(col) < opt.minLuma) continue;
        if (!count[col]) { count[col] = 0; order.push(col); }
        count[col]++;
      }
    }
    order.sort(function (a, b) { return count[b] - count[a]; });
    return order;
  }

  function darkestOf(item) {
    var cols = bandColors(item, bboxOf(item).y0, bboxOf(item).y1, {});
    var best = null, bl = 2;
    for (var i = 0; i < cols.length; i++) {
      var l = lumaOf(cols[i]);
      if (l < bl) { bl = l; best = cols[i]; }
    }
    return best || '#141414';
  }

  /** art 裁到包围盒（fill: false = 保留透明 / 颜色串 = 补底 / 省略 = 补最深色） */
  function croppedArt(item, fill) {
    var bb = bboxOf(item);
    var grid = [];
    for (var y = bb.y0; y <= bb.y1; y++) {
      var r = [];
      for (var x = bb.x0; x <= bb.x1; x++) r.push(colorAt(item, x, y));
      grid.push(r);
    }
    var cv = gridToCanvas(grid, bb.w, bb.h);
    if (fill === false) return cv;
    return fillBehind(cv, fill || darkestOf(item));
  }

  /** 从 art 裁一块区域并重采样到目标尺寸（人物各部件贴图） */
  function cropScaled(item, x0, y0, x1, y1, tw, th, fill) {
    var grid = [];
    for (var y = y0; y <= y1; y++) {
      var r = [];
      for (var x = x0; x <= x1; x++) r.push(colorAt(item, x, y));
      grid.push(r);
    }
    var cv = gridToCanvas(grid, x1 - x0 + 1, y1 - y0 + 1);
    if (fill) fillBehind(cv, fill);
    return scaleCanvas(cv, tw, th);
  }

  function dominantOf(item, x0, y0, x1, y1, minLuma) {
    var count = {}, order = [];
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var c = colorAt(item, x, y);
        if (!c) continue;
        if (minLuma && lumaOf(c) < minLuma) continue;
        if (!count[c]) { count[c] = 0; order.push(c); }
        count[c]++;
      }
    }
    order.sort(function (a, b) { return count[b] - count[a]; });
    return order[0] || '#8a8a8a';
  }

  /* ================= 贴图缓存 ================= */
  var texCache = {};
  function texFrom(key, cv) {
    if (texCache[key]) return texCache[key];
    var t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.encoding = THREE.sRGBEncoding;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    texCache[key] = t;
    return t;
  }
  /** 纯色（带极轻噪点，避免大面积死板） */
  function flatTex(color, tag) {
    var key = 'flat|' + tag + '|' + color;
    if (texCache[key]) return texCache[key];
    var cv = makeCanvas(8, 8), g = cv.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 8, 8);
    var rnd = rngOf(seedOf(key));
    for (var i = 0; i < 7; i++) {
      g.fillStyle = rnd() < 0.5 ? mulHex(color, 0.94) : liftHex(color, 0.05);
      g.fillRect((rnd() * 8) | 0, (rnd() * 8) | 0, 1, 1);
    }
    return texFrom(key, cv);
  }

  function clearCache() {
    for (var k in texCache) {
      try { texCache[k].dispose(); } catch (e) { /* 忽略 */ }
    }
    texCache = {};
  }

  /* ================= 材质 / 几何 ================= */
  var _box = null;
  function boxGeo() {
    if (!_box) _box = new THREE.BoxGeometry(1, 1, 1);
    return _box;
  }

  function Ctx() { this.mats = []; }
  /** map 可空；lum 控制面亮度（贴图为乘算），tint 给纯色面用 */
  function mkMat(c, opt) {
    opt = opt || {};
    var p = { transparent: false, alphaTest: 0.5 };
    if (opt.map) p.map = opt.map;
    p.color = new THREE.Color(opt.tint || '#ffffff')
      .multiplyScalar(opt.lum == null ? 1 : opt.lum);
    if (opt.emissive) {
      p.emissive = new THREE.Color(opt.emissive);
      p.emissiveIntensity = opt.emi == null ? 1 : opt.emi;
    }
    if (opt.side) p.side = opt.side;
    if (opt.vertexColors) p.vertexColors = true;
    var m = new THREE.MeshLambertMaterial(p);
    c.mats.push(m);
    return m;
  }

  function addBox(c, group, w, h, d, mats, x, y, z) {
    var mesh = new THREE.Mesh(boxGeo(), mats);
    mesh.scale.set(w, h, d);
    mesh.position.set(x || 0, y || 0, z || 0);
    group.add(mesh);
    c.meshes = (c.meshes || 0) + 1;
    return mesh;
  }

  /* ================= 顶面 / 侧壁：程序化纹理 ================= */
  /**
   * 顶面（俯视）纹理：不能拿正视图压扁。
   * 取 art 顶部色带的主色 + item.id 做种子的颗粒，铺成自然材质。
   * style: grass | grid | grain | rim
   */
  function topCanvas(item, style) {
    var bb = bboxOf(item);
    var band = Math.max(5, Math.round(bb.h * 0.34));
    var cols = bandColors(item, bb.y0, bb.y0 + band, { minLuma: 0.13 });
    if (cols.length < 2) cols = bandColors(item, bb.y0, bb.y1, { minLuma: 0.13 });
    if (cols.length < 2) cols = bandColors(item, bb.y0, bb.y1, {});
    var base = cols[0] || '#8a8a8a';
    var acc = cols.slice(1, 4);
    while (acc.length < 2) acc.push(acc.length ? liftHex(base, 0.16) : mulHex(base, 0.8));

    var S = 16, g = [], rnd = rngOf(seedOf(item.id + '|top'));
    for (var y = 0; y < S; y++) {
      g[y] = [];
      for (var x = 0; x < S; x++) g[y][x] = base;
    }

    /* 颗粒：单点 + 短条，像草地/木屑的自然分布 */
    var dots = style === 'grid' ? 20 : 56;
    for (var i = 0; i < dots; i++) {
      var px = (rnd() * S) | 0, py = (rnd() * S) | 0;
      var c = acc[(rnd() * acc.length) | 0];
      g[py][px] = c;
      if (rnd() < 0.42 && px + 1 < S) g[py][px + 1] = c;
      if (rnd() < 0.28 && py + 1 < S) g[py + 1][px] = c;
    }

    if (style === 'grid') {
      /* 工作台：木纹方格 */
      var line = mulHex(base, 0.62);
      for (i = 0; i < S; i++) { g[5][i] = i % 3 ? line : mulHex(base, 0.5); g[10][i] = i % 3 ? line : mulHex(base, 0.5); }
      for (i = 0; i < S; i++) { g[i][5] = i % 3 ? line : mulHex(base, 0.5); g[i][10] = i % 3 ? line : mulHex(base, 0.5); }
      for (i = 0; i < S; i++) { g[0][i] = mulHex(base, 0.78); g[S - 1][i] = mulHex(base, 0.7); }
    } else if (style === 'grain') {
      /* 箱子：横向木纹 */
      for (y = 0; y < S; y++) {
        if (y % 4 === 0) for (x = 0; x < S; x++) g[y][x] = mulHex(g[y][x], 0.74);
        for (x = 0; x < S; x++) if (rnd() < 0.22) g[y][x] = mulHex(g[y][x], 0.86);
      }
    } else if (style === 'rim') {
      /* 南瓜灯：橙色 + 内圈更深 */
      for (i = 0; i < S; i++) {
        g[0][i] = mulHex(base, 0.66);
        g[S - 1][i] = mulHex(base, 0.6);
        g[i][0] = mulHex(base, 0.7);
        g[i][S - 1] = mulHex(base, 0.7);
      }
      for (i = 3; i < S - 3; i++) { g[3][i] = mulHex(g[3][i], 0.82); g[S - 4][i] = mulHex(g[S - 4][i], 0.82); }
    } else {
      /* 草方块：更深草边 + 左上光斑 */
      for (i = 0; i < S; i++) {
        g[0][i] = mulHex(g[0][i], 0.6);
        g[S - 1][i] = mulHex(g[S - 1][i], 0.64);
        g[i][0] = mulHex(g[i][0], 0.7);
        g[i][S - 1] = mulHex(g[i][S - 1], 0.68);
      }
      for (i = 1; i < 7; i++) g[1][i] = liftHex(g[1][i], 0.1);
    }
    return gridToCanvas(g, S, S);
  }

  /**
   * 侧壁纹理。style: grass（草皮+泥土）| plank（木板）| crate（木箱）| ridge（南瓜棱）
   */
  function sideCanvas(item, style) {
    var bb = bboxOf(item);
    var S = 16, g = [], x, y, i;
    for (y = 0; y < S; y++) { g[y] = []; for (x = 0; x < S; x++) g[y][x] = '#888888'; }
    var rnd = rngOf(seedOf(item.id + '|side'));

    if (style === 'grass') {
      var greens = bandColors(item, bb.y0, bb.y0 + Math.max(5, Math.round(bb.h * 0.32)), { minLuma: 0.2 });
      var dirts = bandColors(item, bb.y0 + Math.round(bb.h * 0.45), bb.y1, { minLuma: 0.06 });
      if (!greens.length) greens = ['#6fbf4a', '#4e9e33'];
      if (!dirts.length) dirts = [mulHex(greens[0], 0.55)];
      var dirt = dirts[0];
      for (y = 0; y < S; y++) {
        for (x = 0; x < S; x++) {
          g[y][x] = dirt;
          var rr = rnd();
          if (rr < 0.16) g[y][x] = mulHex(dirt, 0.82);
          else if (rr < 0.26) g[y][x] = liftHex(dirt, 0.07);
        }
      }
      /* 草皮：顶部 4~6 行，下沿参差 */
      for (x = 0; x < S; x++) {
        var len = 4 + (rnd() < 0.42 ? 1 : 0) + (rnd() < 0.18 ? 1 : 0);
        for (y = 0; y < len; y++) {
          var gc = greens.length > 1 && rnd() < 0.38
            ? greens[1 + ((rnd() * (greens.length - 1)) | 0)]
            : greens[0];
          g[y][x] = gc;
        }
        if (len < S) g[len][x] = mulHex(g[len][x], 0.72);
      }
      g[0][0] = mulHex(g[0][0], 0.9);
    } else if (style === 'plank') {
      var woods = bandColors(item, bb.y0 + Math.round(bb.h * 0.4), bb.y1, { minLuma: 0.1 });
      if (!woods.length) woods = ['#96652e', '#6e4419'];
      var base = woods[0];
      for (y = 0; y < S; y++) {
        for (x = 0; x < S; x++) {
          g[y][x] = base;
          if (rnd() < 0.2) g[y][x] = mulHex(base, 0.9);
        }
      }
      /* 4 行一条木板，缝线加深 */
      for (y = 0; y < S; y += 4) {
        for (x = 0; x < S; x++) g[y][x] = mulHex(base, 0.66);
      }
      /* 竖向木纹 */
      for (i = 0; i < 26; i++) {
        x = (rnd() * S) | 0;
        y = (rnd() * S) | 0;
        var vlen = 2 + ((rnd() * 3) | 0);
        for (var k = 0; k < vlen && y + k < S; k++) g[y + k][x] = mulHex(base, 0.86);
      }
      g[0][0] = mulHex(base, 0.92);
    } else if (style === 'crate') {
      var w2 = bandColors(item, bb.y0 + Math.round(bb.h * 0.2), bb.y1, { minLuma: 0.12 });
      if (!w2.length) w2 = ['#a9722f', '#8a5a24'];
      var cb = w2[0];
      for (y = 0; y < S; y++) {
        for (x = 0; x < S; x++) {
          g[y][x] = cb;
          if (rnd() < 0.15) g[y][x] = mulHex(cb, 0.9);
        }
      }
      /* 竖板缝 */
      for (x = 0; x < S; x += 5) {
        for (y = 0; y < S; y++) g[y][x] = mulHex(cb, 0.62);
      }
      /* 顶部箱箍 */
      for (x = 0; x < S; x++) {
        g[2][x] = mulHex(cb, 0.58);
        g[3][x] = mulHex(cb, 1.12);
      }
      for (y = 0; y < 5; y++) { g[y][0] = mulHex(cb, 0.6); g[y][S - 1] = mulHex(cb, 0.6); }
    } else {
      /* ridge：南瓜纵向棱 */
      var os = bandColors(item, bb.y0 + Math.round(bb.h * 0.3), bb.y1, { minLuma: 0.18 });
      if (!os.length) os = ['#e8862a', '#c96a18'];
      var ob = os[0];
      for (y = 0; y < S; y++) {
        for (x = 0; x < S; x++) {
          var rr2 = rnd();
          g[y][x] = rr2 < 0.14 ? mulHex(ob, 0.86) : (rr2 > 0.94 ? liftHex(ob, 0.08) : ob);
        }
      }
      for (x = 0; x < S; x++) {
        var m = x % 4;
        for (y = 0; y < S; y++) {
          if (m === 0) g[y][x] = mulHex(ob, 0.72);
          else if (m === 2) g[y][x] = liftHex(ob, 0.07);
        }
      }
      for (x = 0; x < S; x++) { g[0][x] = mulHex(g[0][x], 0.7); g[S - 1][x] = mulHex(g[S - 1][x], 0.64); }
    }
    return gridToCanvas(g, S, S);
  }

  /* ================= 方块 ================= */
  /* artFace：'top' = art 本身是俯视图（草方块/工作台）→ 贴顶面；
   *          'front' = art 是正视图（箱子/南瓜灯）→ 贴正面 */
  var BLOCK_CFG = {
    grass_block: { artFace: 'top', side: 'grass', top: 'grass' },
    crafting_table: { artFace: 'top', side: 'plank', top: 'grid' },
    chest: { artFace: 'front', side: 'crate', top: 'grain' },
    jack_o_lantern: { artFace: 'front', side: 'ridge', top: 'rim' }
  };

  function buildBlock(item, c) {
    var cfg = BLOCK_CFG[item.id] || { artFace: 'front', side: 'plank', top: 'grain' };
    var artCv = croppedArt(item);
    var artTex = texFrom(item.id + '|art', artCv);
    var artMir = texFrom(item.id + '|artM', mirrorCanvas(artCv));
    var topTex = texFrom(item.id + '|top', topCanvas(item, cfg.top));
    var sideTex = texFrom(item.id + '|side', sideCanvas(item, cfg.side));
    var sideMir = texFrom(item.id + '|sideM', mirrorCanvas(sideCanvas(item, cfg.side)));

    /* BoxGeometry 面序：+x, -x, +y, -y, +z, -z */
    var mats;
    if (cfg.artFace === 'top') {
      mats = [
        mkMat(c, { map: sideTex, lum: 0.80 }),   /* 右 */
        mkMat(c, { map: sideTex, lum: 0.88 }),   /* 左 */
        mkMat(c, { map: artTex, lum: 1.05 }),    /* 顶（俯视图） */
        mkMat(c, { map: sideTex, lum: 0.5 }),    /* 底 */
        mkMat(c, { map: sideTex, lum: 1.0 }),    /* 前 */
        mkMat(c, { map: sideMir, lum: 0.72 })    /* 后 */
      ];
    } else {
      mats = [
        mkMat(c, { map: sideTex, lum: 0.80 }),
        mkMat(c, { map: sideTex, lum: 0.88 }),
        mkMat(c, { map: topTex, lum: 1.05 }),
        mkMat(c, { map: topTex, lum: 0.6 }),
        mkMat(c, { map: artTex, lum: 1.0 }),
        mkMat(c, { map: artMir, lum: 0.72 })
      ];
    }
    var g = new THREE.Group();
    addBox(c, g, 1, 1, 1, mats, 0, 0, 0);
    return g;
  }

  /* ================= 火把 ================= */
  function woodCanvas(item) {
    var bb = bboxOf(item);
    var cols = bandColors(item, bb.y0 + Math.round(bb.h * 0.35), bb.y1, { minLuma: 0.1 });
    if (!cols.length) cols = ['#a8763e'];
    var base = cols[0];
    var S = 16, g = [], rnd = rngOf(seedOf(item.id + '|wood'));
    for (var y = 0; y < S; y++) { g[y] = []; for (var x = 0; x < S; x++) g[y][x] = base; }
    for (var x2 = 0; x2 < S; x2++) {
      if (rnd() < 0.3) {
        var c2 = cols[1 + ((rnd() * Math.max(1, cols.length - 1)) | 0)] || mulHex(base, 0.84);
        for (var y2 = 0; y2 < S; y2++) if (rnd() < 0.8) g[y2][x2] = c2;
      }
    }
    for (var i = 0; i < 10; i++) g[(rnd() * S) | 0][(rnd() * S) | 0] = mulHex(base, 0.7);
    return gridToCanvas(g, S, S);
  }

  function buildTorch(item, c) {
    var pal = palOf(item);
    var g = new THREE.Group();

    /* 木杆：细长盒 + 纵向木纹 */
    var wood = texFrom(item.id + '|wood', woodCanvas(item));
    var stickMat = mkMat(c, { map: wood, lum: 1 });
    addBox(c, g, 0.15, 0.62, 0.15, stickMat, 0, -0.20, 0);
    /* 顶部缠布（比杆略粗一圈） */
    var wrapCol = pal.K || '#53361a';
    var wrapMat = mkMat(c, { map: flatTex(wrapCol, 'tw'), lum: 1.05 });
    addBox(c, g, 0.185, 0.055, 0.185, wrapMat, 0, 0.135, 0);

    /* 火焰：4 段递减像素块（外橙内白），emissive 自发光 */
    var ramp = [
      { y: 0.225, s: 0.255, h: 0.15, col: pal.B || '#e0521f', emi: 0.55 },
      { y: 0.335, s: 0.19, h: 0.125, col: pal.H || '#f07e2e', emi: 0.7 },
      { y: 0.425, s: 0.125, h: 0.105, col: pal.Y || '#ffe08a', emi: 0.85 },
      { y: 0.495, s: 0.07, h: 0.08, col: pal.W || '#fff6d8', emi: 1 }
    ];
    for (var i = 0; i < ramp.length; i++) {
      var r = ramp[i];
      var m = mkMat(c, { tint: r.col, emissive: r.col, emi: r.emi, lum: 1 });
      addBox(c, g, r.s, r.h, r.s, m, 0, r.y, 0);
    }

    /* 暖光：让木杆上端被火照亮 */
    var pl = new THREE.PointLight(0xffb264, 0.95, 2.4, 2);
    pl.position.set(0, 0.34, 0.05);
    g.add(pl);
    g.userData.light = pl;
    return g;
  }

  /* ================= 工具：按 alpha 轮廓挤出薄板 ================= */
  function buildTool(item, c) {
    var bb = bboxOf(item);
    var span = Math.max(bb.w, bb.h);
    var u = 1.16 / span;                 /* 1 art 像素 → 世界单位 */
    var t = 0.09;                        /* 板厚（0.06~0.09） */
    var half = t / 2;

    var artCv = croppedArt(item, false);   /* 保留透明：轮廓需要 alpha 判定 */
    var artTex = texFrom(item.id + '|art', artCv);
    var artMir = texFrom(item.id + '|artM', mirrorCanvas(artCv));

    var g = new THREE.Group();

    /* 正面片 / 背面片（背面镜像 + 压暗 0.7） */
    var fw = bb.w * u, fh = bb.h * u;
    var front = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fh),
      mkMat(c, { map: artTex, lum: 1 })
    );
    front.position.z = half;
    g.add(front);
    c.meshes = (c.meshes || 0) + 1;

    var back = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fh),
      mkMat(c, { map: artMir, lum: 0.7 })
    );
    back.position.z = -half;
    back.rotation.y = Math.PI;
    g.add(back);
    c.meshes = (c.meshes || 0) + 1;

    /* 侧壁：逐个边界像素挤出四边形（合并成一个 BufferGeometry） */
    var mask = [];
    for (var y = 0; y < bb.h; y++) {
      mask[y] = [];
      for (var x = 0; x < bb.w; x++) mask[y][x] = !!colorAt(item, bb.x0 + x, bb.y0 + y);
    }
    function solid(x, y) {
      if (x < 0 || y < 0 || x >= bb.w || y >= bb.h) return false;
      return mask[y][x];
    }

    var pos = [], col = [];
    var ox = bb.w / 2, oy = bb.h / 2;
    function push(v, h, shadeK) {
      /* v 四角：世界坐标，两个三角形 */
      var c0 = mulHex(h, shadeK);
      pos.push(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
      pos.push(v[0], v[1], v[2], v[6], v[7], v[8], v[9], v[10], v[11]);
      var cc = rgbOf(c0);
      var one = [cc[0] / 255, cc[1] / 255, cc[2] / 255];
      for (var i = 0; i < 6; i++) col.push(one[0], one[1], one[2]);
    }

    for (var yy = 0; yy < bb.h; yy++) {
      for (var xx = 0; xx < bb.w; xx++) {
        if (!mask[yy][xx]) continue;
        var hx0 = (xx - ox) * u, hx1 = hx0 + u;
        var hy1 = (oy - yy) * u, hy0 = hy1 - u;
        var hex = colorAt(item, bb.x0 + xx, bb.y0 + yy) || '#888888';
        if (!solid(xx - 1, yy)) {
          push([hx0, hy0, -half, hx0, hy1, -half, hx0, hy1, half, hx0, hy0, half], hex, 0.62);
        }
        if (!solid(xx + 1, yy)) {
          push([hx1, hy0, -half, hx1, hy1, -half, hx1, hy1, half, hx1, hy0, half], hex, 0.62);
        }
        if (!solid(xx, yy - 1)) {
          push([hx0, hy1, -half, hx1, hy1, -half, hx1, hy1, half, hx0, hy1, half], hex, 0.9);
        }
        if (!solid(xx, yy + 1)) {
          push([hx0, hy0, -half, hx1, hy0, -half, hx1, hy0, half, hx0, hy0, half], hex, 0.5);
        }
      }
    }

    var rimGeo = new THREE.BufferGeometry();
    rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rimGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    rimGeo.computeVertexNormals();
    var rimMat = mkMat(c, { vertexColors: true, lum: 1, side: THREE.DoubleSide });
    var rim = new THREE.Mesh(rimGeo, rimMat);
    g.add(rim);
    c.meshes = (c.meshes || 0) + 1;
    c.geos.push(rimGeo);
    c.geos.push(front.geometry);
    c.geos.push(back.geometry);

    /* 像握在手里的角度：略转 Z，再转 Y 露出厚度 */
    g.rotation.z = -0.22;
    g.rotation.y = -0.46;
    return g;
  }

  /* ================= 人物：MC 标准分块盒子 ================= */
  function buildChar(item, c) {
    var bb = bboxOf(item);
    var pad = Math.max(1, Math.round(bb.w * 0.17));
    var body0 = bb.y0 + Math.round(bb.h * 0.44);
    var body1 = bb.y0 + Math.round(bb.h * 0.74);
    var mid0 = bb.x0 + pad, mid1 = bb.x1 - pad;
    var armW = Math.max(2, Math.round(bb.w * 0.19));

    /* ---- 头：脸（含头发上沿），其余面用发色 ---- */
    var faceCv = cropScaled(item, bb.x0 + Math.round(bb.w * 0.1), bb.y0,
      bb.x1 - Math.round(bb.w * 0.1), body0, 16, 16, null);
    var faceTex = texFrom(item.id + '|face', faceCv);
    var hair = dominantOf(item, bb.x0, bb.y0, bb.x1, bb.y0 + 2, 0);
    var hairTex = flatTex(mulHex(hair, 0.96), 'hair');
    var skin = dominantOf(item, mid0, body0 - Math.round(bb.h * 0.16), mid1, body0, 0.15);

    /* ---- 躯干 / 手臂 / 腿 ---- */
    var torsoCv = cropScaled(item, mid0, body0 + 1, mid1, body1, 16, 16, null);
    var torsoTex = texFrom(item.id + '|torso', torsoCv);
    var torsoMir = texFrom(item.id + '|torsoM', mirrorCanvas(torsoCv));
    var torsoBase = dominantOf(item, mid0, body0 + 1, mid1, body1, 0);

    var armCv = cropScaled(item, bb.x0, body0 + 1, bb.x0 + armW, body1, 8, 16, null);
    var armTex = texFrom(item.id + '|arm', armCv);
    var armMir = texFrom(item.id + '|armM', mirrorCanvas(armCv));
    var armBase = dominantOf(item, bb.x0, body0 + 1, bb.x0 + armW, body1, 0);

    var thighX = mid0 + Math.round((mid1 - mid0) / 2);
    var legCv = cropScaled(item, mid0, body1 + 1, thighX, bb.y1, 8, 16, null);
    var legTex = texFrom(item.id + '|leg', legCv);
    var legMir = texFrom(item.id + '|legM', mirrorCanvas(legCv));
    var legBase = dominantOf(item, mid0, body1 + 1, thighX, bb.y1, 0);

    var g = new THREE.Group();
    var k = 2.0 / 32;                    /* 1 像素 → 世界单位 */
    g.scale.setScalar(k);
    g.position.y = -15 * k;              /* 0..30px 的中心抬到原点 */
    g.rotation.y = 0.42;                 /* 固定 3/4 侧面，露出厚度 */

    /* 面亮度：前 1.0 / 左 .88 / 右 .82 / 后 .72 / 顶 1.05 / 底 .7 */
    function faceMats(front, back, side, top, bottom) {
      return [
        mkMat(c, { map: side, lum: 0.82 }),
        mkMat(c, { map: side, lum: 0.88 }),
        mkMat(c, { map: top, lum: 1.05 }),
        mkMat(c, { map: bottom, lum: 0.7 }),
        mkMat(c, { map: front, lum: 1.0 }),
        mkMat(c, { map: back, lum: 0.72 })
      ];
    }

    var headMats = faceMats(faceTex, hairTex, hairTex, hairTex, flatTex(mulHex(skin, 0.8), 'skin'));
    var bodyMats = faceMats(torsoTex, torsoMir, flatTex(torsoBase, 'torso'), flatTex(liftHex(torsoBase, 0.1), 'torso'), flatTex(mulHex(torsoBase, 0.7), 'torso'));
    var armMats = faceMats(armTex, armMir, flatTex(armBase, 'arm'), flatTex(liftHex(armBase, 0.1), 'arm'), flatTex(mulHex(armBase, 0.7), 'arm'));
    var legMats = faceMats(legTex, legMir, flatTex(legBase, 'leg'), flatTex(liftHex(legBase, 0.1), 'leg'), flatTex(mulHex(legBase, 0.7), 'leg'));

    addBox(c, g, 8, 8, 8, headMats, 0, 26, 0);          /* 头 8×8×8 */
    addBox(c, g, 8, 12, 4, bodyMats, 0, 16, 0);         /* 身 8×12×4 */
    addBox(c, g, 4, 12, 4, armMats, -6, 16, 0);         /* 左臂 */
    addBox(c, g, 4, 12, 4, armMats, 6, 16, 0);          /* 右臂 */
    addBox(c, g, 4, 12, 4, legMats, -2.1, 6, 0);        /* 左腿 */
    addBox(c, g, 4, 12, 4, legMats, 2.1, 6, 0);         /* 右腿 */

    /* 材质复用：同一份材质数组给两个手臂/两条腿，减少 shader 切换 */
    return g;
  }

  /* ================= 类型 / 相机 ================= */
  var KIND = {
    steve: 'char', alex: 'char', steve_diamond: 'char',
    alex_netherite: 'char', herobrine: 'char',
    pickaxe_wood: 'tool', pickaxe_diamond: 'tool', sword_diamond: 'tool',
    torch: 'torch',
    grass_block: 'block', crafting_table: 'block',
    chest: 'block', jack_o_lantern: 'block'
  };

  var CAM = {
    block: { pos: [1.92, 1.46, 2.78], look: [0, -0.02, 0], fov: 30 },
    torch: { pos: [1.02, 0.62, 1.98], look: [0, 0.04, 0], fov: 30 },
    tool: { pos: [0.74, 0.44, 2.52], look: [0, 0, 0], fov: 30 },
    char: { pos: [0.66, 0.58, 4.30], look: [0, 0, 0], fov: 30 }
  };

  function kindOf(id) { return KIND[id] || 'block'; }

  /**
   * 建模入口。返回 { group, meshes, kind, dispose }
   * 调用方负责 Scene / 灯光 / 相机 / 渲染。
   */
  function build(item) {
    if (!item || !window.THREE) return null;
    if (!bboxOf(item)) return null;
    var kind = kindOf(item.id);
    var c = new Ctx();
    c.geos = [];
    var group;
    try {
      if (kind === 'block') group = buildBlock(item, c);
      else if (kind === 'torch') group = buildTorch(item, c);
      else if (kind === 'tool') group = buildTool(item, c);
      else group = buildChar(item, c);
    } catch (e) {
      console.warn('[patch 216] build', item.id, e && e.message);
      return null;
    }
    return {
      kind: kind,
      group: group,
      meshes: c.meshes || 1,
      dispose: function () {
        for (var i = 0; i < c.mats.length; i++) {
          try { c.mats[i].dispose(); } catch (e) { /* 忽略 */ }
        }
        for (var j = 0; j < c.geos.length; j++) {
          try { c.geos[j].dispose(); } catch (e) { /* 忽略 */ }
        }
        c.mats = [];
        c.geos = [];
      }
    };
  }

  window.XCL_SKIN_MODEL = {
    kindOf: kindOf,
    cameraOf: function (kind) { return CAM[kind] || CAM.block; },
    build: build,
    clearCache: clearCache,
    stats: function () {
      var n = 0;
      for (var k in texCache) n++;
      return { textures: n };
    }
  };
})();
