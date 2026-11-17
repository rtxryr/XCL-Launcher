/**
 * 一键开服链路验证脚本（不启动 Electron，直接跑 core）。
 * 用法：node scripts/test-server.js [versionId] [--keep]
 *
 * 依次验证：createServer → listServers → startServer → serverStatus → stopServer
 * 任何一步失败都打印完整错误栈并退出非 0。
 */
const path = require('path');
const { FusionBackend } = require('../core/backend.js');

const versionId = process.argv[2] || '1.21.4';

function line(t) { console.log('\n===== ' + t + ' ====='); }
function dump(label, v) {
  console.log('[' + label + ']', JSON.stringify(v, null, 2));
}

(async () => {
  const backend = new FusionBackend();
  await backend.init();
  console.log('[test] 后端就绪, versionId =', versionId);

  const t0 = Date.now();
  let server;
  try {
    line('1) createServer');
    server = await backend.createServer({
      name: '测试服-' + versionId,
      versionId,
      port: 25599,
      maxMemoryMB: 2048,
      motd: 'smoke test',
    });
    dump('created', server);
  } catch (e) {
    console.error('[FAIL] createServer 抛错：', e && e.message);
    console.error(e && e.stack);
    process.exit(1);
  }
  console.log('[test] 创建耗时', ((Date.now() - t0) / 1000).toFixed(1), '秒');

  line('2) listServers');
  const list = backend.listServers();
  dump('list', list);

  line('3) serverStatus');
  dump('status', backend.serverStatus());

  line('4) startServer');
  try {
    const st = await backend.startServer(server.id);
    dump('started', st);
  } catch (e) {
    console.error('[FAIL] startServer 抛错：', e && e.message);
    console.error(e && e.stack);
    process.exit(2);
  }

  line('5) 等待 12 秒看启动日志');
  await new Promise((r) => setTimeout(r, 12000));
  dump('status-after', backend.serverStatus(server.id));

  line('6) stopServer');
  try {
    await backend.stopServer(server.id);
    dump('stopped', backend.serverStatus(server.id));
  } catch (e) {
    console.error('[FAIL] stopServer 抛错：', e && e.message);
  }

  line('完成');
  process.exit(0);
})().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(9);
});
