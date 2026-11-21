/* ------------------------------------------------------------------
 * patch/50-onboarding.js — 首次启动三步引导 + 简单 / 高级两种界面模式
 * 作用域：只往 body 追加 #p50Wizard 遮罩；给设置页补 2 行高级参数
 *         （JVM 垃圾回收器 / 启动超时）；给 #tab-about 末尾追加「重新运行首次引导」。
 *         不改 index.html，不碰 #perfCard / #memCard / #runLimitCard 的内部结构。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var doc = document;
  var HTML = doc.documentElement;

  var K_MODE = 'mc.mode';           /* 'simple' | 'advanced' */
  var K_DONE = 'mc.onboarded';      /* '1' 表示走过向导 */
  var K_AT = 'mc.onboardedAt';
  var K_LIMITS = 'mc.limits';
  var K_MEM = 'mc.mem';
  var K_TIMEOUT = 'mc.startTimeout';

  var state = { step: 1, plan: '', skill: '' };

  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function readJSON(k) {
    try { var raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function writeJSON(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} }

  /* 合并写 mc.limits：不覆盖别的补丁已经放进去的字段（例如 priority / jvmArgs） */
  function patchLimits(patch) {
    var cur = readJSON(K_LIMITS);
    if (!cur || typeof cur !== 'object') cur = {};
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k];
    }
    writeJSON(K_LIMITS, cur);
    return cur;
  }

  async function ipc(channel, payload) {
    if (!window.FMBridge || typeof window.FMBridge.invoke !== 'function') return null;
    try { return await window.FMBridge.invoke(channel, payload || {}); }
    catch (e) { console.warn('[patch 50] ipc', channel, e); return null; }
  }

  /* ================================================================
   *  样式
   * ================================================================ */
  function injectCss() {
    if (doc.getElementById('patch-50-style')) return;
    var css = [
      /* ---------- 模式开关 ---------- */
      'html[data-mode="simple"] [data-adv="1"]{display:none !important}',
      'html[data-mode="simple"] .p50-simple-hide{display:none !important}',
      'html[data-mode="simple"] .p50-simple-inline{display:none !important}',
      /* 简单模式下整张卡的行都被藏掉了，就别留一个只有标题的空卡 */
      'html[data-mode="simple"] .p50-card-empty{display:none !important}',

      /* ---------- 向导外壳 ---------- */
      '#p50Wizard{position:fixed;inset:0;z-index:900;display:grid;place-items:center;padding:24px;',
      '  background:rgba(8,14,12,.55);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);',
      '  transition:opacity .22s ease}',
      '#p50Wizard.out{opacity:0}',
      '#p50Wizard[hidden]{display:none}',
      'body.p50-lock{overflow:hidden}',

      '#p50Card{position:relative;width:min(560px,100%);max-height:min(88vh,760px);overflow:auto;',
      '  padding:24px 30px 50px;border-radius:24px;color:var(--txt);',
      '  background:linear-gradient(165deg,var(--glass-a),var(--glass-b)),var(--panel-2);',
      '  border:1px solid var(--stroke);box-shadow:0 48px 100px -48px var(--shadow-2)}',

      '#p50Card .p50-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}',
      '#p50Card .p50-brand{display:inline-flex;align-items:center;gap:9px;font-size:11.5px;font-weight:600;',
      '  letter-spacing:.02em;color:var(--txt-3)}',
      '#p50Card .p50-brand svg{width:20px;height:20px;color:var(--accent)}',
      '#p50Card .p50-count{font-size:11px;color:var(--txt-3);letter-spacing:.1em;font-variant-numeric:tabular-nums}',

      '#p50Card .p50-step{display:none}',
      '#p50Card .p50-step.on{display:block;animation:p50in .26s var(--ease) both}',
      '@keyframes p50in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',

      '#p50Card .p50-hero{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;',
      '  margin-bottom:16px;color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line)}',
      '#p50Card .p50-hero svg{width:24px;height:24px}',

      '#p50Card .p50-h{margin:0 0 8px;font-size:20px;line-height:1.35;font-weight:650;letter-spacing:-.02em;color:var(--txt)}',
      '#p50Card .p50-p{margin:0 0 20px;font-size:12.5px;line-height:1.75;color:var(--txt-2)}',

      /* ---------- 选项卡 ---------- */
      '#p50Card .p50-opts{display:flex;flex-direction:column;gap:10px;margin-bottom:22px}',
      '#p50Card .p50-opt{display:flex;align-items:center;gap:14px;width:100%;text-align:left;',
      '  padding:14px 16px;border-radius:16px;cursor:pointer;color:var(--txt);font:inherit;',
      '  background:var(--panel);border:1px solid var(--stroke);',
      '  transition:background .18s var(--ease),border-color .18s var(--ease),box-shadow .18s var(--ease)}',
      '#p50Card .p50-opt:hover{background:var(--panel-2);border-color:var(--stroke-2)}',
      '#p50Card .p50-opt:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
      '#p50Card .p50-opt.on{border-color:var(--accent-line);background:var(--panel-2);',
      '  box-shadow:0 0 0 3px var(--accent-soft)}',
      '#p50Card .p50-opt-ico{flex-shrink:0;width:36px;height:36px;border-radius:12px;display:grid;place-items:center;',
      '  color:var(--txt-2);background:var(--panel-2);border:1px solid var(--stroke)}',
      '#p50Card .p50-opt-ico svg{width:18px;height:18px}',
      '#p50Card .p50-opt.on .p50-opt-ico{color:var(--accent);background:var(--accent-soft);border-color:var(--accent-line)}',
      '#p50Card .p50-opt-m{flex:1;min-width:0}',
      '#p50Card .p50-opt-m b{display:block;font-size:13px;font-weight:600;line-height:1.4;color:var(--txt)}',
      '#p50Card .p50-opt-m span{display:block;margin-top:3px;font-size:11.5px;line-height:1.6;color:var(--txt-3)}',
      '#p50Card .p50-tick{flex-shrink:0;width:22px;height:22px;display:grid;place-items:center;border-radius:50%;',
      '  color:var(--accent-ink);background:var(--accent);opacity:0;transform:scale(.6);',
      '  transition:opacity .18s var(--ease),transform .18s var(--ease)}',
      '#p50Card .p50-tick svg{width:13px;height:13px}',
      '#p50Card .p50-opt.on .p50-tick{opacity:1;transform:none}',

      /* ---------- 底部按钮 ---------- */
      '#p50Card .p50-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px}',
      '#p50Card .p50-back{margin-right:auto;height:34px;padding:0 6px;border:0;background:transparent;',
      '  border-radius:10px;font:inherit;font-size:12px;color:var(--txt-3);cursor:pointer}',
      '#p50Card .p50-back:hover{color:var(--txt-2)}',
      '#p50Card .p50-btn{height:38px;padding:0 22px;border-radius:12px;border:1px solid transparent;',
      '  font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;',
      '  transition:filter .18s var(--ease),opacity .18s var(--ease)}',
      '#p50Card .p50-primary{color:var(--accent-ink);background:var(--accent);border-color:var(--accent-d)}',
      '#p50Card .p50-primary:hover:not(:disabled){filter:brightness(1.06)}',
      '#p50Card .p50-primary:disabled{opacity:.4;cursor:not-allowed}',
      '#p50Card .p50-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',

      '#p50Card .p50-skip{position:absolute;right:26px;bottom:14px;padding:2px 4px;border:0;background:transparent;',
      '  border-radius:8px;font:inherit;font-size:11px;color:var(--txt-3);cursor:pointer;opacity:.7;',
      '  transition:opacity .18s var(--ease),color .18s var(--ease)}',
      '#p50Card .p50-skip:hover{opacity:1;color:var(--txt-2)}',
      '#p50Card .p50-skip:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',

      /* ---------- 高级模式新增的两行 ---------- */
      '#p50GcRow .seg{flex-wrap:wrap;justify-content:flex-end;max-width:100%}',
      '#p50GcRow .seg button{padding:6px 12px;font-size:11.5px}',
      '#p50Timeout{max-width:120px;text-align:center;font-variant-numeric:tabular-nums}',
      '#p50Timeout::-webkit-outer-spin-button,#p50Timeout::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}',

      /* ---------- 关于页的重开入口 ---------- */
      '#p50RerunRow{display:flex;align-items:center;gap:14px;padding:6px 16px 16px}',
      '#p50RerunRow .p50-rerun-m{flex:1;min-width:0}',
      '#p50RerunRow .p50-rerun-m b{display:block;font-size:12.5px;font-weight:580;color:var(--txt)}',
      '#p50RerunRow .p50-rerun-m span{display:block;margin-top:3px;font-size:11px;line-height:1.55;color:var(--txt-3)}',
      '#p50Rerun{height:32px;padding:0 16px;font-size:11.5px;flex-shrink:0}',
      '@media (max-width:560px){',
      '  #p50Card{padding:20px 20px 48px;border-radius:20px}',
      '  #p50GcRow .seg{justify-content:flex-start}',
      '}'
    ].join('\n');

    var st = doc.createElement('style');
    st.id = 'patch-50-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  /* ================================================================
   *  模式
   * ================================================================ */
  function savedMode() {
    var m = read(K_MODE);
    return (m === 'simple' || m === 'advanced') ? m : '';
  }

  function applyMode(mode) {
    if (mode !== 'simple' && mode !== 'advanced') return;
    HTML.setAttribute('data-mode', mode);
    markSimpleTargets();
  }

  /* 简单模式要藏、但原 HTML 没有 data-adv 的复杂项：给它们的 form-row 打标记 */
  function markSimpleTargets() {
    hideRowOf('#setJavaPath');
    hideRowOf('#setJvmArgs');
    hideRowOf('#langSeg');

    var custom = doc.getElementById('concCustomBox');
    if (custom) custom.classList.add('p50-simple-hide');

    /* 游戏窗口：只藏宽 / 高两个输入和中间的 ×，保留「全屏」开关 */
    var w = doc.getElementById('setResW');
    if (w) {
      w.classList.add('p50-simple-inline');
      var between = w.nextElementSibling;
      if (between && between.tagName === 'SPAN' && String(between.textContent).replace(/\s/g, '') === '×') {
        between.classList.add('p50-simple-inline');
      }
    }
    var h = doc.getElementById('setResH');
    if (h) h.classList.add('p50-simple-inline');

    syncEmptyCards();
  }

  /* 简单模式下某些卡的行全被藏了（Java 与内存 / 运行参数限制），整张卡一起收掉 */
  function syncEmptyCards() {
    var page = doc.getElementById('page-settings');
    if (!page) return;
    var simple = HTML.getAttribute('data-mode') === 'simple';

    $$('.list-card', page).forEach(function (card) {
      var rows = $$('.form-row', card);
      if (!rows.length) return;
      var left = 0;
      rows.forEach(function (r) {
        if (r.classList.contains('p50-simple-hide')) return;
        if (simple && r.getAttribute('data-adv') === '1') return;
        left++;
      });
      card.classList.toggle('p50-card-empty', simple && left === 0);
    });
  }

  function hideRowOf(sel) {
    var el = $(sel);
    if (!el) return;
    var row = el.closest ? el.closest('.form-row') : null;
    (row || el).classList.add('p50-simple-hide');
  }

  /* ================================================================
   *  高级模式补充参数
   * ================================================================ */
  function javaCard() {
    var p = doc.getElementById('setJavaPath');
    if (p && p.closest) return p.closest('.glass.list-card');
    return null;
  }

  function injectGcRow() {
    if (doc.getElementById('p50GcRow')) return true;
    var card = javaCard();
    if (!card) return false;

    var row = doc.createElement('div');
    row.className = 'form-row';
    row.id = 'p50GcRow';
    row.setAttribute('data-adv', '1');
    row.innerHTML =
      '<div class="form-lbl">' +
        '<b>JVM 垃圾回收器</b>' +
        '<span>自动跟随内存档位；大内存可以试 ZGC，小内存串行更省</span>' +
      '</div>' +
      '<div class="seg" id="p50GcSeg" role="group" aria-label="JVM 垃圾回收器">' +
        '<button type="button" data-gc="auto" class="on">自动</button>' +
        '<button type="button" data-gc="g1">G1GC</button>' +
        '<button type="button" data-gc="zgc">ZGC</button>' +
        '<button type="button" data-gc="serial">串行</button>' +
      '</div>';
    card.appendChild(row);

    bindGcRow(row);
    syncGcUI();
    return true;
  }

  function injectTimeoutRow() {
    if (doc.getElementById('p50TimeoutRow')) return true;
    var host = doc.getElementById('runLimitCard') || doc.getElementById('memCard') || javaCard();
    if (!host) return false;

    var row = doc.createElement('div');
    row.className = 'form-row';
    row.id = 'p50TimeoutRow';
    row.setAttribute('data-adv', '1');
    row.innerHTML =
      '<div class="form-lbl">' +
        '<b>启动超时</b>' +
        '<span>超过这个时间还没出画面就判定启动失败，单位秒</span>' +
      '</div>' +
      '<input class="inp" id="p50Timeout" type="number" min="30" max="900" step="10" ' +
        'inputmode="numeric" spellcheck="false" aria-label="启动超时（秒）">';
    host.appendChild(row);

    var inp = doc.getElementById('p50Timeout');
    if (inp) {
      var saved = Number(read(K_TIMEOUT));
      inp.value = String(saved > 0 ? saved : 120);
      inp.addEventListener('change', onTimeoutChange);
      inp.addEventListener('blur', onTimeoutChange);
    }
    return true;
  }

  function onTimeoutChange(e) {
    var el = e && e.target ? e.target : doc.getElementById('p50Timeout');
    if (!el) return;
    var v = Math.round(Number(el.value));
    if (!v || isNaN(v) || v <= 0) { drop(K_TIMEOUT); el.value = '120'; return; }
    if (v < 30) v = 30;
    if (v > 900) v = 900;
    el.value = String(v);
    write(K_TIMEOUT, v);
  }

  function bindGcRow(row) {
    if (row.getAttribute('data-p50') === '1') return;
    row.setAttribute('data-p50', '1');

    row.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-gc]') : null;
      if (!b) return;
      var v = b.getAttribute('data-gc') || 'auto';
      $$('button[data-gc]', row).forEach(function (x) { x.classList.toggle('on', x === b); });
      patchLimits({ gc: v });
      /* 和 patch 30 的 #gcSeg 保持同步，避免两处显示不一致 */
      var other = doc.getElementById('gcSeg');
      if (other) {
        $$('button[data-gc]', other).forEach(function (x) {
          x.classList.toggle('on', x.getAttribute('data-gc') === v);
        });
      }
    });
  }

  /* 反向同步：#gcSeg 被改时，镜像到我这一行 */
  function bindGcMirror() {
    var other = doc.getElementById('gcSeg');
    if (!other || other.getAttribute('data-p50') === '1') return;
    other.setAttribute('data-p50', '1');
    other.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-gc]') : null;
      if (!b) return;
      var v = b.getAttribute('data-gc') || 'auto';
      var mine = doc.getElementById('p50GcSeg');
      if (mine) {
        $$('button[data-gc]', mine).forEach(function (x) {
          x.classList.toggle('on', x.getAttribute('data-gc') === v);
        });
      }
    });
  }

  function syncGcUI() {
    var seg = doc.getElementById('p50GcSeg');
    if (!seg) return;
    var lim = readJSON(K_LIMITS);
    var v = lim && lim.gc ? String(lim.gc) : 'auto';
    var hit = false;
    $$('button[data-gc]', seg).forEach(function (x) {
      var on = x.getAttribute('data-gc') === v;
      if (on) hit = true;
      x.classList.toggle('on', on);
    });
    if (!hit) {
      $$('button[data-gc]', seg).forEach(function (x) {
        x.classList.toggle('on', x.getAttribute('data-gc') === 'auto');
      });
    }
  }

  function ensureExtras() {
    var a = injectGcRow();
    var b = injectTimeoutRow();
    bindGcMirror();
    markSimpleTargets();
    return a && b;
  }

  /* ================================================================
   *  关于页：重新运行首次引导
   * ================================================================ */
  function injectRerun() {
    if (doc.getElementById('p50RerunRow')) return true;
    var tab = doc.getElementById('tab-about');
    if (!tab) return false;

    var card = doc.createElement('div');
    card.className = 'glass list-card';
    card.id = 'p50RerunCard';
    card.style.marginTop = '16px';
    card.innerHTML =
      '<div class="group-title">首次引导</div>' +
      '<div class="form-row" id="p50RerunRow" style="border:0">' +
        '<div class="p50-rerun-m">' +
          '<b>重新选择使用方式</b>' +
          '<span>再回答一次那三个问题，随时可以在简单模式和高级模式之间切换</span>' +
        '</div>' +
        '<button type="button" class="mini-btn" id="p50Rerun">重新运行首次引导</button>' +
      '</div>';
    tab.appendChild(card);

    var btn = doc.getElementById('p50Rerun');
    if (btn) {
      btn.addEventListener('click', function () {
        drop(K_DONE);
        drop(K_AT);
        openWizard();
      });
    }
    return true;
  }

  /* ================================================================
   *  向导
   * ================================================================ */
  var SVG = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
           'stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.6 4.3 4.3L19 7"/></svg>',
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 2.9 20.3 7.7v8.6L12 21.1 3.7 16.3V7.7Z"/>' +
          '<path d="M12 12 3.7 7.7M12 12l8.3-4.3M12 12v9.1" opacity=".85"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
           'stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4v4.3M12 16.3v4.3M3.4 12h4.3M16.3 12h4.3"/>' +
           '<path d="m6.4 6.4 2.5 2.5M15.1 15.1l2.5 2.5M17.6 6.4l-2.5 2.5M8.9 15.1l-2.5 2.5"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
          'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/>' +
          '<path d="M10.3 8.9 15.3 12l-5 3.1V8.9Z"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
             'stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h8.4M17.6 8H20M4 16h3.4M12.6 16H20"/>' +
             '<circle cx="15" cy="8" r="2.1"/><circle cx="10" cy="16" r="2.1"/></svg>',
    wand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M14.4 6.2 17.8 9.6 8.1 19.3a2.4 2.4 0 0 1-3.4-3.4L14.4 6.2Z"/>' +
          '<path d="M16.6 4.4 17.4 2.6M21.4 7.4 19.6 8.2M18.6 2.8 18.2 4.9"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
           'stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.2V11M9.3 19.2V5M14.7 19.2v-5.6M20 19.2v-9.4"/>' +
           '<path d="M4 19.2h16"/></svg>',
    term: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
          'stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="4.6" width="17.2" height="14.8" rx="3.2"/>' +
          '<path d="m7.6 10 2.2 2.2-2.2 2.2M12.8 14.4h3.8"/></svg>'
  };

  function wizardHtml() {
    return [
      '<div id="p50Card" role="dialog" aria-modal="true" aria-label="首次使用引导">',
        '<div class="p50-top">',
          '<span class="p50-brand">' + SVG.logo + '<span>X Craft Launcher</span></span>',
          '<span class="p50-count" id="p50Count">1 / 3</span>',
        '</div>',

        /* ---------------- 第 1 步：老手 / 新手 ---------------- */
        '<div class="p50-step on" data-step="1">',
          '<div class="p50-hero">' + SVG.spark + '</div>',
          '<h2 class="p50-h">你之前用过 X Craft Launcher 吗？</h2>',
          '<p class="p50-p">用过就直接进去，没用过就带你走一遍。点一下选项就会继续，不用再按确认。</p>',
          '<div class="p50-opts" role="radiogroup" aria-label="使用经验">',
            '<button type="button" class="p50-opt" role="radio" aria-checked="false" data-vet="veteran">',
              '<span class="p50-opt-ico">' + SVG.sliders + '</span>',
              '<span class="p50-opt-m"><b>是，我是老手，自己来</b>' +
                '<span>跳过全部引导，直接进入主界面</span></span>',
              '<span class="p50-tick">' + SVG.check + '</span>',
            '</button>',
            '<button type="button" class="p50-opt" role="radio" aria-checked="false" data-vet="newbie">',
              '<span class="p50-opt-ico">' + SVG.play + '</span>',
              '<span class="p50-opt-m"><b>我是新手，看看怎么玩</b>' +
                '<span>回答两个小问题，再看几张功能介绍</span></span>',
              '<span class="p50-tick">' + SVG.check + '</span>',
            '</button>',
          '</div>',
          '<div class="p50-foot">',
            '<span class="p50-tip">每一步都能点右下角「跳过」</span>',
          '</div>',
        '</div>',

        /* ---------------- 第 2 步：使用方式 ---------------- */
        '<div class="p50-step" data-step="2">',
          '<h2 class="p50-h">你打算怎么用这个启动器？</h2>',
          '<p class="p50-p">选一个最接近的情况，之后的界面会按这个来安排；选错了也不要紧，随时能改。</p>',
          '<div class="p50-opts" role="radiogroup" aria-label="使用方式">',
            '<button type="button" class="p50-opt" role="radio" aria-checked="false" data-plan="simple">',
              '<span class="p50-opt-ico">' + SVG.play + '</span>',
              '<span class="p50-opt-m"><b>偶尔玩玩，能启动就行</b>' +
                '<span>只留最常用的设置，内存、参数这些交给启动器自动安排</span></span>',
              '<span class="p50-tick">' + SVG.check + '</span>',
            '</button>',
            '<button type="button" class="p50-opt" role="radio" aria-checked="false" data-plan="advanced">',
              '<span class="p50-opt-ico">' + SVG.sliders + '</span>',
              '<span class="p50-opt-m"><b>长期使用，想自己调参数</b>' +
                '<span>保留全部设置，并额外提供垃圾回收器、启动超时等可调项</span></span>',
              '<span class="p50-tick">' + SVG.check + '</span>',
            '</button>',
          '</div>',
          '<div class="p50-foot">',
            '<button type="button" class="p50-back" data-act="to1">返回</button>',
          '</div>',
        '</div>',

        /* ---------------- 第 3 步：Java 熟悉度 ---------------- */
        '<div class="p50-step" data-step="3">',
          '<h2 class="p50-h">你了解 Java 内存、JVM 参数这些吗？</h2>',
          '<p class="p50-p">按你的熟悉程度决定要不要显示这些选项，不确定就选第一个。</p>',
          '<div class="p50-opts" role="radiogroup" aria-label="Java 参数熟悉程度">',
            '<button type="button" class="p50-opt" role="radio" aria-checked="false" data-skill="auto">',
              '<span class="p50-opt-ico">' + SVG.wand + '</span>',
              '<span class="p50-opt-m"><b>完全不懂，帮我自动配好</b>' +
                '<span>按你的机器算一份推荐值，内存和优先级都不用你来定</span></span>',
              '<span class="p50-tick">' + SVG.check + '</span>',
            '</button>',
            '<button type="button" class="p50-opt" role="radio" aria-checked="false" data-skill="hint">',
              '<span class="p50-opt-ico">' + SVG.chart + '</span>',
              '<span class="p50-opt-m"><b>大概知道，想看看推荐值</b>' +
                '<span>保留全部选项，同时把推荐值标出来供你参考</span></span>',
              '<span class="p50-tick">' + SVG.check + '</span>',
            '</button>',
            '<button type="button" class="p50-opt" role="radio" aria-checked="false" data-skill="custom">',
              '<span class="p50-opt-ico">' + SVG.term + '</span>',
              '<span class="p50-opt-m"><b>很熟，我自己设</b>' +
                '<span>全部开放，不加任何提示，按你自己的习惯来</span></span>',
              '<span class="p50-tick">' + SVG.check + '</span>',
            '</button>',
          '</div>',
          '<div class="p50-foot">',
            '<button type="button" class="p50-back" data-act="to2">返回</button>',
          '</div>',
        '</div>',

        /* ---------------- 引导页（类似主流 App 的功能介绍） ---------------- */
        '<div class="p50-tour" id="p50Tour" hidden>',
          '<div class="p50-tour-body" id="p50TourBody"></div>',
          '<div class="p50-tour-foot">',
            '<span class="p50-dots" id="p50Dots" aria-hidden="true"></span>',
            '<span class="p50-tour-btns">',
              '<button type="button" class="p50-back" data-act="tourBack">上一步</button>',
              '<button type="button" class="p50-btn p50-primary" data-act="tourNext">下一步</button>',
            '</span>',
          '</div>',
        '</div>',

        '<button type="button" class="p50-skip" data-act="skip">跳过</button>',
      '</div>'
    ].join('\n');
  }

  function openWizard() {
    var old = doc.getElementById('p50Wizard');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    state = { step: 1, plan: '', skill: '' };

    var wrap = doc.createElement('div');
    wrap.id = 'p50Wizard';
    wrap.innerHTML = wizardHtml();
    doc.body.appendChild(wrap);
    doc.body.classList.add('p50-lock');

    bindWizard(wrap);
    gotoStep(1, true);
    /* .on 只是「已打开」的状态标记，不承担显示；动画走 .p50-step 的 keyframe，
       窗口被遮挡时即使动画不跑，卡片也是可见的（不会停在 opacity:0） */
    wrap.classList.add('on');
  }

  function closeWizard(instant) {
    var w = doc.getElementById('p50Wizard');
    doc.body.classList.remove('p50-lock');
    if (!w) return;
    w.classList.remove('on');
    w.classList.add('out');
    if (instant) {
      if (w.parentNode) w.parentNode.removeChild(w);
      return;
    }
    setTimeout(function () {
      if (w.parentNode) w.parentNode.removeChild(w);
    }, 220);
  }

  function gotoStep(n, silent) {
    state.step = n;
    var wrap = doc.getElementById('p50Wizard');
    if (!wrap) return;
    $$('.p50-step', wrap).forEach(function (s) {
      s.classList.toggle('on', Number(s.getAttribute('data-step')) === n);
    });
    var cnt = doc.getElementById('p50Count');
    if (cnt) cnt.textContent = n + ' / 3';
    if (!silent) {
      var active = $('.p50-step.on', wrap);
      var first = active ? ($('.p50-opt.on', active) || $('.p50-opt', active) || $('.p50-btn', active)) : null;
      if (first) { try { first.focus(); } catch (e) {} }
    } else {
      var start = $('.p50-btn', wrap);
      if (start) { try { start.focus(); } catch (e) {} }
    }
  }

  /* ---------------- 新手引导页（类似主流 App 的功能介绍） ---------------- */
  var TOUR = [
    {
      icon: 'play',
      title: '主页就是启动台',
      desc: '选好版本点「启动游戏」就行。右上角可以切换账号，左侧一列是各个功能页；' +
        '下载和安装的进度会显示在右下角，不会打断你干别的事。'
    },
    {
      icon: 'chart',
      title: '装版本、挑版本都在「安装」',
      desc: '正式版列表按版本号排列，点卡片看详情再下载。想尝鲜的话列表最上面有快照入口，' +
        '快照可能不稳定，我们会在下载前再提醒你备份存档。'
    },
    {
      icon: 'sliders',
      title: '性能设置里能压住卡顿',
      desc: '内存、最大 CPU、独显优先都归在「设置 → 性能设置」。那里的 Super X 多线程优化' +
        '是给老版本补多核能力的，默认关闭、可随时关掉，标注了测试阶段。'
    },
    {
      icon: 'wand',
      title: '外观能换成你自己的样子',
      desc: '主题、动效强度、自定义装扮都在「外观设置」。同一页还能选自己的图片或视频当背景，' +
        '文件只留在本机；第一次用会先给你看一段免责声明。'
    }
  ];
  var tourIdx = 0;

  function injectTourCss() {
    if (doc.getElementById('patch-50-tour-style')) return;
    var css = [
      '#p50Card .p50-tip{font-size:11.5px;color:var(--txt-3)}',
      '#p50Card .p50-tour{display:block}',
      '#p50Card .p50-tour[hidden]{display:none}',
      '.p50-tour-body{min-height:230px;display:flex;flex-direction:column;align-items:flex-start;gap:14px;padding:6px 2px 8px}',
      '.p50-tour-ico{width:64px;height:64px;border-radius:20px;display:grid;place-items:center;',
      '  background:linear-gradient(160deg,var(--accent-soft,rgba(120,200,160,.18)),transparent);border:1px solid var(--stroke)}',
      '.p50-tour-ico svg{width:30px;height:30px;color:var(--accent)}',
      '.p50-tour-body h3{margin:2px 0 0;font-size:17px;letter-spacing:-.01em}',
      '.p50-tour-body p{margin:0;font-size:12.5px;line-height:1.8;color:var(--txt-2)}',
      '.p50-tour-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}',
      '.p50-dots{display:inline-flex;align-items:center;gap:6px}',
      '.p50-dots i{width:7px;height:7px;border-radius:999px;background:var(--stroke);transition:width .2s ease,background .2s ease}',
      '.p50-dots i.on{width:18px;background:var(--accent)}',
      '.p50-tour-btns{display:inline-flex;gap:8px;align-items:center}',
      '.p50-tour-btns .p50-back[disabled]{opacity:.4;pointer-events:none}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-50-tour-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  function startTour() {
    var wrap = doc.getElementById('p50Wizard');
    if (!wrap) return;
    injectTourCss();
    tourIdx = 0;
    $$('.p50-step', wrap).forEach(function (x) { x.classList.remove('on'); });
    var tour = doc.getElementById('p50Tour');
    if (tour) tour.hidden = false;
    var cnt = doc.getElementById('p50Count');
    if (cnt) cnt.textContent = '新手引导';
    paintTour();
  }

  function paintTour() {
    var body = doc.getElementById('p50TourBody');
    var dots = doc.getElementById('p50Dots');
    var back = doc.querySelector('#p50Tour [data-act="tourBack"]');
    var next = doc.querySelector('#p50Tour [data-act="tourNext"]');
    if (!body) return;
    var it = TOUR[tourIdx] || TOUR[0];
    body.innerHTML =
      '<span class="p50-tour-ico">' + (SVG[it.icon] || SVG.spark) + '</span>' +
      '<h3>' + it.title + '</h3>' +
      '<p>' + it.desc + '</p>';
    if (dots) {
      dots.innerHTML = TOUR.map(function (_, i) {
        return '<i class="' + (i === tourIdx ? 'on' : '') + '"></i>';
      }).join('');
    }
    if (back) back.disabled = tourIdx === 0;
    if (next) next.textContent = tourIdx >= TOUR.length - 1 ? '开始使用' : '下一步';
  }

  function tourStep(delta) {
    var next = tourIdx + delta;
    if (next < 0) return;
    if (next >= TOUR.length) { finishWizard(); return; }
    tourIdx = next;
    paintTour();
  }

  function chooseVet(wrap, opt) {
    var vet = opt.getAttribute('data-vet');
    $$('.p50-opt', opt.parentNode).forEach(function (x) {
      var on = x === opt;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (vet === 'veteran') {
      /* 老手：直接落地，模式按「高级 + 自己设」，不弹推荐、不进引导页 */
      state.plan = 'advanced';
      state.skill = 'custom';
      setTimeout(function () { finishWizard(); }, 180);
      return;
    }
    setTimeout(function () { gotoStep(2); }, 180);
  }

  function bindWizard(wrap) {
    wrap.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var act = t.closest('[data-act]');
      if (act) {
        var a = act.getAttribute('data-act');
        if (a === 'to2') gotoStep(2);
        else if (a === 'to3') gotoStep(3);
        else if (a === 'to1') gotoStep(1);
        else if (a === 'done') finishWizard();
        else if (a === 'skip') skipWizard();
        else if (a === 'tourNext') tourStep(1);
        else if (a === 'tourBack') tourStep(-1);
        return;
      }

      var opt = t.closest('.p50-opt');
      if (!opt) return;

      /* 第 1 步：老手 / 新手 */
      if (opt.hasAttribute('data-vet')) { chooseVet(wrap, opt); return; }

      var group = opt.parentNode;
      var isPlan = opt.hasAttribute('data-plan');
      var kind = isPlan ? 'plan' : 'skill';
      $$('.p50-opt', group).forEach(function (x) {
        var on = x === opt;
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      state[kind] = opt.getAttribute(isPlan ? 'data-plan' : 'data-skill') || '';

      /* 点一下即进入下一道：留 170ms 让选中态被看见，再自动前进 */
      setTimeout(function () {
        if (isPlan) gotoStep(3);
        else startTour();
      }, 170);
    });

    /* 焦点陷阱：Tab 在卡内循环，别跑到遮罩后面去 */
    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var card = doc.getElementById('p50Card');
      if (!card) return;
      var list = $$('button:not(:disabled), [href], input, select, textarea', card).filter(function (el) {
        return el.offsetParent !== null || el === doc.activeElement;
      });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function resolveMode() {
    if (!state.plan) return savedMode() || 'advanced';
    if (state.plan === 'simple') return 'simple';
    /* 第 2 步选高级、第 3 步又说完全不懂 → 还是简单模式 */
    if (state.skill === 'auto') return 'simple';
    return 'advanced';
  }

  function finishWizard() {
    var mode = resolveMode();
    write(K_MODE, mode);
    write(K_DONE, '1');
    write(K_AT, String(Date.now()));
    applyMode(mode);

    var auto = state.skill === 'auto';
    var job = auto ? applyRecommend() : null;

    closeWizard(false);

    var note = function () {
      ipc('perf:launchNote', { wizardDoneAt: Date.now(), auto: mode === 'simple' });
    };
    if (job && typeof job.then === 'function') job.then(note, note);
    else note();
  }

  function skipWizard() {
    /* 跳过 = 保持现状：只记「问过了」，模式沿用已存的，没有就按高级 */
    var mode = savedMode() || 'advanced';
    write(K_MODE, mode);
    write(K_DONE, '1');
    write(K_AT, String(Date.now()));
    applyMode(mode);
    closeWizard(false);
    ipc('perf:launchNote', { wizardDoneAt: Date.now(), auto: mode === 'simple' });
  }

  /* 第 3 步「完全不懂」：拿一份推荐值写进 mc.limits / mc.mem，失败静默 */
  function applyRecommend() {
    return ipc('perf:info').then(function (res) {
      if (!res || !res.ok || !res.recommend) return null;
      var r = res.recommend;
      var memMB = Number(r.memoryMB);
      if (!memMB || isNaN(memMB) || memMB <= 0) return null;

      patchLimits({
        memoryMB: Math.round(memMB / 64) * 64,
        priority: r.priority || 'normal',
        affinityMask: r.affinityMask || null,
        gc: 'auto',
        memoryMode: 'auto',
        appliedAt: Date.now()
      });

      var gb = Math.max(1, Math.round(memMB / 1024));
      write(K_MEM, String(gb));
      highlightMem(gb);
      return res;
    });
  }

  /* 把「最大内存」高亮挪到最接近推荐值的档位，免得界面和 mc.mem 对不上 */
  function highlightMem(gb) {
    var seg = doc.getElementById('memSeg');
    if (!seg) return;
    var btns = $$('button[data-mem]', seg);
    if (!btns.length) return;
    var best = null, bestV = -1;
    btns.forEach(function (b) {
      var v = Number(b.getAttribute('data-mem')) || 0;
      if (v > 0 && v <= gb && v > bestV) { best = b; bestV = v; }
    });
    if (!best) best = btns[0];
    btns.forEach(function (b) { b.classList.toggle('on', b === best); });
  }

  /* ================================================================
   *  首次启动判断
   * ================================================================ */
  function scheduleOnboard() {
    var navStart = (window.performance && window.performance.now) ? window.performance.now() : 0;
    setTimeout(function () {
      try {
        if (read(K_DONE) === '1') return;
        if (doc.readyState === 'loading' || !doc.body) return;
        /* 页面 1.2s 之后还没把壳子搭好，就别和启动动画抢，本次不弹 */
        var spent = (window.performance && window.performance.now) ? window.performance.now() - navStart : 0;
        if (spent > 1200 && doc.readyState !== 'complete') return;
        if (!doc.querySelector('.app') && !doc.getElementById('page-settings')) return;
        openWizard();
      } catch (e) { console.warn('[patch 50]', e); }
    }, 800);
  }

  function bindGlobal() {
    doc.addEventListener('keydown', function (e) {
      if (!doc.getElementById('p50Wizard')) return;
      if (e.key === 'Escape') { e.preventDefault(); skipWizard(); }
    });
  }

  /* ================================================================
   *  入口
   * ================================================================ */
  function init() {
    try {
      if (doc.getElementById('p50Wizard') && doc.getElementById('patch-50-style')) return;

      injectCss();

      var saved = savedMode();
      if (saved) applyMode(saved);
      else markSimpleTargets();

      ensureExtras();
      injectRerun();
      /* patch 30 / 40 可能在更晚的时机建卡片，几次重试把补的行补上（都有幂等守卫） */
      [300, 900, 1800, 3200].forEach(function (t) {
        setTimeout(function () {
          try { ensureExtras(); injectRerun(); } catch (e) { console.warn('[patch 50]', e); }
        }, t);
      });

      bindGlobal();
      scheduleOnboard();
    } catch (e) {
      console.warn('[patch 50]', e);
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();

console.log('[patch 50] ready');
