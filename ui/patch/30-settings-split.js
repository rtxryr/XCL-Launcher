/* ------------------------------------------------------------------
 * patch/30-settings-split.js — 通用设置：「最大内存」拆成独立卡 + 新增「运行参数限制」卡
 * 作用域：只把 #tab-general 里 #memSeg 那一行搬到新卡 #memCard，并在其后插入 #runLimitCard；
 *         不碰 #setJavaPath / #setJvmArgs / #perfCard，不改 mc.mem 键名（点击时照旧写）
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;

  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var LS_MEM = 'mc.mem';        /* 既有键：GB 字符串，setMem / startLaunch 都在读，必须继续写 */
  var LS_LIMITS = 'mc.limits';  /* 本轮新增：{ memoryMB, priority, affinityMask, gc, memoryMode } */
  var TIERS = [2, 4, 6, 8, 12, 16, 24, 32];

  var ramTotalMB = 0;                 /* 0 = 未知，未知时不做隐藏 */
  var cpuThreads = 0;

  /* ---------------- localStorage：mc.limits 读写都要 try/catch ---------------- */
  function readLimits() {
    try {
      var raw = get(LS_LIMITS);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : null;
    } catch (e) { return null; }
  }
  function writeLimits(patch) {
    var cur = readLimits() || {};
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k];
    }
    try { set(LS_LIMITS, JSON.stringify(cur)); } catch (e) {}
    return cur;
  }

  /* ---------------- 样式（只加结构类，圆角/配色全部走现有变量） ---------------- */
  function injectCss() {
    if (doc.getElementById('patch-30-style')) return;
    var st = doc.createElement('style');
    st.id = 'patch-30-style';
    st.textContent = [
      /* 卡底灰注 + 分隔线（用户要的「分隔线下一行小字」） */
      '.p30-foot{margin:0 16px 10px;padding-top:10px;border-top:1px solid var(--stroke)}',
      '.p30-note{font-size:11px;line-height:1.6;color:var(--txt-3);margin:0}',
      '.p30-note + .p30-note{margin-top:4px}',
      '.p30-note[hidden]{display:none}',
      /* 右侧控件组：和 .form-row 的标签列对齐，窄屏落到下一行 */
      '.p30-card .form-row > .p30-ctl{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:0}',
      /* 内存档位多，允许在胶囊内换行 */
      '.p30-seg{flex-wrap:wrap;justify-content:flex-end;max-width:100%}',
      '.p30-seg button{padding:6px 11px;font-size:11.5px}',
      '.p30-seg button[hidden]{display:none}',
      /* 自定义核数：滑块 + 数字框 + 掩码提示 */
      '.p30-cpu{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}',
      '.p30-cpu[hidden]{display:none}',
      '.p30-range{-webkit-appearance:none;appearance:none;width:150px;height:16px;background:transparent;outline:none;cursor:pointer;flex-shrink:0}',
      '.p30-range::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(90deg,var(--accent) 0%,var(--accent) var(--p30pct,50%),var(--stroke-2) var(--p30pct,50%),var(--stroke-2) 100%)}',
      '.p30-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-5px;border-radius:50%;background:var(--panel-3);border:2px solid var(--accent);box-shadow:0 1px 4px var(--shadow-1);cursor:pointer}',
      '.p30-range::-moz-range-track{height:6px;border-radius:999px;background:var(--stroke-2)}',
      '.p30-range::-moz-range-progress{height:6px;border-radius:999px;background:var(--accent)}',
      '.p30-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--panel-3);border:2px solid var(--accent)}',
      '.p30-num{width:56px;height:30px;border-radius:999px;border:1px solid var(--stroke-2);background:var(--panel-2);color:var(--txt);text-align:center;font-size:13px;font-variant-numeric:tabular-nums;outline:none;transition:border-color .16s var(--ease),box-shadow .16s var(--ease)}',
      '.p30-num::-webkit-outer-spin-button,.p30-num::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}',
      '.p30-num:focus{border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-soft)}',
      '.p30-mask{font-size:11px;color:var(--txt-3);font-variant-numeric:tabular-nums;white-space:nowrap}',
      /* 浅色主题：灰注再压一点亮度，保证可读 */
      'html[data-theme="white"] .p30-note,html[data-theme="sky"] .p30-note,html[data-theme="lavender"] .p30-note{color:var(--txt-3)}',
      '@media (max-width:960px){',
      '.p30-card .form-row > .p30-ctl{margin-left:0;align-items:flex-start}',
      '.p30-seg,.p30-cpu{justify-content:flex-start}',
      '}'
    ].join('');
    doc.head.appendChild(st);
  }

  /* ---------------- 轻提示：页面里的 toast() 在别的闭包里，自建 ---------------- */
  function toast(msg) {
    var wrap = doc.getElementById('toastWrap');
    if (!wrap) return;
    var el = doc.createElement('div');
    el.className = 'toast p30-toast';
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.9v5.4M12 7.7v.1"/></svg><span></span>';
    el.querySelector('span').textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, 2400);
  }

  /* ---------------- 内存文案 / 档位隐藏 ---------------- */
  function updateMemDesc() {
    var el = doc.getElementById('p30MemDesc');
    if (!el) return;
    if (ramTotalMB > 0) {
      var n = Math.max(1, Math.round(ramTotalMB / 1024));
      var x = Math.max(2, Math.min(32, Math.floor(n * 0.75)));
      el.textContent = '这台电脑共 ' + n + ' GB，建议不超过 ' + x + ' GB；对应 JVM 的 -Xmx';
    } else {
      el.textContent = '按机器内存酌情分配；对应 JVM 的 -Xmx';
    }
  }

  function hideBigTiers() {
    var seg = doc.getElementById('memSeg');
    if (!seg || ramTotalMB <= 0) return;
    var capMB = ramTotalMB * 0.75;
    $$('button[data-mem]', seg).forEach(function (b) {
      var gb = Number(b.getAttribute('data-mem')) || 0;
      /* 当前选中档永远保留，避免出现「选中但看不见」 */
      b.hidden = (gb * 1024 > capMB) && !b.classList.contains('on');
    });
  }

  function highlightTier(gb) {
    var seg = doc.getElementById('memSeg');
    if (!seg || !gb) return false;
    var target = null;
    var best = Infinity;
    $$('button[data-mem]', seg).forEach(function (b) {
      var v = Number(b.getAttribute('data-mem')) || 0;
      var d = Math.abs(v - gb);
      if (d < best) { best = d; target = b; }
    });
    if (!target) return false;
    $$('button[data-mem]', seg).forEach(function (b) { b.classList.toggle('on', b === target); });
    return true;
  }

  /* 「性能检测」补丁点「应用推荐」后会写 memoryMode='auto'，这里只读它并反映出来 */
  function syncMemHighlight() {
    var lim = readLimits();
    var autoEl = doc.getElementById('p30MemAuto');
    if (lim && lim.memoryMode === 'auto' && lim.memoryMB) {
      if (highlightTier(Math.round(Number(lim.memoryMB) / 1024))) {
        if (autoEl) autoEl.hidden = false;
        return;
      }
    }
    if (autoEl) autoEl.hidden = true;
    var gb = Number(get(LS_MEM)) || 0;
    if (gb) highlightTier(gb);
  }

  /* ---------------- 掩码：前 N 个逻辑核 ---------------- */
  function maskOf(n) {
    if (n >= 31) return String(Math.pow(2, n) - 1); /* 1<<31 会变负数，大核数用乘方 */
    return String((1 << n) - 1);
  }
  function coresOfMask(mask) {
    var m = Number(mask);
    if (!m || isNaN(m) || m <= 0) return 0;
    var n = 0;
    while (m > 0) { n += m % 2; m = Math.floor(m / 2); }
    return n;
  }

  /* ---------------- 建卡 ---------------- */
  function buildMemCard(seg, javaCard) {
    var oldRow = seg.parentNode;                 /* 原「最大内存」行，整行搬走后删壳 */
    var card = doc.createElement('div');
    card.className = 'glass list-card p30-card';
    card.id = 'memCard';
    card.style.marginBottom = '16px';
    card.innerHTML =
      '<div class="group-title">内存分配</div>' +
      '<div class="form-row">' +
        '<div class="form-lbl">' +
          '<b>最大内存</b>' +
          '<span id="p30MemDesc">按机器内存酌情分配；对应 JVM 的 -Xmx</span>' +
        '</div>' +
      '</div>' +
      '<div class="p30-foot">' +
        '<p class="p30-note">内存越大越吃系统，8 GB 机器建议 4~6 GB。</p>' +
        '<p class="p30-note" id="p30MemAuto" hidden>当前显示的是「设备性能检测」的推荐值，点任一档位即改回手动。</p>' +
      '</div>';

    /* 补档位：现有 2/4/6/8/12 之后追加 16/24/32 */
    seg.className = 'seg p30-seg';
    TIERS.forEach(function (gb) {
      if ($('button[data-mem="' + gb + '"]', seg)) return;
      var b = doc.createElement('button');
      b.setAttribute('data-mem', String(gb));
      b.setAttribute('data-p30-new', '1');       /* 新档位没有原 setMem 监听，自己补提示 */
      b.textContent = gb + ' GB';
      seg.appendChild(b);
    });

    /* 复用原 #memSeg 节点（不是克隆），整行塞进新卡 */
    var row = $('.form-row', card);
    row.appendChild(seg);
    javaCard.parentNode.insertBefore(card, javaCard.nextSibling); /* 紧邻「Java 与内存」之后 */
    if (oldRow && oldRow.parentNode) oldRow.parentNode.removeChild(oldRow);
    return card;
  }

  function buildRunLimitCard(memCard) {
    var card = doc.createElement('div');
    card.className = 'glass list-card p30-card';
    card.id = 'runLimitCard';
    card.style.marginBottom = '16px';
    card.innerHTML =
      '<div class="group-title">运行参数限制</div>' +
      '<div class="form-row" data-adv="1">' +
        '<div class="form-lbl">' +
          '<b>进程优先级</b>' +
          '<span>低于正常可以边玩边干别的，但会轻微掉帧</span>' +
        '</div>' +
        '<div class="p30-ctl">' +
          '<div class="seg" id="prioSeg">' +
            '<button data-prio="normal">正常</button>' +
            '<button data-prio="below">低于正常</button>' +
            '<button data-prio="above">高于正常</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="form-row" data-adv="1">' +
        '<div class="form-lbl">' +
          '<b>CPU 核心限制</b>' +
          '<span id="p30CpuDesc">不限制，交给系统调度；也可只让游戏用前 N 个核心，其余留给系统</span>' +
        '</div>' +
        '<div class="p30-ctl">' +
          '<div class="seg" id="affSeg">' +
            '<button data-aff="auto">自动</button>' +
            '<button data-aff="custom">自定义</button>' +
          '</div>' +
          '<div class="p30-cpu" id="affBox" hidden>' +
            '<input class="p30-range" id="affRange" type="range" min="1" max="8" step="1" value="4">' +
            '<input class="p30-num" id="affNum" type="number" min="1" max="8" step="1" value="4">' +
            '<span class="p30-mask" id="affMaskTxt">掩码 15</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="form-row" data-adv="1">' +
        '<div class="form-lbl">' +
          '<b>GC 策略</b>' +
          '<span>4 GB 以下用串行更省，大内存用 G1 更平滑</span>' +
        '</div>' +
        '<div class="p30-ctl">' +
          '<div class="seg" id="gcSeg">' +
            '<button data-gc="auto">自动</button>' +
            '<button data-gc="g1">G1GC</button>' +
            '<button data-gc="serial">串行</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="p30-foot">' +
        '<p class="p30-note">这些限制在启动游戏时一次性生效，改完重开游戏即可。</p>' +
      '</div>';
    memCard.parentNode.insertBefore(card, memCard.nextSibling);
    return card;
  }

  /* ---------------- 事件 ---------------- */
  function bindMemSeg() {
    var seg = doc.getElementById('memSeg');
    if (!seg || seg.getAttribute('data-p30') === '1') return;
    seg.setAttribute('data-p30', '1');

    /* capture 阶段旁听，不 stopPropagation：原 setMem 照常跑（它写 mc.mem / 高亮 / toast） */
    seg.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-mem]') : null;
      if (!b) return;
      var gb = Number(b.getAttribute('data-mem')) || 0;
      if (!gb) return;

      /* 新增的 16/24/32 档没有原监听，这里补齐高亮 / mc.mem / 提示（老档位重复写同值，无副作用） */
      set(LS_MEM, String(gb));
      $$('button[data-mem]', seg).forEach(function (x) { x.classList.toggle('on', x === b); });
      var hero = doc.getElementById('heroMem');
      if (hero) hero.textContent = '内存 ' + gb + ' GB';
      if (b.getAttribute('data-p30-new') === '1') toast('最大内存已设为 ' + gb + ' GB');

      writeLimits({ memoryMB: gb * 1024, memoryMode: 'manual' });
      var autoEl = doc.getElementById('p30MemAuto');
      if (autoEl) autoEl.hidden = true;
      hideBigTiers();
    }, true);
  }

  function bindPriority(initial) {
    var seg = doc.getElementById('prioSeg');
    if (!seg) return;
    var btns = $$('button', seg);
    btns.forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-prio') === initial);
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.toggle('on', x === b); });
        writeLimits({ priority: b.getAttribute('data-prio') });
      });
    });
  }

  function bindCpu(initialMask) {
    var seg = doc.getElementById('affSeg');
    var box = doc.getElementById('affBox');
    var range = doc.getElementById('affRange');
    var num = doc.getElementById('affNum');
    var maskTxt = doc.getElementById('affMaskTxt');
    var desc = doc.getElementById('p30CpuDesc');
    if (!seg || !box || !range || !num) return;

    cpuThreads = Math.max(1, Math.min(64, Number(navigator.hardwareConcurrency) || 8));
    range.max = String(cpuThreads);
    num.max = String(cpuThreads);
    var initialCores = Math.min(4, cpuThreads);
    var startCores = initialMask ? coresOfMask(initialMask) : 0;
    if (startCores > 0) initialCores = Math.max(1, Math.min(cpuThreads, startCores));

    function paint(n) {
      range.value = String(n);
      num.value = String(n);
      var pct = cpuThreads > 1 ? ((n - 1) / (cpuThreads - 1)) * 100 : 100;
      range.style.setProperty('--p30pct', pct.toFixed(1) + '%');
      if (maskTxt) maskTxt.textContent = '掩码 ' + maskOf(n);
      if (desc) {
        desc.textContent = '只让游戏用前 ' + n + ' 个核心，其余留给系统（本机 ' + cpuThreads + ' 逻辑核）';
      }
    }
    function applyCores(n) {
      n = Math.max(1, Math.min(cpuThreads, Math.floor(Number(n) || 1)));
      paint(n);
      writeLimits({ affinityMask: maskOf(n) });
      return n;
    }
    function paintAutoDesc() {
      if (desc) desc.textContent = '不限制，交给系统调度；也可只让游戏用前 N 个核心，其余留给系统';
    }

    function setMode(mode) {
      $$('button', seg).forEach(function (x) {
        x.classList.toggle('on', x.getAttribute('data-aff') === mode);
      });
      box.hidden = mode !== 'custom';
      if (mode === 'custom') {
        applyCores(Number(num.value) || initialCores);
      } else {
        paintAutoDesc();
        writeLimits({ affinityMask: null });
      }
    }

    $$('button', seg).forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-aff')); });
    });
    range.addEventListener('input', function () { applyCores(range.value); });
    num.addEventListener('input', function () {
      var v = Number(num.value);
      if (!v) return;
      var n = applyCores(v);
      if (String(n) !== num.value) num.value = String(n);
    });

    /* 初始化：有掩码 → 自定义模式并还原核数；否则自动 */
    if (startCores > 0) {
      num.value = String(initialCores);
      paint(initialCores);
      setMode('custom');
    } else {
      setMode('auto');
    }
  }

  function bindGc(initial) {
    var seg = doc.getElementById('gcSeg');
    if (!seg) return;
    var btns = $$('button', seg);
    btns.forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-gc') === initial);
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.toggle('on', x === b); });
        writeLimits({ gc: b.getAttribute('data-gc') });
      });
    });
  }

  /* ---------------- 设备信息（perf:info 优先，浏览器预览退回 deviceMemory） ---------------- */
  function ipc(channel, payload) {
    if (!window.FMBridge || typeof window.FMBridge.invoke !== 'function') return Promise.resolve(null);
    try {
      return window.FMBridge.invoke(channel, payload || {}).then(function (r) { return r; }, function (e) {
        console.warn('[patch 30] ipc', channel, e);
        return null;
      });
    } catch (e) {
      console.warn('[patch 30] ipc', channel, e);
      return Promise.resolve(null);
    }
  }

  function pullPerf() {
    /* deviceMemory 在 Chromium 里被夹到 8 GB（>=8 都报 8），只当兜底初值 */
    if (!ramTotalMB && navigator.deviceMemory) ramTotalMB = Number(navigator.deviceMemory) * 1024;
    updateMemDesc();
    hideBigTiers();

    ipc('perf:info').then(function (info) {
      if (!info || !info.ok || !info.hw) return;
      var mb = Number(info.hw.ramTotalMB) || 0;
      if (mb > 0) {
        ramTotalMB = mb;
        updateMemDesc();
        hideBigTiers();
      }
      var th = Number(info.hw.cpuThreads) || 0;
      if (th > 0 && th !== cpuThreads) {
        cpuThreads = Math.min(64, th);
        var range = doc.getElementById('affRange');
        var num = doc.getElementById('affNum');
        if (range) range.max = String(cpuThreads);
        if (num) num.max = String(cpuThreads);
      }
    });
  }

  /* ---------------- 入口 ---------------- */
  function init() {
    if (doc.getElementById('memCard')) return;          /* 幂等：已经建过就退出 */
    var seg = doc.getElementById('memSeg');
    var javaCard = seg && seg.closest ? seg.closest('.list-card') : null;
    if (!seg || !javaCard || !javaCard.parentNode) return;

    injectCss();

    var memCard = buildMemCard(seg, javaCard);
    var runCard = buildRunLimitCard(memCard);
    if (!memCard || !runCard) return;

    var lim = readLimits() || {};
    var prio = lim.priority === 'normal' || lim.priority === 'below' || lim.priority === 'above'
      ? lim.priority : 'below';
    var gc = lim.gc === 'g1' || lim.gc === 'serial' ? lim.gc : 'auto';
    var mask = lim.affinityMask ? String(lim.affinityMask) : '';

    bindMemSeg();
    bindPriority(prio);
    bindCpu(mask);
    bindGc(gc);

    /* 首次进来补齐 mc.limits 结构；已存在则只补缺项，不覆盖 performance 补丁的 memoryMode */
    var seed = {
      priority: prio,
      affinityMask: mask || null,
      gc: gc,
      memoryMode: lim.memoryMode === 'auto' ? 'auto' : 'manual'
    };
    if (!lim.memoryMB) seed.memoryMB = (Number(get(LS_MEM)) || 8) * 1024;
    writeLimits(seed);

    syncMemHighlight();
    pullPerf();

    /* 切 tab 回来时重新对一次（性能检测可能在此期间点了「应用推荐」） */
    var setSeg = doc.getElementById('setSeg');
    if (setSeg) {
      setSeg.addEventListener('click', function () {
        setTimeout(function () { try { syncMemHighlight(); hideBigTiers(); } catch (e) {} }, 0);
      });
    }
  }

  function boot() {
    try { init(); } catch (e) { console.warn('[patch 30]', e); }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[patch 30] ready');
})();
