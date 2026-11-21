/* ------------------------------------------------------------------
 * patch/266-perf-live.js — 性能设置「实时性能」趋势卡
 *
 * 只做一件事：在 #tab-perf 顶部放一张卡，用两条平滑曲线显示整机 CPU / 内存
 * 的走势（60 秒窗口），口径与系统任务管理器一致：
 *   CPU  = 1 - Δidle / Δtotal（主进程 os.cpus() 差值）
 *   内存 = 1 - 可用 / 总量（process.getSystemMemoryInfo()）
 *
 * 三条约定：
 *   1. 只在面板可见时采样（切走 / 窗口最小化 / 页面隐藏立即停），不后台空转；
 *   2. 曲线做指数平滑（EMA），只用于看趋势，不冒充瞬时真值，卡底写明口径；
 *   3. 采样数据只存在内存里，不落盘、不上报。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__xclPatch266) return;
  window.__xclPatch266 = true;

  var doc = document;
  var CARD_ID = 'm266Card';
  var N = 60;              /* 60 个点 × 1s = 60 秒窗口 */
  var TICK = 1000;
  var A_CPU = 0.26;        /* CPU 抖动大，平滑更重 */
  var A_MEM = 0.34;
  var VB_W = 320;
  var VB_H = 56;

  function $(s, r) { return (r || doc).querySelector(s); }
  function bridge(ch, p) {
    if (!window.FMBridge || typeof window.FMBridge.invoke !== 'function' || window.FMBridge.available === false) {
      return Promise.resolve(null);
    }
    return Promise.resolve(window.FMBridge.invoke(ch, p || {})).catch(function () { return null; });
  }
  function mbText(n) {
    n = Number(n) || 0;
    return n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : Math.round(n) + ' MB';
  }

  /* 一条曲线：raw 存原值，sm 存平滑后的显示值 */
  function series(alpha) {
    return { raw: [], sm: [], ema: null, alpha: alpha };
  }

  var cpu = series(A_CPU);
  var mem = series(A_MEM);
  var last = { totalMB: 0, freeMB: 0 };

  function push(s, v) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    v = Math.max(0, Math.min(100, v));
    s.raw.push(v);
    if (s.raw.length > N) s.raw.shift();
    s.ema = s.ema == null ? v : s.ema + (v - s.ema) * s.alpha;
    s.sm.push(s.ema);
    if (s.sm.length > N) s.sm.shift();
  }

  function avg(a) {
    if (!a.length) return null;
    var t = 0;
    for (var i = 0; i < a.length; i++) t += a[i];
    return t / a.length;
  }

  /* 0~100 → viewBox 坐标；右对齐，新点永远贴右边。
     宽度按实际像素取，不做拉伸，圆点才是正圆。 */
  function geometry(arr, W) {
    if (!arr.length) return null;
    var step = W / (N - 1);
    var pts = arr.map(function (v, i) {
      var x = W - (arr.length - 1 - i) * step;
      var y = VB_H - (v / 100) * (VB_H - 8) - 4;
      return [x, y];
    });
    var line = pts.map(function (p, i) {
      return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ');
    var area = line +
      ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + VB_H +
      ' L' + pts[0][0].toFixed(1) + ' ' + VB_H + ' Z';
    return { line: line, area: area, last: pts[pts.length - 1] };
  }

  function injectCss() {
    if (doc.getElementById('patch-266-style')) return;
    var css = [
      '#m266Card .m266-live{display:inline-flex;align-items:center;gap:5px;margin-left:8px;',
      '  padding:1px 8px;border-radius:999px;font-size:9.5px;font-weight:600;letter-spacing:.02em;',
      '  color:var(--accent);background:var(--accent-soft,rgba(120,200,160,.16));vertical-align:1px}',
      '#m266Card .m266-live i{width:5px;height:5px;border-radius:999px;background:currentColor;',
      '  animation:m266Blink 1.8s ease-in-out infinite}',
      '#m266Card .m266-live.idle{color:var(--txt-3);background:var(--panel-3,rgba(255,255,255,.05))}',
      '#m266Card .m266-live.idle i{animation:none;opacity:.5}',
      '@keyframes m266Blink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}}',

      '#m266Card .m266-body{padding:12px 16px 4px}',
      '#m266Card .m266-row + .m266-row{margin-top:12px}',
      '#m266Card .m266-top{display:flex;align-items:baseline;gap:9px}',
      '#m266Card .m266-top span{font-size:11.5px;color:var(--txt-3);letter-spacing:.02em}',
      '#m266Card .m266-top b{font-size:15.5px;font-weight:650;color:var(--txt);',
      '  font-variant-numeric:tabular-nums;letter-spacing:-.01em;line-height:1}',
      '#m266Card .m266-top em{margin-left:auto;font-style:normal;font-size:11px;color:var(--txt-3);',
      '  font-variant-numeric:tabular-nums}',

      '#m266Card .m266-spark{display:block;width:100%;height:56px;margin-top:5px;overflow:visible}',
      '#m266Card #m266Fill stop:first-child{stop-color:var(--accent);stop-opacity:.30}',
      '#m266Card #m266Fill stop:last-child{stop-color:var(--accent);stop-opacity:0}',
      '#m266Card .m266-grid{stroke:var(--stroke);stroke-width:1;stroke-dasharray:3 5;opacity:.7}',
      '#m266Card .m266-line{fill:none;stroke:var(--accent);stroke-width:1.7;stroke-linejoin:round;',
      '  stroke-linecap:round;vector-effect:non-scaling-stroke}',
      '#m266Card .m266-area{stroke:none;opacity:.95}',
      '#m266Card .m266-dot{fill:var(--accent);transition:cx .3s linear,cy .3s linear}',
      '#m266Card .m266-note{margin:6px 0 0;padding:0 16px 14px;font-size:10.5px;line-height:1.65;',
      '  color:var(--txt-3)}',
      'html[data-motion="off"] #m266Card .m266-live i{animation:none}',
      'html[data-motion="off"] #m266Card .m266-dot{transition:none}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-266-style';
    st.textContent = css;
    (doc.head || doc.documentElement).appendChild(st);
  }

  function sparkSvg(id) {
    return '<svg class="m266-spark" id="' + id + 'Svg" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" aria-hidden="true">' +
      '<line class="m266-grid" x1="0" y1="' + (VB_H / 2) + '" x2="' + VB_W + '" y2="' + (VB_H / 2) + '"/>' +
      '<path class="m266-area" id="' + id + 'Area" fill="url(#m266Fill)" d=""/>' +
      '<path class="m266-line" id="' + id + 'Line" d=""/>' +
      '<circle class="m266-dot" id="' + id + 'Dot" r="2.4" cx="-20" cy="-20"/>' +
      '</svg>';
  }

  function buildCard() {
    var pane = doc.getElementById('tab-perf');
    if (!pane || doc.getElementById(CARD_ID)) return false;
    injectCss();

    var card = doc.createElement('div');
    card.className = 'glass list-card';
    card.id = CARD_ID;
    card.style.marginBottom = '16px';
    card.innerHTML =
      '<svg width="0" height="0" aria-hidden="true" style="position:absolute">' +
        '<defs><linearGradient id="m266Fill" x1="0" y1="0" x2="0" y2="' + VB_H + '" gradientUnits="userSpaceOnUse">' +
          '<stop offset="0"/>' +
          '<stop offset="1"/>' +
        '</linearGradient></defs>' +
      '</svg>' +
      '<div class="group-title">实时性能' +
        '<span class="m266-live" id="m266Live"><i></i>每 1 秒采样</span>' +
      '</div>' +
      '<div class="m266-body">' +
        '<div class="m266-row">' +
          '<div class="m266-top"><span>CPU</span><b id="m266Cpu">—</b>' +
            '<em id="m266CpuSub">等待采样</em></div>' +
          sparkSvg('m266Cpu') +
        '</div>' +
        '<div class="m266-row">' +
          '<div class="m266-top"><span>内存</span><b id="m266Mem">—</b>' +
            '<em id="m266MemSub"></em></div>' +
          sparkSvg('m266Mem') +
        '</div>' +
      '</div>' +
      '<p class="m266-note">仅在本面板可见时采样；曲线经过平滑处理，用来观察整体趋势，与瞬时真值存在偏差，仅供参考。</p>';

    pane.insertBefore(card, pane.firstChild);
    return true;
  }

  function isVisible() {
    if (doc.hidden) return false;
    var pane = doc.getElementById('tab-perf');
    if (!pane || pane.offsetParent === null) return false;
    var r = pane.getBoundingClientRect();
    return r.height > 40 && r.bottom > 0 && r.top < (window.innerHeight || 800);
  }

  function paint(id, s) {
    var svg = doc.getElementById(id + 'Svg');
    var line = doc.getElementById(id + 'Line');
    var area = doc.getElementById(id + 'Area');
    var dot = doc.getElementById(id + 'Dot');
    if (!svg || !line || !area || !dot) return;
    var W = Math.max(80, Math.round(svg.clientWidth || VB_W));
    if (W !== svg.__w) {
      svg.__w = W;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + VB_H);
      var grid = svg.querySelector('.m266-grid');
      if (grid) { grid.setAttribute('x2', W); }
    }
    var g = geometry(s.sm, W);
    if (!g) return;
    line.setAttribute('d', g.line);
    area.setAttribute('d', g.area);
    dot.setAttribute('cx', g.last[0].toFixed(1));
    dot.setAttribute('cy', g.last[1].toFixed(1));
  }

  function paintEmpty(id) {
    var dot = doc.getElementById(id + 'Dot');
    if (dot) { dot.setAttribute('cx', '-20'); dot.setAttribute('cy', '-20'); }
  }

  function render() {
    var cpuNow = cpu.raw.length ? cpu.raw[cpu.raw.length - 1] : null;
    var memNow = mem.raw.length ? mem.raw[mem.raw.length - 1] : null;

    var cpuEl = doc.getElementById('m266Cpu');
    var cpuSub = doc.getElementById('m266CpuSub');
    if (cpuEl) cpuEl.textContent = cpuNow == null ? '—' : Math.round(cpuNow) + '%';
    if (cpuSub) {
      var ca = avg(cpu.raw);
      cpuSub.textContent = ca == null ? '等待采样' : '均值 ' + Math.round(ca) + '%';
    }

    var memEl = doc.getElementById('m266Mem');
    var memSub = doc.getElementById('m266MemSub');
    if (memEl) memEl.textContent = memNow == null ? '—' : Math.round(memNow) + '%';
    if (memSub) {
      memSub.textContent = last.totalMB
        ? mbText(last.freeMB) + ' 可用 / ' + mbText(last.totalMB)
        : '';
    }

    paint('m266Cpu', cpu);
    paint('m266Mem', mem);
  }

  function tick() {
    if (!isVisible() || !doc.getElementById(CARD_ID)) return;
    bridge('sys:perf', {}).then(function (r) {
      var d = r && r.ok && r.data;
      if (!d) {
        /* 桥不可用：退回内存监控那一路，至少内存曲线能走 */
        return bridge('mem:status', {}).then(function (m) {
          var s = m && m.ok && m.data;
          if (!s || !s.totalMB) return;
          last.totalMB = s.totalMB;
          last.freeMB = s.freeMB;
          push(mem, (1 - s.freeMB / s.totalMB) * 100);
          render();
        });
      }
      if (typeof d.cpu === 'number' && isFinite(d.cpu)) push(cpu, d.cpu);
      if (d.memTotalMB > 0) {
        last.totalMB = d.memTotalMB;
        last.freeMB = d.memFreeMB;
        push(mem, (1 - d.memFreeMB / d.memTotalMB) * 100);
      }
      render();
    });
  }

  var timer = null;

  function ensureTimer() {
    if (timer) return;
    timer = setInterval(tick, TICK);
    tick();
  }

  function mount() {
    if (!buildCard()) { toTop(); return; }
    paintEmpty('m266Cpu');
    paintEmpty('m266Mem');
    ensureTimer();
    toTop();
  }

  /* 别的补丁也在往这个 pane 顶部插卡（内存优化比这里晚 300ms 挂载），
     所以每隔一会儿把自己顶回第一位，保证「实时性能」始终是性能页第一张卡。 */
  function toTop() {
    var pane = doc.getElementById('tab-perf');
    var card = doc.getElementById(CARD_ID);
    if (!pane || !card) return;
    if (pane.firstElementChild !== card) pane.insertBefore(card, pane.firstElementChild);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { setTimeout(mount, 900); });
  } else {
    setTimeout(mount, 900);
  }
  setTimeout(mount, 2600);
  setTimeout(mount, 5200);
  setTimeout(toTop, 1500);
  setTimeout(toTop, 3400);
  setTimeout(toTop, 6400);

  /* 页面隐藏时计时器照旧存在，但 tick 会自己跳过；这里只处理「切回来立刻画一帧」 */
  doc.addEventListener('visibilitychange', function () {
    if (!doc.hidden) tick();
  });

  /* 窗口宽度变化会让 viewBox 失效，重画一次即可（不重新采样） */
  window.addEventListener('resize', function () {
    if (!doc.getElementById(CARD_ID)) return;
    paint('m266Cpu', cpu);
    paint('m266Mem', mem);
  }, { passive: true });
})();
