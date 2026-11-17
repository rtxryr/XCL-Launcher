/* ------------------------------------------------------------------
 * patch/225-perf-tab.js — 设置新增「性能设置」分类 + Super X 引擎开关
 *
 * 作用域：
 *   1) 在 #setSeg 里插入第 5 个标签 data-tab="perf"（含自己的点击绑定，
 *      因为 index.html 的绑定只覆盖加载时已存在的 4 个按钮）
 *   2) 新建 #tab-perf 容器，把散落各处的性能类卡片搬进来：
 *        #perfCard（设备性能）      → 由 40-perf-ui.js 创建
 *        #memCard（最大内存）      → 由 30-settings-split.js 创建
 *        #runLimitCard（运行参数）  → 由 30-settings-split.js 创建
 *        性能与资源卡（含 #pfAutoLite / #pfLite）→ index.html 内联脚本创建
 *   3) 新增「最大 CPU」「独显最大显卡」两行控制
 *   4) 新增「Super X 渲染引擎」卡（默认关闭，标注测试阶段）
 *
 * 只搬 DOM、不复制：卡片移动用 appendChild，原补丁对卡片的引用全部继续有效。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  var LS = {
    tab: 'mc.setTab',
    gpu: 'mc.gpuPref',
    cpu: 'mc.limits',
    sx: 'mc.superX'
  };
  var TAB_ID = 'perf';
  var moved = false;

  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function readJSON(k) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function writeJSON(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} }
  function bridge(ch, p) {
    if (!window.FMBridge || typeof window.FMBridge.invoke !== 'function' || window.FMBridge.available === false) return Promise.resolve(null);
    return window.FMBridge.invoke(ch, p || {}).catch(function () { return null; });
  }
  function toast(msg) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
    var t = doc.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:9999;padding:10px 18px;' +
      'border-radius:999px;background:var(--panel-2,#222);color:var(--txt,#fff);border:1px solid var(--stroke,#444);font-size:12.5px';
    doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  /* ---------------- 样式 ---------------- */
  function injectCss() {
    if (doc.getElementById('patch-225-style')) return;
    var css = [
      '#m225CpuSeg button{min-width:56px}',
      '#m225GpuRow.is-off{opacity:.55;pointer-events:none}',
      '.m225-sx{border-radius:var(--r-l)}',
      '.m225-sx .m225-badge{display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:2px 8px;border-radius:999px;',
      '  font-size:10.5px;font-weight:600;color:var(--accent);background:var(--accent-soft,rgba(120,200,160,.16))}',
      '.m225-sx .m225-test{margin:2px 0 0;padding:9px 12px;border-radius:12px;font-size:11.5px;line-height:1.55;',
      '  color:var(--txt-2);background:var(--panel-3,rgba(255,255,255,.04));border:1px solid var(--stroke)}',
      '.m225-sx .m225-test b{color:var(--warn,#e0b15a);font-weight:600}',
      '.m225-sx .m225-meta{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 14px}',
      '.m225-sx .m225-chip{padding:3px 9px;border-radius:999px;font-size:11px;color:var(--txt-3);background:var(--panel-3,rgba(255,255,255,.05));border:1px solid var(--stroke)}',
      '.m225-sx .m225-notes{margin:0;padding:0 16px 14px 30px;font-size:11.5px;line-height:1.7;color:var(--txt-3)}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-225-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  /* ---------------- 设备核心数 ---------------- */
  var device = { cores: 0, vram: 0, gpu: '' };
  function loadDevice() {
    return bridge('app:device', {}).then(function (r) {
      if (r && r.ok && r.data) {
        var d = r.data;
        device.cores = Number(d.cpuThreads || d.threads || d.cores || 0) || 0;
        device.vram = Number(d.vramMB || d.vram || 0) || 0;
        device.gpu = String(d.gpuName || d.gpu || '');
      }
      paintCpuSeg();
      paintGpuRow();
    });
  }

  /* ---------------- 标签页 ---------------- */
  function addTabButton() {
    var seg = $('#setSeg');
    if (!seg || seg.querySelector('button[data-tab="' + TAB_ID + '"]')) return;
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-tab', TAB_ID);
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 20.5a8.5 8.5 0 1 1 8.5-8.5"/><path d="M12 12l4.4-3.4"/><circle cx="12" cy="12" r="1.6"/></svg>' +
      '性能设置';
    /* 插在「外观设置」前：通用 → 性能 → 外观 → 更新 → 关于 */
    var anchor = seg.querySelector('button[data-tab="appearance"]');
    if (anchor) seg.insertBefore(btn, anchor);
    else seg.appendChild(btn);

    btn.addEventListener('click', function () {
      $$('#setSeg button').forEach(function (x) { x.classList.toggle('on', x === btn); });
      $$('#page-settings > div[id^="tab-"]').forEach(function (d) {
        d.hidden = d.id !== ('tab-' + TAB_ID);
      });
      set(LS.tab, TAB_ID);
      if (window.__m190Sync) { try { window.__m190Sync(); } catch (e) {} }
      document.dispatchEvent(new CustomEvent('m225:tab', { detail: { tab: TAB_ID } }));
    });
  }

  function ensureTabPane() {
    var page = $('#page-settings');
    if (!page) return null;
    var pane = doc.getElementById('tab-' + TAB_ID);
    if (pane) return pane;
    pane = doc.createElement('div');
    pane.id = 'tab-' + TAB_ID;
    pane.hidden = true;
    var anchor = doc.getElementById('tab-appearance');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(pane, anchor);
    else page.appendChild(pane);
    return pane;
  }

  /* ---------------- 新增：最大 CPU / 独显最大显卡 ---------------- */
  function coresFromMask(mask) {
    var n = 0;
    try {
      var m = BigInt(mask);
      while (m > BigInt(0)) { if (m & BigInt(1)) n++; m >>= BigInt(1); }
    } catch (e) { return 0; }
    return n;
  }

  function maskFromCores(n, total) {
    var t = total || device.cores || 8;
    var count = Math.max(1, Math.min(n, t));
    var mask = BigInt(0);
    for (var i = 0; i < count; i++) mask |= (BigInt(1) << BigInt(i));
    return mask.toString();
  }

  function paintCpuSeg() {
    var seg = doc.getElementById('m225CpuSeg');
    if (!seg) return;
    var lim = readJSON(LS.cpu) || {};
    var mask = lim.affinityMask ? String(lim.affinityMask) : '';
    var cur = mask ? coresFromMask(mask) : 0;
    $$('button', seg).forEach(function (b) {
      var v = b.getAttribute('data-cores');
      var on = v === 'auto' ? !mask : (cur > 0 && String(cur) === v);
      b.classList.toggle('on', on);
    });
    var hint = doc.getElementById('m225CpuHint');
    if (hint) {
      hint.textContent = mask
        ? '当前限制 ' + (cur || '?') + ' 核' + (device.cores ? '（共 ' + device.cores + ' 线程）' : '')
        : '当前不限核' + (device.cores ? '（共 ' + device.cores + ' 线程）' : '');
    }
  }

  function paintGpuRow() {
    var row = doc.getElementById('m225GpuRow');
    var sw = doc.getElementById('m225GpuSw');
    if (!row || !sw) return;
    var hasDgpu = device.vram > 0 || /nvidia|geforce|radeon|rx |rtx|gtx|arc/i.test(device.gpu);
    row.classList.toggle('is-off', !hasDgpu);
    var on = get(LS.gpu, 'auto') === 'discrete';
    sw.classList.toggle('on', hasDgpu && on);
    var txt = doc.getElementById('m225GpuHint');
    if (txt) {
      txt.textContent = hasDgpu
        ? (device.gpu ? '已识别 ' + device.gpu + (device.vram ? '（' + Math.round(device.vram / 1024) + ' GB 显存）' : '') : '已识别独立显卡')
        : '未检测到独立显卡，此项对核显机型无意义';
    }
  }

  function buildExtraCard(pane) {
    if (!pane || doc.getElementById('m225Extra')) return;
    var card = doc.createElement('div');
    card.className = 'glass list-card';
    card.id = 'm225Extra';
    card.style.marginBottom = '16px';
    card.innerHTML =
      '<div class="group-title">CPU 与显卡上限</div>' +
      '<div class="form-row">' +
        '<div class="form-lbl"><b>最大 CPU</b>' +
          '<span>限制游戏进程可用的 CPU 核心数；自动 = 交给系统调度，用满全部核心</span>' +
          '<em class="opt-hint" id="m225CpuHint">当前不限核</em>' +
        '</div>' +
        '<div class="seg" id="m225CpuSeg" role="group" aria-label="最大 CPU 核心数">' +
          '<button type="button" data-cores="auto" class="on">自动</button>' +
          '<button type="button" data-cores="2">2 核</button>' +
          '<button type="button" data-cores="4">4 核</button>' +
          '<button type="button" data-cores="6">6 核</button>' +
          '<button type="button" data-cores="8">8 核</button>' +
        '</div>' +
      '</div>' +
      '<div class="opt-row" id="m225GpuRow">' +
        '<div class="opt-ico">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="2.8" y="6.4" width="18.4" height="11.2" rx="2.4"/><circle cx="9" cy="12" r="2.2"/>' +
          '<path d="M14.4 10.2h4.2M14.4 13.8h4.2"/></svg>' +
        '</div>' +
        '<div class="opt-main"><b>独显情况下最大显卡</b>' +
          '<span id="m225GpuHint">检测独立显卡中…</span></div>' +
        '<div class="switch" id="m225GpuSw" role="switch" aria-label="独显优先"></div>' +
      '</div>' +
      '<div class="conc-tip" style="padding:0 16px 12px">开启后启动游戏时会让系统优先把这一进程交给独立显卡（写入 Windows 的按程序图形首选项，可随时关掉还原）。</div>';
    pane.appendChild(card);

    var seg = doc.getElementById('m225CpuSeg');
    if (seg) {
      seg.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-cores]');
        if (!b) return;
        var v = b.getAttribute('data-cores');
        var lim = readJSON(LS.cpu) || {};
        if (v === 'auto') delete lim.affinityMask;
        else lim.affinityMask = maskFromCores(Number(v), device.cores);
        writeJSON(LS.cpu, lim);
        paintCpuSeg();
        toast(v === 'auto' ? '最大 CPU · 不限核' : '最大 CPU · ' + v + ' 核');
      });
    }

    var gsw = doc.getElementById('m225GpuSw');
    if (gsw) {
      gsw.addEventListener('click', function () {
        if (gsw.parentNode && gsw.parentNode.classList.contains('is-off')) {
          toast('未检测到独立显卡，此项暂不可用');
          return;
        }
        var next = gsw.classList.toggle('on');
        set(LS.gpu, next ? 'discrete' : 'auto');
        toast(next ? '已开启独显优先' : '已恢复自动选择显卡');
      });
    }
  }

  /* ---------------- Super X 卡 ---------------- */
  function buildSxCard(pane) {
    if (!pane || doc.getElementById('m225Sx')) return;
    var card = doc.createElement('div');
    card.className = 'glass list-card m225-sx';
    card.id = 'm225Sx';
    card.style.marginBottom = '16px';
    card.innerHTML =
      '<div class="group-title">渲染引擎</div>' +
      '<div class="opt-row">' +
        '<div class="opt-ico">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M13 2.5 5.5 13.5h5L11 21.5l7.5-11h-5z"/></svg>' +
        '</div>' +
        '<div class="opt-main"><b>Super X 多线程优化<span class="m225-badge">实验</span></b>' +
          '<span>启动器自研的性能优化引擎。为只跑在单核上的较早版本补上多核能力，让帧数更稳、卡顿更少。</span>' +
        '</div>' +
        '<div class="switch" id="m225SxSw" role="switch" aria-label="Super X 多线程优化"></div>' +
      '</div>' +
      '<p class="m225-test"><b>当前处于测试阶段，可随时关闭。</b>关掉后立刻回到默认启动方式，不用重装，也不用重启启动器。</p>' +
      '<div class="m225-meta" id="m225SxMeta"></div>' +
      '<ul class="m225-notes" id="m225SxNotes"></ul>';
    pane.appendChild(card);

    var sw = doc.getElementById('m225SxSw');
    if (sw) {
      sw.classList.toggle('on', get(LS.sx, 'off') === 'on');
      sw.addEventListener('click', function () {
        var next = sw.classList.toggle('on');
        set(LS.sx, next ? 'on' : 'off');
        toast(next ? 'Super X 已开启（测试阶段）' : 'Super X 已关闭，恢复默认启动方式');
        refreshSxMeta();
      });
    }
    refreshSxMeta();
  }

  function refreshSxMeta() {
    var meta = doc.getElementById('m225SxMeta');
    var notes = doc.getElementById('m225SxNotes');
    if (!meta) return;
    var on = get(LS.sx, 'off') === 'on';
    meta.innerHTML = '<span class="m225-chip">' + (on ? '当前已开启' : '当前未启用') + '</span>' +
      '<span class="m225-chip">只在使用旧渲染管线的版本上注入参数</span>';
    if (!notes) return;
    notes.innerHTML = '';
    if (!on) return;
    bridge('superx:info', { versionId: '', memMB: Number(get('mc.mem', '8')) * 1024 }).then(function (r) {
      if (!r || !r.ok || !r.data) return;
      var d = r.data;
      var cores = d.cores || {};
      meta.innerHTML = '<span class="m225-chip">引擎 ' + d.engine + ' v' + d.version + '</span>' +
        '<span class="m225-chip">逻辑核心 ' + (cores.logical || '?') + '</span>' +
        '<span class="m225-chip">' + (d.plan === 'multithread' ? '多线程参数 + 资源调度' : '只做资源调度') + '</span>';
      var items = (d.notes || []).slice(0, 4);
      notes.innerHTML = items.map(function (t) { return '<li>' + t + '</li>'; }).join('');
    });
  }

  /* ---------------- 搬卡片 ---------------- */
  function paneOf(el) { return el ? el.parentNode : null; }

  function moveCard(card, pane) {
    if (!card || !pane || card.parentNode === pane) return false;
    pane.appendChild(card);
    return true;
  }

  function moveAll() {
    var pane = ensureTabPane();
    if (!pane) return;
    var changed = false;
    changed = moveCard(doc.getElementById('perfCard'), pane) || changed;
    changed = moveCard(doc.getElementById('m225Extra'), pane) || changed;
    changed = moveCard(doc.getElementById('m225Sx'), pane) || changed;
    changed = moveCard(doc.getElementById('memCard'), pane) || changed;
    changed = moveCard(doc.getElementById('runLimitCard'), pane) || changed;
    /* 性能与资源卡（自动轻量 / 轻量模式 / 探测间隔）：用 #pfAutoLite 定位 */
    var liteSw = doc.getElementById('pfAutoLite');
    if (liteSw) {
      var liteCard = liteSw.closest('.list-card');
      if (liteCard) changed = moveCard(liteCard, pane) || changed;
    }
    if (changed) moved = true;
  }

  function scheduleMove() {
    if (scheduleMove._t) return;
    scheduleMove._t = setTimeout(function () {
      scheduleMove._t = 0;
      try { moveAll(); } catch (e) {}
    }, 40);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    if (window.__xclPatch225) { scheduleMove(); return; }
    if (!$('#page-settings') || !$('#setSeg')) return;
    window.__xclPatch225 = true;

    injectCss();
    addTabButton();
    var pane = ensureTabPane();
    if (pane) {
      buildExtraCard(pane);
      buildSxCard(pane);
      /* 占位说明：卡片还没被创建完时给用户一个明确提示，避免看到空页 */
      if (!doc.getElementById('m225Placeholder')) {
        var ph = doc.createElement('div');
        ph.id = 'm225Placeholder';
        ph.className = 'glass list-card';
        ph.style.marginBottom = '16px';
        ph.innerHTML = '<div class="group-title">正在加载性能选项…</div>' +
          '<div class="conc-tip" style="padding:0 16px 14px">设备性能、内存与轻量模式卡片就绪后会自动归到本页。</div>';
        pane.appendChild(ph);
      }
    }

    moveAll();
    if (doc.getElementById('m225Placeholder') && (doc.getElementById('perfCard') || doc.getElementById('memCard'))) {
      var p = doc.getElementById('m225Placeholder');
      if (p) p.remove();
    }

    loadDevice();

    /* 卡片由其它补丁/内联脚本异步创建：观察整页子树，出现就搬 */
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function () {
        scheduleMove();
        var ph = doc.getElementById('m225Placeholder');
        if (ph && (doc.getElementById('perfCard') || doc.getElementById('memCard') || doc.getElementById('runLimitCard'))) ph.remove();
      });
      mo.observe(doc.getElementById('page-settings') || doc.body, { childList: true, subtree: true });
    }
    setTimeout(moveAll, 300);
    setTimeout(moveAll, 1200);
    setTimeout(function () {
      var ph = doc.getElementById('m225Placeholder');
      if (ph) ph.remove();
    }, 2500);

    /* 用户上次停在性能页：把激活态补上（index.html 的恢复逻辑只认识原有 4 个按钮） */
    if (get(LS.tab, '') === TAB_ID) {
      var btn = $('#setSeg button[data-tab="' + TAB_ID + '"]');
      if (btn) btn.click();
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('load', boot);
  setTimeout(boot, 600);
})();
