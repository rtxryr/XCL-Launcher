'use strict';
/**
 * 自动更新链路自测（不入包）。
 *
 * 做法：起 mock 更新服务 → 用 XCL_UPDATE_FEED / XCL_INSTALL_DIR 把启动器指向
 * mock 与临时安装目录 → 用 CDP 在渲染进程里调 window.FMBridge.invoke 跑完整链路。
 *
 *   node scripts/test-update.cjs
 *
 * 覆盖：app:info / 资源门控 skipped / 检查更新 available / dismiss / 校验失败 error /
 *      取消下载 / 完整下载+校验+解压替换 ready / 不删除安装目录其它文件与 Game。
 * 全程不触碰真实安装目录。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const mock = require('./mock-update-server.cjs');

const ROOT = path.join(__dirname, '..');
// 端口可被环境变量覆盖，避免与其它同时运行的 mock / 调试实例抢端口
const PORT = Number(process.env.XCL_TEST_PORT) || 3987;
const CDP_PORT = Number(process.env.XCL_TEST_CDP) || 9240;
const TEST_ROOT = path.join(os.tmpdir(), 'xcl-upd-test');
const INSTALL = path.join(TEST_ROOT, 'install');
const PREFS = path.join(os.homedir(), '.fusionmc', 'update-state.json');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 临时安装目录 / 假文件
// ---------------------------------------------------------------------------
function seedInstall() {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(INSTALL, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(INSTALL, 'Game', 'saves', 'world'), { recursive: true });
  fs.writeFileSync(path.join(INSTALL, 'X Craft Launcher.exe'), 'OLD EXE v1.0.0\n');
  fs.writeFileSync(path.join(INSTALL, 'resources', 'app.txt'), 'v1.0.0 app payload\n');
  fs.writeFileSync(path.join(INSTALL, 'resources', 'old-only.txt'), '只有旧版本才有的文件\n');
  fs.writeFileSync(path.join(INSTALL, 'keepme.txt'), '安装目录根部的用户文件\n');
  fs.writeFileSync(path.join(INSTALL, 'Game', 'saves', 'world', 'level.dat'), '存档不能被删\n');
  fs.writeFileSync(path.join(INSTALL, 'Game', 'options.txt'), 'fov:70\n');
}

// ---------------------------------------------------------------------------
// CDP 客户端
// ---------------------------------------------------------------------------
async function connectCdp() {
  let wsUrl = null;
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
      const page = list.find((t) => t.type === 'page' && /^file:/i.test(t.url || ''));
      if (page) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  if (!wsUrl) throw new Error('CDP 未就绪（页面目标没出现）');

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const waiters = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) {
      waiters.get(m.id)(m);
      waiters.delete(m.id);
    }
  });
  const send = (method, params) =>
    new Promise((res) => {
      const i = ++id;
      waiters.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('页面内异常：' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    }
    return r.result && r.result.result ? r.result.result.value : null;
  };

  return { ws, send, evaluate };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
(async () => {
  const prefsExisted = fs.existsSync(PREFS);
  let electron = null;
  let handle = null;
  let cdp = null;

  try {
    seedInstall();

    handle = await mock.start({ port: PORT });
    check('mock 服务启动（3987）', true, { sha256: handle.sha256.slice(0, 12), size: handle.size });

    // 启动 Electron：指向 mock + 临时安装目录；测试模式不重启应用
    const env = Object.assign({}, process.env, {
      XCL_UPDATE_FEED: 'http://127.0.0.1:' + PORT,
      XCL_INSTALL_DIR: INSTALL,
      XCL_UPDATE_TEST_MODE: '1',
      XCL_UPDATE_AUTOCHECK: '0',
      // 阈值调到 1TB：让非强制检查必然触发资源门控（skipped）
      XCL_UPDATE_MIN_MEM_MB: '1000000',
    });
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;

    const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    electron = spawn(exe, ['.', '--remote-debugging-port=' + CDP_PORT], {
      cwd: ROOT,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });

    cdp = await connectCdp();
    const ev = cdp.evaluate;

    // 等页面里的桥就绪
    for (let i = 0; i < 120; i++) {
      if (await ev('!!(window.FMBridge && window.FMBridge.available)')) break;
      await sleep(250);
    }
    check('页面与 FMBridge 就绪', await ev('!!(window.FMBridge && window.FMBridge.available)'));
    await ev('(function(){window.__upd=[];window.FMBridge.on("update:status",function(s){window.__upd.push(s)});return 1})()');

    const invoke = (ch, payload) =>
      ev('window.FMBridge.invoke(' + JSON.stringify(ch) + ',' + JSON.stringify(payload || {}) + ')');
    const events = () => ev('window.__upd');
    const clearEvents = () => ev('(function(){window.__upd=[];return 1})()');
    const waitFor = async (stateName, timeoutMs) => {
      const t0 = Date.now();
      while (Date.now() - t0 < (timeoutMs || 60000)) {
        const s = await invoke('update:state');
        if (s && s.ok && s.data && s.data.state === stateName) return s.data;
        await sleep(200);
      }
      const last = await invoke('update:state');
      throw new Error('等待状态 ' + stateName + ' 超时，当前=' + JSON.stringify(last && last.data));
    };

    // ---- 1. app:info ----
    const info = await invoke('app:info');
    check(
      'app:info 字段完整',
      info.ok &&
        info.data.appVersion === '1.0.0' &&
        !!info.data.electron &&
        !!info.data.chrome &&
        !!info.data.node &&
        /Windows/.test(info.data.os) &&
        path.resolve(info.data.installDir) === path.resolve(INSTALL) &&
        info.data.isPackaged === false,
      info.data,
    );

    // ---- 2. 资源门控：非强制检查应 skipped 且不发请求 ----
    await fetch('http://127.0.0.1:' + PORT + '/__control?reset=1');
    const gate = await invoke('update:check', {});
    const reqsAfterGate = await (await fetch('http://127.0.0.1:' + PORT + '/__requests')).json();
    check(
      '资源不足 → skipped 且未发请求',
      gate.ok && gate.data.state === 'skipped' && reqsAfterGate.length === 0 && /跳过/.test(gate.data.message),
      { state: gate.data.state, message: gate.data.message, requests: reqsAfterGate.length },
    );

    // ---- 3. 强制检查 → available ----
    const avail = await invoke('update:check', { force: true });
    check(
      'update:check(force) → available',
      avail.ok &&
        avail.data.state === 'available' &&
        avail.data.latestVersion === '1.2.0' &&
        avail.data.currentVersion === '1.0.0' &&
        avail.data.sha256 === handle.sha256 &&
        avail.data.size === handle.size,
      { state: avail.data.state, latest: avail.data.latestVersion, size: avail.data.size },
    );

    // ---- 4. dismiss ----
    const dis = await invoke('update:dismiss', { version: '1.2.0' });
    check(
      'update:dismiss → dismissed 且写入忽略列表',
      dis.ok && dis.data.state === 'dismissed' && fs.existsSync(PREFS) && fs.readFileSync(PREFS, 'utf8').indexOf('1.2.0') >= 0,
      { state: dis.data.state },
    );
    const again = await invoke('update:check', { force: true });
    check('强制检查忽略 dismiss，仍提示可用', again.ok && again.data.state === 'available', again.data.state);

    // ---- 5. 校验和不匹配 → error ----
    await fetch('http://127.0.0.1:' + PORT + '/__control?badSha=1');
    await clearEvents();
    const r5 = await invoke('update:check', { force: true });
    check('错误 sha256 的检查仍返回 available（含错误校验值）', r5.data.state === 'available');
    await invoke('update:apply');
    const errState = await waitFor('error', 60000);
    const errEvents = await events();
    check(
      '校验和不匹配 → error，并已删除临时包',
      /校验失败/.test(errState.message) &&
        !fs.existsSync(path.join(os.tmpdir(), 'xcl-update', '1.2.0.zip')),
      { message: errState.message, seq: errEvents.map((e) => e.state) },
    );

    // ---- 6. update:cancel 中断下载 ----
    await fetch('http://127.0.0.1:' + PORT + '/__control?badSha=0&slow=1');
    await invoke('update:check', { force: true });
    await clearEvents();
    await invoke('update:apply');
    // 等到出现至少 3 条下载进度事件
    let dlSeen = 0;
    for (let i = 0; i < 100; i++) {
      const list = await events();
      dlSeen = list.filter((e) => e.state === 'downloading' && e.progress && e.progress.received > 0).length;
      if (dlSeen >= 3) break;
      await sleep(150);
    }
    const cancelRes = await invoke('update:cancel');
    await sleep(800);
    const afterCancel = await invoke('update:state');
    const zipAfterCancel = fs.existsSync(path.join(os.tmpdir(), 'xcl-update', '1.2.0.zip'));
    check(
      'update:cancel 中断下载、清理临时文件并回落 available',
      dlSeen >= 3 &&
        cancelRes.ok &&
        afterCancel.data.state === 'available' &&
        afterCancel.data.latestVersion === '1.2.0' &&
        !!afterCancel.data.sha256 &&
        afterCancel.data.progress === null &&
        !zipAfterCancel,
      {
        downloadingEvents: dlSeen,
        state: afterCancel.data.state,
        latestVersion: afterCancel.data.latestVersion,
        progress: afterCancel.data.progress,
        zipLeft: zipAfterCancel,
      },
    );
    // 取消后必须能直接重新开始（不要求先重新检查），再取消一次收尾
    const retry = await invoke('update:apply');
    await sleep(400);
    await invoke('update:cancel');
    await sleep(300);
    check(
      '取消后可直接重新开始下载（可重入，无需重新检查）',
      retry.ok && retry.data.state === 'downloading',
      { state: retry.data && retry.data.state },
    );

    // ---- 7. 完整链路：available → downloading → verifying → ready ----
    await fetch('http://127.0.0.1:' + PORT + '/__control?slow=0');
    await invoke('update:check', { force: true });
    await clearEvents();
    const t0 = Date.now();
    await invoke('update:apply');
    const readyState = await waitFor('ready', 90000);
    const cost = Date.now() - t0;
    const seq = (await events()).map((e) => e.state);
    const downloadingCount = seq.filter((x) => x === 'downloading').length;
    const progressList = (await events())
      .filter((e) => e.state === 'downloading' && e.progress)
      .map((e) => e.progress.received);
    const increasing = progressList.every((v, i) => i === 0 || v >= progressList[i - 1]) && progressList.length > 0;
    check(
      '完整链路事件序列 downloading(≥3)→verifying→ready',
      downloadingCount >= 3 &&
        seq.indexOf('downloading') < seq.indexOf('verifying') &&
        seq.indexOf('verifying') < seq.indexOf('ready') &&
        increasing,
      { seq, downloadingCount, progress: progressList, costMs: cost },
    );
    check(
      'ready 状态字段完整（含 size/notes 透传）',
      readyState.state === 'ready' && readyState.latestVersion === '1.2.0' && !!readyState.notes,
      { state: readyState.state, latestVersion: readyState.latestVersion },
    );

    // ---- 8. 替换结果与数据保护 ----
    const exeTxt = fs.readFileSync(path.join(INSTALL, 'X Craft Launcher.exe'), 'utf8');
    const appTxt = fs.readFileSync(path.join(INSTALL, 'resources', 'app.txt'), 'utf8');
    const gameKeep = fs.readFileSync(path.join(INSTALL, 'Game', 'saves', 'world', 'level.dat'), 'utf8');
    check(
      '程序文件已覆盖为新版',
      /v1\.2\.0/.test(exeTxt) && /v1\.2\.0/.test(appTxt) &&
        fs.existsSync(path.join(INSTALL, 'resources', 'new-in-120.txt')),
      { exe: exeTxt.trim(), app: appTxt.trim() },
    );
    check(
      '安装目录其它文件与 Game 存档未被删除',
      fs.existsSync(path.join(INSTALL, 'keepme.txt')) &&
        fs.existsSync(path.join(INSTALL, 'resources', 'old-only.txt')) &&
        /存档不能被删/.test(gameKeep) &&
        fs.existsSync(path.join(INSTALL, 'Game', 'options.txt')),
      { keepme: fs.existsSync(path.join(INSTALL, 'keepme.txt')), game: /存档不能被删/.test(gameKeep) },
    );
    check('临时包已删除', !fs.existsSync(path.join(os.tmpdir(), 'xcl-update', '1.2.0.zip')));

    // ---- 8b. 真实发布 zip 结构：所有条目在单一顶层目录 X Craft Launcher/ 下 ----
    // 这是线上 zip 的真实形态，必须剥掉顶层目录再覆盖，否则会解到 <安装目录>\X Craft Launcher\
    await fetch('http://127.0.0.1:' + PORT + '/__control?nested=1');
    const nestedCfg = await (await fetch('http://127.0.0.1:' + PORT + '/__config')).json();
    const chk2 = await invoke('update:check', { force: true });
    check(
      'nested 包：check 返回新的 size/sha256',
      chk2.data.state === 'available' &&
        chk2.data.size === nestedCfg.size &&
        chk2.data.sha256 === nestedCfg.sha256,
      { size: chk2.data.size, expected: nestedCfg.size },
    );
    await invoke('update:apply');
    await waitFor('ready', 90000);
    const exeNested = fs.readFileSync(path.join(INSTALL, 'X Craft Launcher.exe'), 'utf8');
    const gameAfterNested = fs.readFileSync(path.join(INSTALL, 'Game', 'saves', 'world', 'level.dat'), 'utf8');
    check(
      'nested 包：剥掉顶层目录后覆盖到安装根目录（不产生嵌套子目录）',
      /NESTED/.test(exeNested) &&
        !fs.existsSync(path.join(INSTALL, 'X Craft Launcher')) &&
        fs.existsSync(path.join(INSTALL, 'resources', 'version.txt')),
      { exe: exeNested.trim().slice(0, 40), nestedDirExists: fs.existsSync(path.join(INSTALL, 'X Craft Launcher')) },
    );
    check(
      'nested 包：resources 未被摊平到安装根目录',
      !fs.existsSync(path.join(INSTALL, 'app.txt')) &&
        !fs.existsSync(path.join(INSTALL, 'version.txt')) &&
        !fs.existsSync(path.join(INSTALL, 'assets.bin')),
      {
        rootAppTxt: fs.existsSync(path.join(INSTALL, 'app.txt')),
        rootVersionTxt: fs.existsSync(path.join(INSTALL, 'version.txt')),
      },
    );
    check(
      'nested 包：Game 存档与安装目录其它文件仍保留',
      /存档不能被删/.test(gameAfterNested) &&
        fs.existsSync(path.join(INSTALL, 'keepme.txt')) &&
        fs.existsSync(path.join(INSTALL, 'resources', 'old-only.txt')),
      { game: /存档不能被删/.test(gameAfterNested) },
    );

    // ---- 9. 未知通道兜底 ----
    const unknown = await invoke('update:nope', {});
    check('未知 update 通道返回结构化错误', unknown.ok === false && /未知更新通道/.test(unknown.error), unknown);

    const passed = results.filter((r) => r.ok).length;
    console.log('\n===== 汇总 ' + passed + '/' + results.length + ' 通过 =====');
    if (passed !== results.length) process.exitCode = 1;
  } catch (e) {
    console.error('自测异常：', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    try {
      if (cdp) cdp.ws.close();
    } catch {
      /* 忽略 */
    }
    if (electron && electron.pid) {
      try {
        spawn('taskkill', ['/pid', String(electron.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } catch {
        /* 忽略 */
      }
    }
    await sleep(1200);
    if (handle) await handle.close();
    // 只清理本次测试创建的忽略列表，别动用户手写的
    if (!prefsExisted) {
      try {
        if (fs.existsSync(PREFS)) fs.unlinkSync(PREFS);
      } catch {
        /* 忽略 */
      }
    }
    try {
      fs.rmSync(path.join(os.tmpdir(), 'xcl-update'), { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
    console.log('\n临时目录保留在 ' + TEST_ROOT + '（可手动删除）');
  }
})();
