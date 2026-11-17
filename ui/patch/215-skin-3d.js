/* ------------------------------------------------------------------
 * patch/215-skin-3d.js — 装扮「立体模式」壳管理（渲染核心在 216）
 * ------------------------------------------------------------------
 * 职责分离：
 *   · 216-skin-model.js 负责「怎么建模」（方块/火把/工具/人物四种模型）
 *   · 本文件只负责「壳」：壳元素、尺寸自适应、共享 WebGL 上下文、
 *     离屏渲染 → drawImage 到各卡 2D canvas、hover 自转、视口裁剪、
 *     拆壳回收、CSS 3D 降级、平面模式的厚度错觉
 *
 * 共享 WebGL：全页只建 **一个** WebGLRenderer（离屏），每个装扮卡用普通
 * 2D canvas 接收 drawImage 结果 —— 避免每卡一个 context 触发浏览器
 * "Too many active WebGL contexts" 导致旧上下文被丢、画面全白。
 *
 * 降级链：THREE/WebGL 就绪 → three 真 3D；不可用 → CSS 3D 立方体。
 * 减动效：data-motion="off" / prefers-reduced-motion → 无 hover 自转，静态姿态保留。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.__xclPatch215) return;
  window.__xclPatch215 = true;

  var doc = document;
  var root = doc.documentElement;
  var STYLE_ID = 'patch-215-style';

  var RATIO = { three: 1.02, css: 0.86 };  /* 壳宽相对原 SVG 显示宽的比例 */
  var MIN_FACE = 20;                       /* px，太小不做 3D */

  /* ---------------- 能力检测 ----------------
   * 无头/冷启动时 GPU 进程可能还没就绪，getContext 首探会失败：
   * 探测惰性化——每次 wrap 时重试，成功后缓存，不再回退。 */
  function webglOk() {
    if (!window.THREE) return false;
    try {
      var c = doc.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }
  var THREE_OK = false;
  function modeOf() {
    if (!window.THREE) return 'css';
    if (!THREE_OK) THREE_OK = webglOk();
    return THREE_OK ? 'three' : 'css';
  }
  function modelLib() { return window.XCL_SKIN_MODEL || null; }

  function injectCss() {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      /* ---- 兜底：creeper_hoodie 数据已移除，隐藏任何残留卡片 ---- */
      '.skin-item[data-id="creeper_hoodie"]{display:none!important}',

      /* ---- 3D 壳骨架（three / css 两种模式共用壳元素） ---- */
      'html[data-skin="iso"] .skin-pix{position:relative}',
      'html[data-skin="iso"] #heroDeco[data-m215-hero]{transform:none!important}',
      '.m215-host{',
      '  display:block; position:relative; max-width:100%;',
      '  width:var(--m215-s); height:var(--m215-s);',
      '  line-height:0;',
      '}',

      /* ---- three 模式：2D canvas 接管展示，svg 保留但隐藏 ---- */
      '.m215-host[data-m215-mode="three"] canvas{',
      '  display:block; width:100%; height:100%;',
      '}',

      /* ---- css 降级模式：纯 transform 立方体 ---- */
      '.m215-cube{',
      '  display:block; position:relative; width:100%; height:100%;',
      '  transform-style:preserve-3d;',
      '  transform:perspective(620px) rotateX(-24deg) rotateY(-32deg);',
      '  transition:transform calc(.3s * var(--anim-k,1)) var(--ease,ease);',
      '}',
      '.m215-face{',
      '  position:absolute; inset:0; overflow:hidden;',
      '  backface-visibility:hidden; border-radius:7%;',
      '}',
      '.m215-face svg{',
      '  display:block; width:100%; height:100%;',
      '  transform:none!important; filter:none!important; will-change:auto;',
      '}',
      '.m215-top{transform:rotateX(90deg) translateZ(calc(var(--m215-s)/2));filter:brightness(1.18) saturate(1.04)}',
      '.m215-front{transform:translateZ(calc(var(--m215-s)/2));filter:brightness(1)}',
      '.m215-right{transform:rotateY(90deg) translateZ(calc(var(--m215-s)/2));filter:brightness(.78)}',
      'html[data-skin="iso"] .skin-item:hover .m215-cube{',
      '  transform:perspective(620px) rotateX(-30deg) rotateY(-44deg) translateY(-2px);',
      '}',
      'html[data-motion="off"] .m215-cube{transition:none}',
      'html[data-motion="off"] .skin-item:hover .m215-cube{',
      '  transform:perspective(620px) rotateX(-24deg) rotateY(-32deg);',
      '}',

      /* ---- 平面模式：给平面像素画补厚度错觉（不重画任何像素） ----
       * 同色暗影向下偏移 1.5px 当"侧壁"，再加一条柔和落地投影 */
      'html:not([data-skin="iso"]) .skin-pix{position:relative}',
      'html:not([data-skin="iso"]) .skin-pix svg[data-hd="1"]{',
      '  filter:drop-shadow(0 1.5px 0 rgba(0,0,0,.46)) drop-shadow(0 5px 7px rgba(0,0,0,.20));',
      '}',
      'html:not([data-skin="iso"]) .skin-pix::after{',
      '  content:""; position:absolute; left:26%; right:26%; bottom:6%; height:8%;',
      '  border-radius:50%; pointer-events:none;',
      '  background:radial-gradient(closest-side,rgba(0,0,0,.20),rgba(0,0,0,0));',
      '}',
      'html:not([data-skin="iso"]) #heroDeco svg[data-hd="1"]{',
      '  filter:drop-shadow(0 3px 0 rgba(0,0,0,.44)) drop-shadow(0 14px 18px rgba(0,0,0,.22));',
      '}',

      '@media (prefers-reduced-motion:reduce){',
      '  .m215-cube{transition:none}',
      '}'
    ].join('\n');
    (doc.head || root).appendChild(st);
  }

  /* ---------------- 数据工具 ---------------- */
  function hdOf(id) {
    var arr = window.XCL_SKIN_HD_ITEMS || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function currentId() {
    try { return window.XCL_SKIN && window.XCL_SKIN.current(); } catch (e) { return null; }
  }

  /**
   * 原(svg)显示宽推导：min(CSS max-width, 容器内容宽)。
   * svg 被收进壳后不能直接量，统一用此公式（幂等，不会越算越小）。
   */
  function sourceWidth(svg, container) {
    var mw = parseFloat(getComputedStyle(svg).maxWidth) || 0;
    if (container.clientWidth > 0) {
      var cs = getComputedStyle(container);
      var avail = container.clientWidth -
        (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      if (mw > 0) return Math.min(mw, avail > 0 ? avail : mw);
      return avail > 0 ? avail : mw;
    }
    return mw;
  }

  /* ---------------- 共享 WebGL 渲染器（全页仅 1 个上下文） ---------------- */
  var shared = null;   /* { renderer } */

  function getShared() {
    if (shared) return shared;
    if (!window.THREE) return null;
    try {
      var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      shared = { renderer: renderer };
      /* 上下文丢失：丢弃共享句柄，下次按需重建 */
      renderer.domElement.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        teardownShared();
        schedule();
      }, false);
    } catch (e) {
      console.warn('[patch 215] shared WebGLRenderer:', e && e.message);
      shared = null;
    }
    return shared;
  }

  function teardownShared() {
    if (!shared) return;
    try { shared.renderer.dispose(); } catch (e) { /* 忽略 */ }
    shared = null;
    /* 纹理缓存与上下文绑定，一并回收，下次重建时重新生成 */
    var lib = modelLib();
    if (lib && lib.clearCache) { try { lib.clearCache(); } catch (e) { /* 忽略 */ } }
  }

  /* ---------------- three：渲染一帧并转绘到该卡自己的 2D canvas ---------------- */
  function renderFrame(obj) {
    if (!obj.inView) return;
    var sh = getShared();
    if (!sh) return;
    try {
      var pr = Math.min(window.devicePixelRatio || 1, 2);
      sh.renderer.setPixelRatio(pr);
      sh.renderer.setSize(obj.size, obj.size, false);
      sh.renderer.render(obj.scene, obj.camera);
      var b = Math.round(obj.size * pr);
      if (obj.canvas.width !== b) { obj.canvas.width = b; obj.canvas.height = b; }
      var g = obj.canvas.getContext('2d');
      if (!g) return;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, b, b);
      g.drawImage(sh.renderer.domElement, 0, 0, b, b);
    } catch (e) { /* 上下文丢失等：等待 webglcontextlost 重建 */ }
  }

  /* ---------------- three：建壳 ---------------- */
  function buildThree(host, container, svg, item, s) {
    var sh = getShared();
    var lib = modelLib();
    if (!sh || !lib) return null;
    var model = lib.build(item);
    if (!model) return null;

    var cam = lib.cameraOf(model.kind);

    var scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    var dir = new THREE.DirectionalLight(0xffffff, 0.42);
    dir.position.set(2.2, 3.4, 3.2);      /* 左上主光：顶亮、右中、左下暗 */
    scene.add(dir);
    /* 反侧补光：只靠一盏主光时背面会发死黑 */
    var fill = new THREE.DirectionalLight(0xffffff, 0.20);
    fill.position.set(-2.8, 1.2, -2.0);
    scene.add(fill);

    scene.add(model.group);

    var camera = new THREE.PerspectiveCamera(cam.fov || 30, 1, 0.05, 60);
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);

    var canvas = doc.createElement('canvas');
    host.insertBefore(canvas, host.firstChild);
    host.appendChild(svg);   /* svg 一并收进壳：拆壳时才能恢复显示并放回容器 */
    host.setAttribute('data-m215-kind', model.kind);

    var obj = {
      host: host, container: container, canvas: canvas,
      scene: scene, camera: camera, mesh: model.group, model: model,
      size: s, inView: false, spinning: false, three: true,
      meshes: model.meshes,
      render: function () { renderFrame(obj); }
    };
    host.__m215obj = obj;
    container.__m215obj = obj;   /* IO 回调从容器上取对象 */
    return obj;
  }

  /* ---------------- css 降级：用现有 svg 拼三个面 ---------------- */
  function buildCss(host, container, svg) {
    var cube = doc.createElement('span');
    cube.className = 'm215-cube';
    cube.innerHTML =
      '<span class="m215-face m215-top">' + svg.outerHTML + '</span>' +
      '<span class="m215-face m215-front"></span>' +
      '<span class="m215-face m215-right">' + svg.outerHTML + '</span>';
    cube.querySelector('.m215-front').appendChild(svg);
    host.appendChild(cube);
    return { host: host, container: container, css: true, meshes: 3 };
  }

  /* ---------------- 包装 / 拆壳 ---------------- */
  function wrap(container, svg) {
    if (!container || !svg) return null;
    if (container.querySelector('[data-m215]')) return null;       /* 已包装 */
    if (svg.getAttribute('data-hd') !== '1') return null;          /* 还没 HD 化，等 210 */

    var btn = container.closest ? container.closest('.skin-item') : null;
    var id = btn ? btn.getAttribute('data-id') : (container.id === 'heroDeco' ? currentId() : null);
    var item = id ? hdOf(id) : null;
    if (!item) return null;   /* 无 HD 数据不包装 */

    var w = sourceWidth(svg, container);
    var mode = modeOf();
    var s = Math.round(w * RATIO[mode]);
    if (!(s >= MIN_FACE)) return null;

    var host = doc.createElement('span');
    host.className = 'm215-host';
    host.setAttribute('data-m215', '1');
    host.setAttribute('data-m215-mode', mode);
    host.style.setProperty('--m215-s', s + 'px');

    var obj = null;
    if (mode === 'three') {
      svg.style.display = 'none';            /* 内联隐藏：压过 #heroDeco svg 等高优先级规则 */
      obj = buildThree(host, container, svg, item, s);
      if (!obj) { svg.style.display = ''; mode = 'css'; }
    }
    if (!obj) {
      host.setAttribute('data-m215-mode', 'css');
      obj = buildCss(host, container, svg);
    }
    if (obj && obj.three) {
      bindHover(obj);
      watchInView(obj);
      obj.render();
    }
    container.appendChild(host);
    if (container.id === 'heroDeco') container.setAttribute('data-m215-hero', '1');
    return obj;
  }

  /** 拆壳：恢复 svg 到容器，回收模型材质/几何（纹理按缓存共享） */
  function unwrap(container) {
    if (!container) return;
    var host = container.querySelector('[data-m215]');
    if (!host) return;
    var obj = host.__m215obj;
    if (obj) {
      unbindHover(obj);
      if (obj.model && obj.model.dispose) {
        try { obj.model.dispose(); } catch (e) { /* 忽略 */ }
      }
      host.__m215obj = null;
      container.__m215obj = null;
    }
    var svg = host.querySelector('svg');
    if (svg) {
      svg.style.display = '';
      container.insertBefore(svg, host);
    }
    container.removeChild(host);
    container.removeAttribute('data-m215-hero');
    /* 最后一个壳拆除：整体回收共享渲染器与纹理，防泄漏 */
    if (!doc.querySelector('[data-m215]')) teardownShared();
  }

  /* ---------------- 交互与渲染调度 ---------------- */
  function motionOn() { return root.getAttribute('data-motion') !== 'off'; }

  /* hover 自转：单 rAF 循环，只转在转的、可见的模型 */
  var spinning = [];
  var rafId = 0;
  function tick() {
    rafId = 0;
    for (var i = spinning.length - 1; i >= 0; i--) {
      var obj = spinning[i];
      if (!obj.spinning || !obj.inView || !obj.three || !obj.model) {
        spinning.splice(i, 1);
        continue;
      }
      obj.mesh.rotation.y += 0.016;
      obj.render();
    }
    if (spinning.length) rafId = requestAnimationFrame(tick);
  }
  function bindHover(obj) {
    obj.onEnter = function () {
      if (!motionOn() || !obj.three) return;
      obj.spinning = true;
      if (spinning.indexOf(obj) < 0) spinning.push(obj);
      if (!rafId) rafId = requestAnimationFrame(tick);
    };
    obj.onLeave = function () { obj.spinning = false; };
    obj.container.addEventListener('mouseenter', obj.onEnter);
    obj.container.addEventListener('mouseleave', obj.onLeave);
  }
  function unbindHover(obj) {
    obj.spinning = false;
    if (obj.onEnter) {
      obj.container.removeEventListener('mouseenter', obj.onEnter);
      obj.container.removeEventListener('mouseleave', obj.onLeave);
    }
  }

  /* 视口检测：不在视口就不重绘，回到视口补一帧静态图 */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var obj = entries[i].target.__m215obj;
      if (!obj || !obj.three) continue;
      obj.inView = entries[i].isIntersecting;
      if (obj.inView) obj.render();
    }
  }, { threshold: 0.01 }) : null;
  function watchInView(obj) {
    if (io) io.observe(obj.container);
    else { obj.inView = true; }   /* 无 IO 环境：始终渲染 */
  }

  /* ---------------- 面宽重算（窗口尺寸变化 / 页面显隐后） ---------------- */
  function reface() {
    var hosts = doc.querySelectorAll('[data-m215]');
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      var svg = host.querySelector('svg');
      if (!svg) continue;
      var w = sourceWidth(svg, host.parentNode);
      var mode = host.getAttribute('data-m215-mode') || modeOf();
      var s = Math.round(w * RATIO[mode]);
      if (s < MIN_FACE) continue;
      host.style.setProperty('--m215-s', s + 'px');
      if (host.__m215obj && host.__m215obj.three && s !== host.__m215obj.size) {
        host.__m215obj.size = s;
        host.__m215obj.render();
      }
    }
  }

  /* ---------------- 场景处理 ---------------- */
  function isIso() { return root.getAttribute('data-skin') === 'iso'; }

  function idOfContainer(container) {
    if (!container) return null;
    if (container.id === 'heroDeco') return currentId();
    var b = container.closest ? container.closest('.skin-item') : null;
    return b ? b.getAttribute('data-id') : null;
  }

  function process() {
    var deco = doc.getElementById('heroDeco');
    var cur = currentId();
    /* 兜底：hero 当前是已移除的 creeper_hoodie → 直接藏掉 */
    if (deco && cur === 'creeper_hoodie') deco.hidden = true;

    if (!isIso()) {
      /* 平面模式：全部拆壳还原 + 回收 GPU 资源 */
      var all = doc.querySelectorAll('[data-m215]');
      for (var i = 0; i < all.length; i++) unwrap(all[i].parentNode);
      return;
    }

    /* 立体模式：GPU 就绪晚于首包时，把 css 降级壳升级为 three 壳 */
    if (modeOf() === 'three') {
      var cssHosts = doc.querySelectorAll('[data-m215][data-m215-mode="css"]');
      for (var c = 0; c < cssHosts.length; c++) {
        var chost = cssHosts[c];
        var cont = chost.parentNode;
        if (!cont) continue;
        if (idOfContainer(cont)) unwrap(cont);
      }
    }

    /* 立体模式：包装网格里所有有 HD 数据的装扮卡 */
    var pixs = doc.querySelectorAll('.skin-pix');
    for (var p = 0; p < pixs.length; p++) {
      var pix = pixs[p];
      if (!pix.querySelector('[data-m215]')) {
        var svg = pix.querySelector('svg[data-hd="1"]');
        if (svg) wrap(pix, svg);
      }
    }

    /* 主页大图：当前装扮也出 3D 壳（草方块是默认项时 heroDeco 隐藏） */
    if (deco && !deco.hidden && cur) {
      if (!deco.querySelector('[data-m215]')) {
        var hsv = deco.querySelector('svg[data-hd="1"]');
        if (hsv) wrap(deco, hsv);
      }
    } else if (deco && deco.querySelector('[data-m215]')) {
      unwrap(deco);   /* 换了默认装扮 / heroDeco 隐藏 → 拆 hero 壳 */
    }

    /* 残留清理：没有 HD 数据的壳拆掉 */
    for (var q = 0; q < pixs.length; q++) {
      var pix2 = pixs[q];
      var host2 = pix2.querySelector('[data-m215]');
      if (!host2) continue;
      if (!hdOf(idOfContainer(pix2))) unwrap(pix2);
    }

    /* 隐藏期用兜底尺寸建好的壳，可见后按实际宽度校正并重绘 */
    reface();
  }

  /* ---------------- 调度（rAF 去抖，避免和 210 的 observer 打架） ---------------- */
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      process();
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    injectCss();
    process();

    var mo = new MutationObserver(schedule);
    /* 模式切换（data-skin 变化）→ 包装 / 拆壳 */
    mo.observe(root, { attributes: true, attributeFilter: ['data-skin'] });
    /* 网格 / 放大格 / 主页大图：210 渲染出 data-hd svg 后再包 3D 壳 */
    var zones = doc.querySelectorAll('#skinBody, #skinGridSkin, #skinGridDeco, #skinZoomGrid, #heroDeco');
    for (var i = 0; i < zones.length; i++) {
      mo.observe(zones[i], { childList: true, subtree: true });
    }
    /* 页面切换（.page 的 active class）与放大层开关（hidden）→ 重算/补包 */
    var moAttr = new MutationObserver(schedule);
    var pages = doc.querySelectorAll('.page');
    for (var j = 0; j < pages.length; j++) {
      moAttr.observe(pages[j], { attributes: true, attributeFilter: ['class', 'hidden'] });
    }
    var overlayEl = doc.getElementById('skinOverlay');
    if (overlayEl) moAttr.observe(overlayEl, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', function () {
      clearTimeout(window.__m215rz);
      window.__m215rz = setTimeout(reface, 160);
    });

    /* 兜底短轮询：skin 卡片可能是延迟生成的（与 210 相同节奏） */
    var n = 0;
    var t = setInterval(function () {
      process();
      if (++n > 30) clearInterval(t);
    }, 400);

    /* 对外调试口（验证脚本用） */
    window.XCL_SKIN_3D = {
      mode: modeOf,
      count: function () { return doc.querySelectorAll('[data-m215]').length; },
      three: function () { return !!window.THREE; },
      contexts: function () { return shared ? 1 : 0; },
      items: function () {
        var out = [];
        var hosts = doc.querySelectorAll('[data-m215]');
        for (var i = 0; i < hosts.length; i++) {
          var h = hosts[i];
          var o = h.__m215obj || null;
          out.push({
            id: idOfContainer(h.parentNode) || '?',
            kind: h.getAttribute('data-m215-kind') || (h.getAttribute('data-m215-mode') === 'css' ? 'css' : ''),
            meshes: (o && o.meshes) || 0,
            mode: h.getAttribute('data-m215-mode'),
            w: (o && o.canvas) ? o.canvas.width : 0,
            hero: h.parentNode && h.parentNode.id === 'heroDeco'
          });
        }
        return out;
      }
    };

    console.log('[patch 215] ready · mode:', modeOf(),
      '· model lib:', !!modelLib());
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
