/* ------------------------------------------------------------------
 * patch/220-custom-bg.js — 外观设置：启动器自定义背景（图片 / 视频）
 *
 * 组成：
 *   1) 外观设置顶部插入「启动器背景」卡（预览 + 选择图片 / 选择视频 / 恢复默认）
 *   2) 首次点击任一选择按钮 → 先弹免责声明，同意后才打开文件选择器
 *   3) 选中后由主进程把文件复制到 userData/background/，渲染层用 file:// 引用
 *   4) .bg 里插入独立图层，图片 object-fit:cover，视频静音循环播放；
 *      轻量模式 / 关闭界面动效 / 系统减弱动效时只显示首帧，不持续解码
 *
 * 作用域：只往 #tab-appearance 里插一张卡、往 .bg 里插一个图层，不动其它结构。
 * ------------------------------------------------------------------ */
(function () {
  'use strict';
  var doc = document;
  var LS_ACK = 'mc.bgDisclaimerAck';
  var LS_KIND = 'mc.bgKind';
  var LS_NAME = 'mc.bgName';
  var LAYER_ID = 'm220BgLayer';

  function $(s, r) { return (r || doc).querySelector(s); }
  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function bridge(ch, p) {
    if (!window.FMBridge || typeof window.FMBridge.invoke !== 'function' || window.FMBridge.available === false) return Promise.resolve(null);
    return window.FMBridge.invoke(ch, p || {}).catch(function () { return null; });
  }
  function toast(msg) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
    var t = doc.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:9999;padding:10px 18px;border-radius:999px;' +
      'background:var(--panel-2,#222);color:var(--txt,#fff);border:1px solid var(--stroke,#444);font-size:12.5px';
    doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }
  function fileUrl(p) {
    var s = String(p || '').replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(s)) return 'file:///' + encodeURI(s);
    return 'file://' + encodeURI(s);
  }

  /* ---------------- 样式 ---------------- */
  function injectCss() {
    if (doc.getElementById('patch-220-style')) return;
    var css = [
      /* 自定义背景图层：压在壁纸之上、网格光斑之下，保留原有层次感 */
      '#m220BgLayer{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1}',
      '#m220BgLayer img,#m220BgLayer video{width:100%;height:100%;object-fit:cover;display:block}',
      '#m220BgLayer video{pointer-events:none}',
      'html[data-bg="custom"] .bg-wall{opacity:0}',
      'html[data-bg="custom"] .bg-pattern{opacity:calc(var(--grid-o) * .5)}',

      /* 壁纸卡里的自定义块 */
      '.m220-sec{padding:2px 16px 6px}',
      '.m220-sec-t{display:flex;align-items:center;gap:8px;margin:6px 0 10px;font-size:12px;font-weight:600;color:var(--txt-2)}',
      '.m220-sec-t::after{content:"";flex:1;height:1px;background:var(--stroke)}',
      '.m220-preview{position:relative;margin:0 0 10px;border-radius:16px;overflow:hidden;height:170px;',
      '  background:var(--panel-3,rgba(255,255,255,.05));border:1px dashed var(--stroke);display:grid;place-items:center}',
      '.m220-preview[hidden]{display:none}',
      '.m220-preview img,.m220-preview video{width:100%;height:100%;object-fit:cover;display:block}',
      '.m220-preview .m220-empty{display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--txt-3);font-size:11.5px}',
      '.m220-preview .m220-empty svg{width:26px;height:26px;opacity:.7}',
      '.m220-preview .m220-tag{position:absolute;left:10px;top:10px;padding:2px 9px;border-radius:999px;font-size:10.5px;',
      '  color:#fff;background:rgba(0,0,0,.5);backdrop-filter:blur(6px)}',
      '.m220-btns{display:flex;flex-wrap:wrap;gap:8px;padding:0 0 10px}',
      '.m220-btns button{border-radius:999px;padding:7px 15px;font-size:12px;cursor:pointer;',
      '  border:1px solid var(--stroke);background:var(--panel-2);color:var(--txt);transition:transform .16s ease,background .16s ease}',
      '.m220-btns button:hover{transform:translateY(-1px)}',
      '.m220-btns button.m220-primary{background:var(--accent);border-color:transparent;color:var(--on-accent,#08120e)}',
      '.m220-btns button[disabled]{opacity:.45;pointer-events:none}',
      '.m220-note{padding:0 0 8px;font-size:11.5px;line-height:1.6;color:var(--txt-3)}',

      /* 免责声明弹窗 */
      '#m220Modal{position:fixed;inset:0;z-index:950;display:grid;place-items:center;padding:24px;',
      '  background:rgba(6,12,10,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
      '#m220Modal[hidden]{display:none}',
      '#m220Card{width:min(520px,100%);border-radius:22px;padding:24px 26px 20px;color:var(--txt);',
      '  background:linear-gradient(165deg,var(--glass-a),var(--glass-b)),var(--panel-2);',
      '  border:1px solid var(--stroke);box-shadow:0 40px 90px -40px var(--shadow-2)}',
      '#m220Card h3{margin:0 0 10px;font-size:16px;letter-spacing:-.01em}',
      '#m220Card p{margin:0 0 10px;font-size:12.5px;line-height:1.75;color:var(--txt-2)}',
      '#m220Card .m220-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}',
      '#m220Card button{border-radius:999px;padding:8px 18px;font-size:12.5px;cursor:pointer;border:1px solid var(--stroke);',
      '  background:var(--panel-2);color:var(--txt)}',
      '#m220Card button.m220-primary{background:var(--accent);border-color:transparent;color:var(--on-accent,#08120e);font-weight:600}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'patch-220-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  /* ---------------- 免责声明 ---------------- */
  function showDisclaimer(onAgree) {
    var modal = doc.getElementById('m220Modal');
    if (!modal) {
      modal = doc.createElement('div');
      modal.id = 'm220Modal';
      modal.innerHTML =
        '<div id="m220Card" role="dialog" aria-modal="true" aria-label="背景功能免责声明">' +
          '<h3>关于自定义背景的说明</h3>' +
          '<p>本启动器不提供任何图片和视频资源，仅承担展示与循环播放的功能。</p>' +
          '<p>启动器不具备自动修改或自动编辑图片、视频的能力，也不会对所展示的内容作任何保证。</p>' +
          '<p>你选择的图片或视频只会保存在本机，用于启动器背景显示，不会被上传。</p>' +
          '<div class="m220-foot">' +
            '<button type="button" data-act="cancel">取消</button>' +
            '<button type="button" class="m220-primary" data-act="ok">我已了解，继续</button>' +
          '</div>' +
        '</div>';
      doc.body.appendChild(modal);
    }
    modal.hidden = false;
    var close = function () { modal.hidden = true; };
    modal.onclick = function (e) {
      if (e.target === modal) return close();
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'ok') {
        set(LS_ACK, '1');
        close();
        if (typeof onAgree === 'function') onAgree();
      } else close();
    };
  }

  function requireAck(fn) {
    if (get(LS_ACK, '') === '1') return fn();
    showDisclaimer(fn);
  }

  /* ---------------- 背景图层 ---------------- */
  function bgHost() { return $('.bg'); }

  function removeLayer() {
    var l = doc.getElementById(LAYER_ID);
    if (l) l.remove();
    doc.documentElement.removeAttribute('data-bg');
  }

  function canPlay() {
    if (doc.documentElement.getAttribute('data-motion') === 'off') return false;
    if (doc.documentElement.getAttribute('data-perf') === 'lite') return false;
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) {}
    return true;
  }

  function applyItem(item) {
    var host = bgHost();
    if (!host || !item || !item.path) return;
    removeLayer();
    var layer = doc.createElement('div');
    layer.id = LAYER_ID;
    if (item.kind === 'video') {
      var v = doc.createElement('video');
      v.src = fileUrl(item.path);
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.setAttribute('disablespictureinpicture', 'true');
      v.addEventListener('error', function () {
        toast('背景视频加载失败，已恢复默认背景');
        clearBg(true);
      });
      layer.appendChild(v);
      if (!canPlay()) {
        v.autoplay = false;
        v.addEventListener('loadeddata', function () { try { v.pause(); } catch (e) {} }, { once: true });
      } else {
        var p = v.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } else {
      var img = doc.createElement('img');
      img.src = fileUrl(item.path);
      img.alt = '';
      img.draggable = false;
      img.addEventListener('error', function () {
        toast('背景图片加载失败，已恢复默认背景');
        clearBg(true);
      });
      layer.appendChild(img);
    }
    /* 插在 .bg-wall 之后：壁纸在底层，网格与光斑还在上面 */
    var wall = host.querySelector('.bg-wall');
    if (wall && wall.nextSibling) host.insertBefore(layer, wall.nextSibling);
    else host.appendChild(layer);
    doc.documentElement.setAttribute('data-bg', 'custom');
    set(LS_KIND, item.kind || '');
    set(LS_NAME, item.name || '');
  }

  function paintPreview(item) {
    var box = doc.getElementById('m220Preview');
    if (!box) return;
    /* 没选背景时整块预览不占位：只留两行按钮，避免出现一个空的大白框 */
    if (!item || !item.path) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.className = 'm220-preview';
    var tag = '<span class="m220-tag">' + (item.kind === 'video' ? '视频' : '图片') + '</span>';
    if (item.kind === 'video') {
      box.innerHTML = tag + '<video src="' + fileUrl(item.path) + '" muted loop playsinline autoplay preload="metadata"></video>';
      var v = box.querySelector('video');
      if (v) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
    } else {
      box.innerHTML = tag + '<img src="' + fileUrl(item.path) + '" alt="背景预览">';
    }
  }

  /* ---------------- 设置卡 ---------------- */
  /* 内置壁纸与自定义背景互斥：选内置壁纸就清掉自定义，选自定义就把壁纸设为「无壁纸」 */
  function setWallpaperNone() {
    doc.documentElement.setAttribute('data-wallpaper', 'none');
    try { localStorage.setItem('mc.wallpaper', 'none'); } catch (e) {}
    var cards = doc.querySelectorAll('#wpGrid .wp-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('on', cards[i].getAttribute('data-wp') === 'none');
    }
  }

  function wallpaperCard() {
    var titles = doc.querySelectorAll('#tab-appearance .group-title');
    for (var i = 0; i < titles.length; i++) {
      if (/生物群系壁纸|壁纸/.test(titles[i].textContent || '')) return titles[i].closest('.list-card');
    }
    return null;
  }

  function buildCard(tab) {
    if (!tab || doc.getElementById('m220CardWrap')) return;

    var host = wallpaperCard();
    var card;
    if (host) {
      /* 并进「壁纸」这一栏：标题统一叫壁纸，自定义背景作为其中一段 */
      var t = host.querySelector('.group-title');
      if (t) t.textContent = '壁纸';
      card = doc.createElement('div');
      card.className = 'm220-sec';
      card.id = 'm220CardWrap';
      card.innerHTML =
        '<div class="m220-sec-t">自定义背景</div>' +
        '<div class="m220-preview empty" id="m220Preview"></div>' +
        '<div class="m220-btns">' +
          '<button type="button" class="m220-primary" id="m220PickImg">选择图片</button>' +
          '<button type="button" id="m220PickVid">选择视频</button>' +
          '<button type="button" id="m220Clear">恢复默认</button>' +
        '</div>' +
        '<div class="m220-note">支持 PNG / JPG / WebP / GIF 与 MP4 / WebM，视频静音循环。文件只保存在本机；' +
          '开启轻量模式或关闭界面动效时，视频只显示首帧，不持续解码。选了自定义背景会自动把内置壁纸设为「无壁纸」。</div>';
      var hint = host.querySelector('.wp-hint');
      if (hint && hint.parentNode === host) host.insertBefore(card, hint);
      else host.appendChild(card);
    } else {
      /* 兜底：找不到壁纸卡就自己建一张（老版本结构变化时不至于丢功能） */
      card = doc.createElement('div');
      card.className = 'glass list-card';
      card.id = 'm220CardWrap';
      card.style.marginBottom = '16px';
      card.innerHTML =
        '<div class="group-title">壁纸</div>' +
        '<div class="m220-sec"><div class="m220-sec-t">自定义背景</div>' +
        '<div class="m220-preview empty" id="m220Preview"></div>' +
        '<div class="m220-btns">' +
          '<button type="button" class="m220-primary" id="m220PickImg">选择图片</button>' +
          '<button type="button" id="m220PickVid">选择视频</button>' +
          '<button type="button" id="m220Clear">恢复默认</button>' +
        '</div></div>';
      tab.insertBefore(card, tab.firstChild);
    }

    var pickImg = doc.getElementById('m220PickImg');
    var pickVid = doc.getElementById('m220PickVid');
    var clearBtn = doc.getElementById('m220Clear');

    function pick(kind) {
      requireAck(function () {
        bridge('bg:choose', { kind: kind }).then(function (r) {
          if (!r) { toast('桌面端才能选择本地文件'); return; }
          if (r.ok && r.data && r.data.canceled) return;
          if (!r.ok) { toast('设置失败：' + (r.error || '未知错误')); return; }
          var item = r.data && r.data.item;
          if (!item) return;
          applyItem(item);
          paintPreview(item);
          setWallpaperNone();
          toast(kind === 'video' ? '背景视频已设置' : '背景图片已设置');
        });
      });
    }

    pickImg.addEventListener('click', function () { pick('image'); });
    pickVid.addEventListener('click', function () { pick('video'); });
    clearBtn.addEventListener('click', function () { clearBg(false); });

    /* 用户切内置壁纸 → 清掉自定义背景，避免两层叠在一起 */
    var grid = doc.getElementById('wpGrid');
    if (grid && !grid.__m220Bound) {
      grid.__m220Bound = true;
      grid.addEventListener('click', function (e) {
        var b = e.target.closest('.wp-card');
        if (!b) return;
        var v = b.getAttribute('data-wp');
        if (!v || v === 'none') return;
        if (doc.getElementById(LAYER_ID)) {
          removeLayer();
          del(LS_KIND); del(LS_NAME);
          paintPreview(null);
          bridge('bg:clear', {});
        }
      });
    }

    refreshCurrent();
  }

  function clearBg(silent) {
    removeLayer();
    del(LS_KIND);
    del(LS_NAME);
    paintPreview(null);
    if (!silent) {
      bridge('bg:clear', {}).then(function () {
        toast('已恢复默认背景');
      });
    } else {
      bridge('bg:clear', {});
    }
  }

  function refreshCurrent() {
    bridge('bg:current', {}).then(function (r) {
      var item = r && r.ok && r.data ? r.data.item : null;
      if (!item) { paintPreview(null); return; }
      applyItem(item);
      paintPreview(item);
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var tab = doc.getElementById('tab-appearance');
    if (!tab || !$('#page-settings')) return;
    injectCss();
    if (!window.__xclPatch220) {
      window.__xclPatch220 = true;
      buildCard(tab);
      if (!doc.getElementById('m220CardWrap')) return;
    } else if (!doc.getElementById('m220CardWrap')) {
      buildCard(tab);
    }
    /* 主题/轻量模式变化后重新判断视频是否该播 */
    if (!boot._bound) {
      boot._bound = true;
      var recheck = function () {
        var layer = doc.getElementById('m220BgLayer');
        if (!layer) return;
        var v = layer.querySelector('video');
        if (!v) return;
        if (canPlay()) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else { try { v.pause(); } catch (e) {} }
      };
      document.addEventListener('m95:motion', recheck);
      window.addEventListener('m200:theme', recheck);
      var mo = new MutationObserver(recheck);
      mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-perf', 'data-theme'] });
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 500);
  setTimeout(boot, 1500);
})();
