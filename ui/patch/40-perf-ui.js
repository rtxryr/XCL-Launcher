/* ------------------------------------------------------------------
 * patch/40-perf-ui.js — 设置页「设备性能」卡片（硬件画像 + 5 次启动均值 + 推荐运行限制）
 * 作用域：只往 #tab-general 里插一张 #perfCard（在 #speedSeg 那张卡之前），
 *         只写 localStorage 的 mc.limits / mc.mem，其它卡片、其它页面零影响。
 * 数据来源：主进程 perf:info / perf:reset（本文件不做任何硬件探测）。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }

  var CARD_ID = 'perfCard';
  var CSS_ID = 'patch-40-style';
  var MAX_LAUNCH = 5;      /* 与 core/system/perf.js 的 MAX_LAUNCHES 对齐，只用于文案 */
  var DEFAULT_MEM = '8';   /* 页面里 store.get('mc.mem','8') 的默认档位 */

  var state = { data: null, loaded: false, loading: false, busy: false, timer: 0 };

  /* ---------------- 桥 ---------------- */
  async function ipc(channel, payload) {
    if (!window.FMBridge || typeof window.FMBridge.invoke !== 'function') return null;
    /* 网页预览时页面自己会塞一个 available:false 的桩，直接当没有桥处理 */
    if (window.FMBridge.available === false) return null;
    try { return await window.FMBridge.invoke(channel, payload || {}); }
    catch (e) { console.warn('[patch 40] ipc', channel, e); return null; }
  }

  /* ---------------- localStorage ---------------- */
  function Lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function Lset(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式忽略 */ } }
  function Ldel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------------- 小工具 ---------------- */
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function clampPct(v) { return v < 0 ? 0 : (v > 100 ? 100 : v); }
  function setText(sel, v) {
    /* 传 id（无 # 前缀）走 getElementById，传选择器走 querySelector */
    var el = sel;
    if (typeof sel === 'string') el = sel.charAt(0) === '#' ? $(sel) : doc.getElementById(sel);
    if (el) el.textContent = v;
  }
  /* 8192 -> "8 GB"，2458 -> "2.4 GB" */
  function fmtGB(mb) {
    var g = Math.round(num(mb) / 1024 * 10) / 10;
    return g + ' GB';
  }
  /* 34 -> "34%"；34.5 -> "34.5%" */
  function fmtPct(v) {
    var n = Math.round(v * 10) / 10;
    return (n % 1 === 0 ? String(n) : n.toFixed(1)) + '%';
  }
  var LEVEL = { low: '低配', mid: '中配', high: '高配' };
  var PRIORITY = { normal: '普通优先级', below: '低于正常', above: '高于正常' };
  function maskCores(mask) {
    var n = num(mask);
    if (n <= 0) return 0;
    var c = 0, v = Math.floor(n);
    while (v > 0) { c += v & 1; v = v >>> 1; }
    return c;
  }
  function summaryOf(rec) {
    var cores = rec.affinityMask === null || rec.affinityMask === undefined
      ? '不限核心' : '限制 ' + maskCores(rec.affinityMask) + ' 核';
    return fmtGB(rec.memoryMB) + ' 内存 · ' + (PRIORITY[rec.priority] || PRIORITY.normal) + ' · ' + cores;
  }
  function cpuLine(hw) {
    var parts = [];
    var model = String(hw.cpuModel || '').trim();
    if (model) parts.push(model);
    var cores = num(hw.cpuCores), threads = num(hw.cpuThreads);
    var mhz = num(hw.cpuMHz);
    var clock = mhz > 0 ? '@ ' + (Math.round(mhz / 10) / 100) + ' GHz' : '';
    if (cores > 0 && threads > 0) parts.push(cores + ' 核 ' + threads + ' 线程' + (clock ? ' ' + clock : ''));
    else if (threads > 0) parts.push(threads + ' 线程' + (clock ? ' ' + clock : ''));
    else if (cores > 0) parts.push(cores + ' 核' + (clock ? ' ' + clock : ''));
    else if (clock) parts.push(clock);
    return parts.length ? parts.join(' · ') : '未能识别 CPU 型号';
  }
  function ramLine(hw) {
    var total = num(hw.ramTotalMB);
    if (total <= 0) return '未能读取内存容量';
    var free = num(hw.ramFreeMB);
    return free > 0 ? fmtGB(total) + '（可用 ' + fmtGB(free) + '）' : fmtGB(total);
  }
  function gpuLine(hw) {
    var name = String(hw.gpuName || '').trim();
    var vram = num(hw.gpuVramMB);
    if (!name && vram <= 0) return '未能识别显卡';
    var t = vram >= 1024 ? (vram / 1024).toFixed(1) + ' GB 显存'
                         : (vram > 0 ? vram + ' MB 显存' : '');
    if (!name) return t;
    return t ? name + ' · ' + t : name;
  }
  function diskLine(hw) {
    var gb = num(hw.diskFreeGB);
    var head = gb > 0 ? '剩余 ' + (Math.round(gb * 10) / 10) + ' GB' : '剩余空间未知';
    var type = hw.isSSD === true ? 'SSD' : (hw.isSSD === false ? 'HDD' : '磁盘类型未知');
    return head + ' · ' + type;
  }

  /* ---------------- 样式 ---------------- */
  function injectCss() {
    if (doc.getElementById(CSS_ID)) return;
    var st = doc.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      /* 卡片本体沿用 .glass.list-card，只补内部结构（不复用 .opt-row / .form-row，
         避免被 patch-layout 的网格规则改写） */
      '#perfCard{margin-bottom:16px;padding:6px 4px 4px;border-radius:var(--r-l)}',
      '#perfCard .p40-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 13px 12px}',
      '#perfCard .p40-ico{width:38px;height:38px;border-radius:var(--r-m);display:grid;place-items:center;',
      '  flex-shrink:0;background:var(--panel-2);border:1px solid var(--stroke);color:var(--accent)}',
      '#perfCard .p40-ico svg{width:18px;height:18px}',
      '#perfCard .p40-title{flex:1;min-width:150px}',
      '#perfCard .p40-title b{display:block;font-size:13px;font-weight:600;color:var(--txt);letter-spacing:-.01em}',
      '#perfCard .p40-title span{display:block;margin-top:3px;font-size:11px;line-height:1.5;color:var(--txt-3)}',
      '#perfCard .p40-hact{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto}',

      /* 状态胶囊 */
      '#perfCard .p40-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 11px;',
      '  border-radius:var(--r-pill);font-size:11px;font-weight:600;white-space:nowrap;',
      '  color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line)}',
      '#perfCard .p40-pill i{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}',
      '#perfCard .p40-pill.is-load{color:var(--txt-2);background:var(--panel-2);border-color:var(--stroke)}',
      '#perfCard .p40-pill.is-load i{animation:p40blink calc(1.1s * var(--anim-k)) ease-in-out infinite}',
      '#perfCard .p40-pill.is-off{color:var(--txt-3);background:transparent;border-color:var(--stroke-2)}',
      '@keyframes p40blink{0%,100%{opacity:1}50%{opacity:.25}}',

      /* 硬件四行 */
      '#perfCard .p40-kv{display:grid;grid-template-columns:52px minmax(0,1fr);gap:7px 14px;',
      '  padding:2px 16px 14px}',
      '#perfCard .p40-kv>span{font-size:11.5px;color:var(--txt-3);padding-top:1px}',
      '#perfCard .p40-kv>b{font-size:12px;font-weight:520;line-height:1.55;color:var(--txt-2);word-break:break-word}',

      /* 分组 */
      '#perfCard .p40-sec{border-top:1px solid var(--stroke);padding:12px 16px 14px}',
      '#perfCard .p40-sec-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;',
      '  margin-bottom:10px;flex-wrap:wrap}',
      '#perfCard .p40-sec-h b{font-size:11.5px;font-weight:600;color:var(--txt-2);letter-spacing:.01em}',
      '#perfCard .p40-sec-h em{font-style:normal;font-size:10.5px;color:var(--txt-3);font-variant-numeric:tabular-nums}',

      /* 占用条 */
      '#perfCard .p40-bars{display:flex;flex-direction:column;gap:9px}',
      '#perfCard .p40-bar{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:11px}',
      '#perfCard .p40-bar>span{font-size:11px;color:var(--txt-3)}',
      '#perfCard .p40-track{height:6px;border-radius:var(--r-pill);background:var(--stroke-2);overflow:hidden}',
      '#perfCard .p40-fill{display:block;height:100%;width:0;border-radius:var(--r-pill);',
      '  background:linear-gradient(90deg,var(--accent-d),var(--accent),var(--accent-l));',
      '  transition:width calc(.5s * var(--anim-k)) var(--ease)}',
      '#perfCard .p40-val{font-size:11.5px;color:var(--txt-2);white-space:nowrap;font-variant-numeric:tabular-nums}',
      '#perfCard .p40-hint{margin-top:9px;font-size:10.5px;line-height:1.6;color:var(--txt-3)}',

      /* 推荐 */
      '#perfCard .p40-rec{font-size:13px;font-weight:600;color:var(--txt);letter-spacing:-.01em;',
      '  font-variant-numeric:tabular-nums;word-break:break-word}',
      '#perfCard .p40-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:12px}',
      '#perfCard .p40-btn{height:32px;padding:0 17px;border-radius:var(--r-pill);font-size:12px;',
      '  font-weight:600;border:1px solid transparent;flex-shrink:0;',
      '  transition:calc(.22s * var(--anim-k)) var(--ease)}',
      '#perfCard .p40-btn:disabled{opacity:.45;cursor:not-allowed}',
      /* 「已应用 ✓」的 1.6s 反馈期按钮是禁用的，但不该显得像坏掉 */
      '#perfCard .p40-btn.is-flash:disabled{opacity:1;cursor:default}',
      '#perfCard .p40-primary{color:var(--accent-ink);',
      '  background:linear-gradient(140deg,var(--accent-l),var(--accent));',
      '  box-shadow:0 8px 18px -12px var(--accent)}',
      '#perfCard .p40-primary:hover:not(:disabled){filter:brightness(1.05)}',
      '#perfCard .p40-ghost{color:var(--txt-2);background:var(--panel);border-color:var(--stroke)}',
      '#perfCard .p40-ghost:hover:not(:disabled){color:var(--txt);background:var(--panel-2);border-color:var(--stroke-2)}',
      '#perfCard .p40-state{margin-top:9px;font-size:10.5px;line-height:1.6;color:var(--txt-3)}',
      '#perfCard .p40-why{margin-top:11px;padding-top:10px;border-top:1px dashed var(--stroke)}',
      '#perfCard .p40-why>span{font-size:10.5px;color:var(--txt-3);letter-spacing:.04em}',
      '#perfCard .p40-why ul{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}',
      '#perfCard .p40-why li{position:relative;padding-left:12px;font-size:11px;line-height:1.6;color:var(--txt-3)}',
      '#perfCard .p40-why li::before{content:"";position:absolute;left:2px;top:7px;width:4px;height:4px;',
      '  border-radius:50%;background:var(--stroke-2)}',

      /* 空态 */
      '#perfCard[data-state="empty"] .p40-sec{border-top:0;padding-top:0}',
      '#perfCard[data-state="empty"] .p40-blank{padding-bottom:16px}',
      '#perfCard .p40-blank{display:flex;flex-direction:column;align-items:center;gap:8px;',
      '  padding:20px 18px 26px;text-align:center}',
      '#perfCard .p40-blank svg{width:26px;height:26px;color:var(--txt-3)}',
      '#perfCard .p40-blank b{font-size:12.5px;font-weight:600;color:var(--txt-2)}',
      '#perfCard .p40-blank span{max-width:360px;font-size:11px;line-height:1.65;color:var(--txt-3)}',

      /* 高级明细 */
      '#perfCard .p40-adv{margin:0 12px 10px;border:1px solid var(--stroke);border-radius:var(--r-m);',
      '  background:var(--panel);overflow:hidden}',
      '#perfCard .p40-adv>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;',
      '  padding:9px 13px;font-size:11px;color:var(--txt-3);cursor:pointer;list-style:none}',
      '#perfCard .p40-adv>summary::-webkit-details-marker{display:none}',
      '#perfCard .p40-adv>summary svg{width:13px;height:13px;flex-shrink:0;',
      '  transition:transform calc(.22s * var(--anim-k)) var(--ease)}',
      '#perfCard .p40-adv[open]>summary svg{transform:rotate(180deg)}',
      '#perfCard .p40-adv-body{padding:2px 13px 12px}',
      '#perfCard .p40-adv-lbl{margin:8px 0 5px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--txt-3)}',
      '#perfCard .p40-adv pre{margin:0;padding:10px 12px;border-radius:var(--r-s);background:var(--panel-2);',
      '  border:1px solid var(--stroke);font-family:ui-monospace,"SF Mono",Consolas,monospace;',
      '  font-size:10.5px;line-height:1.6;color:var(--txt-2);white-space:pre-wrap;word-break:break-word;',
      '  max-height:168px;overflow:auto}',
      '#perfCard .p40-jvm{display:flex;flex-wrap:wrap;gap:6px}',
      '#perfCard .p40-jvm code{padding:3px 9px;border-radius:var(--r-pill);background:var(--panel-2);',
      '  border:1px solid var(--stroke);font-family:ui-monospace,"SF Mono",Consolas,monospace;',
      '  font-size:10.5px;color:var(--txt-2);white-space:nowrap}',
      '#perfCard .p40-jvm em{font-style:normal;font-size:11px;color:var(--txt-3)}',

      /* 窄窗：标签列变上标，避免长文本挤压 */
      '@media (max-width:760px){',
      '  #perfCard .p40-kv{grid-template-columns:1fr;gap:2px 0}',
      '  #perfCard .p40-kv>span{padding-top:7px}',
      '  #perfCard .p40-bar{grid-template-columns:34px minmax(0,1fr);row-gap:5px}',
      '  #perfCard .p40-val{grid-column:2;justify-self:end}',
      '}'
    ].join('');
    doc.head.appendChild(st);
  }

  /* ---------------- DOM ---------------- */
  var SVG_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="6.2" y="6.2" width="11.6" height="11.6" rx="2.6"/>' +
    '<rect x="9.6" y="9.6" width="4.8" height="4.8" rx="1.2"/>' +
    '<path d="M9.6 3.5v2.2M14.4 3.5v2.2M9.6 18.3v2.2M14.4 18.3v2.2M3.5 9.6h2.2M3.5 14.4h2.2M18.3 9.6h2.2M18.3 14.4h2.2"/></svg>';
  var SVG_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';

  function buildCard() {
    var card = doc.createElement('div');
    card.className = 'glass list-card';
    card.id = CARD_ID;
    card.setAttribute('data-state', 'loading');
    card.innerHTML = [
      '<div class="p40-head">',
      '  <div class="p40-ico">', SVG_ICO, '</div>',
      '  <div class="p40-title">',
      '    <b>设备性能</b>',
      '    <span id="p40Sub">首次进设置页时检测一次，不拖慢启动</span>',
      '  </div>',
      '  <div class="p40-hact">',
      '    <button type="button" class="mini-btn" id="p40Rescan">重新检测</button>',
      '    <span class="p40-pill is-load" id="p40Pill"><i></i><span id="p40PillTxt">检测中…</span></span>',
      '  </div>',
      '</div>',

      '<div class="p40-body" id="p40Body">',
      '  <div class="p40-blank" id="p40Blank" hidden>',
      '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
      '      <path d="M12 4.4 3.6 19.2h16.8L12 4.4Z"/><path d="M12 9.6v4.2M12 16.6v.1"/>',
      '    </svg>',
      '    <b>当前环境无法读取硬件信息（网页预览）</b>',
      '    <span>桌面版启动器会自动检测 CPU / 内存 / 显卡，并在前 5 次启动里采样平均占用，再给出推荐运行限制。</span>',
      '  </div>',

      '  <div class="p40-kv" id="p40Kv">',
      '    <span>CPU</span><b id="p40Cpu">—</b>',
      '    <span>内存</span><b id="p40Ram">—</b>',
      '    <span>显卡</span><b id="p40Gpu">—</b>',
      '    <span>磁盘</span><b id="p40Disk">—</b>',
      '  </div>',

      '  <div class="p40-sec" id="p40StatsSec">',
      '    <div class="p40-sec-h"><b>近 5 次启动的平均占用</b></div>',
      '    <div class="p40-bars" id="p40Bars" hidden>',
      '      <div class="p40-bar"><span>CPU</span>',
      '        <div class="p40-track"><i class="p40-fill" id="p40CpuFill"></i></div>',
      '        <em class="p40-val" id="p40CpuVal">—</em></div>',
      '      <div class="p40-bar"><span>内存</span>',
      '        <div class="p40-track"><i class="p40-fill" id="p40RamFill"></i></div>',
      '        <em class="p40-val" id="p40RamVal">—</em></div>',
      '    </div>',
      '    <div class="p40-hint" id="p40NoStats" hidden>还没有启动记录，玩一次游戏后这里就有数据了</div>',
      '    <div class="p40-hint" id="p40Hint">正在读取设备信息…</div>',
      '  </div>',

      '  <div class="p40-sec">',
      '    <div class="p40-sec-h" id="p40RecHead"><b>建议运行限制</b></div>',
      '    <div class="p40-rec" id="p40Rec">—</div>',
      '    <div class="p40-actions">',
      '      <button type="button" class="p40-btn p40-primary" id="p40Apply" disabled>应用推荐</button>',
      '      <button type="button" class="p40-btn p40-ghost" id="p40Auto" disabled>恢复自动</button>',
      '    </div>',
      '    <div class="p40-state" id="p40State"></div>',
      '    <div class="p40-why" id="p40Why" hidden><span>理由</span><ul id="p40WhyList"></ul></div>',
      '  </div>',

      '  <details class="p40-adv" id="p40Adv" data-adv="1" hidden>',
      '    <summary><span>高级明细</span>', SVG_CHEV, '</summary>',
      '    <div class="p40-adv-body">',
      '      <div class="p40-adv-lbl">stats / resolved 原始数据</div>',
      '      <pre id="p40Raw">—</pre>',
      '      <div class="p40-adv-lbl">JVM 参数</div>',
      '      <div class="p40-jvm" id="p40Jvm"><em>—</em></div>',
      '    </div>',
      '  </details>',
      '</div>'
    ].join('');
    return card;
  }

  /* ---------------- 渲染 ---------------- */
  function setPill(text, mode) {
    var pill = doc.getElementById('p40Pill');
    if (!pill) return;
    pill.className = 'p40-pill' + (mode === 'load' ? ' is-load' : (mode === 'off' ? ' is-off' : ''));
    setText('p40PillTxt', text);
  }

  function setButtons(enabled) {
    ['p40Rescan', 'p40Apply', 'p40Auto'].forEach(function (id) {
      var b = doc.getElementById(id);
      if (b) b.disabled = !enabled;
    });
  }

  function renderLoading() {
    setPill('检测中…', 'load');
    setButtons(false);
    setText('p40Sub', '读取 CPU / 内存 / 显卡，只读探测，不写任何配置');
  }

  function renderEmpty() {
    var card = doc.getElementById(CARD_ID);
    if (!card) return;
    card.setAttribute('data-state', 'empty');
    /* 空态：只留一句说明 + 置灰的按钮，绝不显示 0 GB / 0% 这种编造值 */
    var hide = ['p40Kv', 'p40StatsSec', 'p40RecHead', 'p40Rec', 'p40State', 'p40Why', 'p40Adv'];
    var body = doc.getElementById('p40Body');
    var blank = doc.getElementById('p40Blank');
    if (body) body.hidden = false;
    if (blank) blank.hidden = false;
    hide.forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) el.hidden = true;
    });
    setPill('不可用', 'off');
    setButtons(false);
    setText('p40Sub', '没有 FMBridge 或主进程未就绪时，不会显示任何编造的数字');
  }

  function renderState() {
    var el = doc.getElementById('p40State');
    if (!el) return;
    var raw = Lget('mc.limits');
    var lim = null;
    if (raw) { try { lim = JSON.parse(raw); } catch (e) { lim = null; } }
    var mb = lim && num(lim.memoryMB);
    if (mb > 0) {
      var cores = lim.affinityMask === null || lim.affinityMask === undefined
        ? '不限核心' : '限制 ' + maskCores(lim.affinityMask) + ' 核';
      el.textContent = '当前已应用：' + fmtGB(mb) + ' 内存 · ' +
        (PRIORITY[lim.priority] || PRIORITY.normal) + ' · ' + cores +
        '（.minecraft 启动时生效）';
    } else {
      el.textContent = '当前：自动（每次启动按硬件与历史样本重新判定）';
    }
  }

  function render(data) {
    var card = doc.getElementById(CARD_ID);
    if (!card) return;
    if (!data || data.ok !== true) { renderEmpty(); return; }

    var hw = data.hw || {};
    var stats = data.stats || {};
    var rec = data.recommend || {};
    var resolved = data.resolved || {};
    var launches = Array.isArray(stats.launches) ? stats.launches : [];
    var n = Math.min(launches.length, MAX_LAUNCH);

    card.setAttribute('data-state', 'ok');
    var body = doc.getElementById('p40Body');
    var blank = doc.getElementById('p40Blank');
    if (body) body.hidden = false;
    if (blank) blank.hidden = true;
    /* 上一次可能是空态，把数据区重新显出来 */
    ['p40Kv', 'p40StatsSec', 'p40RecHead', 'p40Rec', 'p40State'].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) el.hidden = false;
    });

    setPill((LEVEL[rec.level] || '已检测') + '设备', 'ok');
    setText('p40Sub', '前 5 次启动自动采样，用于校准推荐值');
    setText('p40Cpu', cpuLine(hw));
    setText('p40Ram', ramLine(hw));
    setText('p40Gpu', gpuLine(hw));
    setText('p40Disk', diskLine(hw));

    /* 占用条：没有样本时不画空条，只给一句说明 */
    var bars = doc.getElementById('p40Bars');
    var noStats = doc.getElementById('p40NoStats');
    var hint = doc.getElementById('p40Hint');
    if (!n) {
      if (bars) bars.hidden = true;
      if (noStats) noStats.hidden = false;
      if (hint) {
        hint.hidden = true;               /* 没样本时不写「已记录 0/5」，只留上面那句 */
        hint.textContent = '满 ' + MAX_LAUNCH + ' 次后推荐会更准';
      }
    } else {
      var cpu = clampPct(num(stats.avgCpu));
      var ramMB = num(stats.avgRamMB);
      var totalMB = num(hw.ramTotalMB);
      var ramPct = totalMB > 0 ? clampPct(ramMB / totalMB * 100) : 0;
      if (bars) bars.hidden = false;
      if (noStats) noStats.hidden = true;
      if (hint) hint.hidden = false;
      var cf = doc.getElementById('p40CpuFill');
      var rf = doc.getElementById('p40RamFill');
      if (cf) cf.style.width = fmtPct(cpu);
      if (rf) rf.style.width = fmtPct(ramPct);
      setText('p40CpuVal', fmtPct(cpu));
      setText('p40RamVal', totalMB > 0 ? fmtGB(ramMB) + ' / ' + fmtGB(totalMB) : fmtGB(ramMB) + ' / 未知');
      if (hint) {
        hint.textContent = '已记录 ' + n + ' / ' + MAX_LAUNCH + ' 次 · ' +
          (n >= MAX_LAUNCH ? '推荐已按历史数据校准' : '满 ' + MAX_LAUNCH + ' 次后推荐会更准');
      }
    }

    /* 推荐摘要 + 理由 */
    setText('p40Rec', resolved.summary || summaryOf(rec));
    var why = doc.getElementById('p40Why');
    var list = doc.getElementById('p40WhyList');
    var reasons = Array.isArray(rec.reasons) ? rec.reasons : [];
    if (list) {
      list.innerHTML = '';
      reasons.slice(0, 4).forEach(function (r) {
        var li = doc.createElement('li');
        li.textContent = String(r == null ? '' : r);
        list.appendChild(li);
      });
    }
    if (why) why.hidden = !reasons.length;

    /* 高级明细 */
    var adv = doc.getElementById('p40Adv');
    if (adv) adv.hidden = false;
    var raw = { stats: stats, resolved: resolved };
    var rawEl = doc.getElementById('p40Raw');
    if (rawEl) rawEl.textContent = JSON.stringify(raw, null, 2);
    var jvmBox = doc.getElementById('p40Jvm');
    if (jvmBox) {
      var jvm = Array.isArray(resolved.jvmArgs) ? resolved.jvmArgs : (Array.isArray(rec.jvmArgs) ? rec.jvmArgs : []);
      jvmBox.innerHTML = '';
      if (!jvm.length) {
        var em = doc.createElement('em');
        em.textContent = '无附加参数';
        jvmBox.appendChild(em);
      } else {
        jvm.forEach(function (a) {
          var c = doc.createElement('code');
          c.textContent = String(a);
          jvmBox.appendChild(c);
        });
      }
    }

    renderState();
    setButtons(!state.busy);
  }

  /* ---------------- 动作 ---------------- */
  function flash(id, text) {
    var b = doc.getElementById(id);
    if (!b) return;
    if (!b.getAttribute('data-label')) b.setAttribute('data-label', b.textContent);
    b.textContent = text;
    b.disabled = true;
    b.classList.add('is-flash');
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      b.textContent = b.getAttribute('data-label') || text;
      b.disabled = false;
      b.classList.remove('is-flash');
      state.timer = 0;
    }, 1600);
  }

  function applyRecommend() {
    var d = state.data;
    if (!d || d.ok !== true) return;
    var rec = d.recommend || {};
    var mb = num(rec.memoryMB);
    if (mb <= 0) return;

    var limits = {
      memoryMB: mb,
      priority: rec.priority || 'normal',
      affinityMask: rec.affinityMask === undefined ? null : rec.affinityMask,
      jvmArgs: Array.isArray(rec.jvmArgs) ? rec.jvmArgs.slice() : [],
      gc: 'auto',
      memoryMode: 'auto',
      appliedAt: Date.now()
    };
    Lset('mc.limits', JSON.stringify(limits));
    /* 老代码（index.html 里 game:launch 的 maxMemoryMB 回退链）只认 GB 整数 */
    Lset('mc.mem', String(Math.round(mb / 1024)));
    ipc('perf:launchNote', { wizardDoneAt: Date.now(), auto: true });
    renderState();
    flash('p40Apply', '已应用 ✓');
  }

  function restoreAuto() {
    /* 清掉自定义限制 —— 启动器按没有 limits 的老路径走，内存回到默认档位 */
    Ldel('mc.limits');
    Lset('mc.mem', DEFAULT_MEM);
    ipc('perf:launchNote', { wizardDoneAt: Date.now(), auto: true });
    renderState();
    flash('p40Auto', '已恢复自动 ✓');
  }

  function rescan() {
    if (state.busy) return;
    state.busy = true;
    setButtons(false);
    setPill('检测中…', 'load');
    var btn = doc.getElementById('p40Rescan');
    if (btn) {
      if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', '重新检测');
      btn.textContent = '检测中…';
    }
    ipc('perf:reset').then(function () {
      return ipc('perf:info');
    }).then(function (d) {
      state.data = d;
      state.loaded = true;
      state.busy = false;
      if (btn) btn.textContent = btn.getAttribute('data-label') || '重新检测';
      render(d);
    }).catch(function (e) {
      /* 任何异常都要把按钮还回去，不能让「检测中…」永久停在半路 */
      state.busy = false;
      if (btn) btn.textContent = btn.getAttribute('data-label') || '重新检测';
      setButtons(true);
      console.warn('[patch 40] rescan', e);
    });
  }

  /* ---------------- 懒加载：进过设置页才探测 ---------------- */
  function loadOnce() {
    if (state.loaded || state.loading) return;
    state.loading = true;
    renderLoading();
    /* ipc() 自己吞异常，这里的 catch 只兜 render 内部抛错，别把 loading 卡死 */
    ipc('perf:info').then(function (d) {
      state.loading = false;
      state.loaded = true;
      state.data = d;
      render(d);
    }).catch(function (e) {
      state.loading = false;
      console.warn('[patch 40] render', e);
    });
  }

  function watchSettings() {
    var page = doc.getElementById('page-settings');
    if (!page) return;
    var fired = false;
    function check() {
      var visible = page.classList.contains('active') && !page.hidden;
      if (!visible || fired) return;
      fired = true;
      loadOnce();
    }
    /* SPA 用 .page.active 控制显隐（不是 hidden 属性），两种都监听，兼容以后改造 */
    if (typeof window.MutationObserver === 'function') {
      try {
        new MutationObserver(check).observe(page, {
          attributes: true, attributeFilter: ['class', 'hidden', 'style']
        });
      } catch (e) { /* 老内核忽略 */ }
    }
    /* 兜底：侧栏「设置」被点过一次也要能触发（go() 在页面主脚本里，补丁不能改它） */
    doc.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== doc) {
        if (t.classList && t.classList.contains('rail-btn') && t.getAttribute('data-page') === 'settings') {
          setTimeout(check, 20);
          return;
        }
        t = t.parentNode;
      }
    }, true);
    check();
  }

  /* ---------------- 挂载 ---------------- */
  function bind(card) {
    var rescanBtn = $('#p40Rescan', card);
    var applyBtn = $('#p40Apply', card);
    var autoBtn = $('#p40Auto', card);
    if (rescanBtn) rescanBtn.addEventListener('click', rescan);
    if (applyBtn) applyBtn.addEventListener('click', applyRecommend);
    if (autoBtn) autoBtn.addEventListener('click', restoreAuto);
    renderState();
  }

  function mount() {
    if (doc.getElementById(CARD_ID)) return false;
    var tab = doc.getElementById('tab-general');
    if (!tab) return false;
    var anchor = null;
    var speed = doc.getElementById('speedSeg');
    if (speed && speed.closest) anchor = speed.closest('.glass');
    if (!anchor || anchor.parentNode !== tab) anchor = tab.firstElementChild;
    var card = buildCard();
    tab.insertBefore(card, anchor || null);
    bind(card);
    return true;
  }

  function init() {
    try {
      injectCss();
      if (doc.getElementById(CARD_ID)) return;   /* 幂等：重复 init 不再建第二张 */
      if (!mount()) return;
      watchSettings();
    } catch (e) {
      console.warn('[patch 40]', e);
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();

  console.log('[patch 40] ready');
})();
