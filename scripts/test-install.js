/**
 * 安装链路验证脚本（不启动 Electron，直接跑 core）。
 * 用法：node scripts/test-install.js <versionId> [--with-assets]
 */
const path = require('path');
const { FusionBackend } = require('../core/backend.js');
const { GameInstaller } = require('../core/download/install.js');

const versionId = process.argv[2] || '1.21.4';
const withAssets = process.argv.includes('--with-assets');
const gameDir = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv[3]
  : path.join(path.dirname(process.execPath), 'Game');

(async () => {
  const backend = new FusionBackend();
  await backend.init();

  backend.config.value.gameDir = gameDir;
  backend.installer = new GameInstaller(backend.mirrors, gameDir, backend.log.child('install'));

  console.log('[test] gameDir =', gameDir, '| version =', versionId, '| assets =', withAssets);

  let last = 0;
  backend.events.on('progress', (d) => {
    const now = Date.now();
    if (now - last < 1200) return;
    last = now;
    console.log(`[progress] ${d.phase} ${d.current}/${d.total}`);
  });

  const t0 = Date.now();
  // 与主进程一致：并发 4 + 失败补一轮（国内镜像限流）
  backend.config.updateRuntime({ downloadConcurrency: 4 });
  let summary = await backend.installVersion(versionId, { skipAssets: !withAssets });
  for (let i = 1; i <= 2 && summary.failed > 0; i++) {
    console.log(`[retry] 第 ${i} 轮，补 ${summary.failed} 个失败文件…`);
    backend.config.updateRuntime({ downloadConcurrency: 1 });
    summary = await backend.installVersion(versionId, { skipAssets: !withAssets });
  }
  console.log('[SUMMARY]', JSON.stringify(summary));
  console.log('[test] 耗时', ((Date.now() - t0) / 1000).toFixed(1), '秒');

  // 校验：客户端 jar 与 natives 是否真的落盘
  const fs = require('fs');
  const jar = path.join(gameDir, 'versions', versionId, versionId + '.jar');
  console.log('[check] client jar:', fs.existsSync(jar) ? (fs.statSync(jar).size / 1048576).toFixed(1) + ' MB' : '缺失');
  const natives = path.join(gameDir, 'natives', versionId);
  if (fs.existsSync(natives)) {
    const files = fs.readdirSync(natives);
    console.log('[check] natives 文件数:', files.length, files.slice(0, 5).join(', '));
  } else {
    console.log('[check] natives 目录缺失');
  }
  process.exit(0);
})().catch((e) => {
  console.error('[FAIL]', e && e.stack ? e.stack : e);
  process.exit(1);
});
