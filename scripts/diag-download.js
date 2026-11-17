/** 下载失败诊断：取前若干个库文件跑一次，打印每个 URL 与失败原因。 */
const path = require('path');
const { FusionBackend } = require('../core/backend.js');
const { GameResolver } = require('../core/download/resolve.js');
const { aggregatedDownloadMany } = require('../core/download/aggregator.js');

const gameDir = process.argv[3] || 'E:/任衍瑞/软件开发/XCL/Game';
const versionId = process.argv[2] || '1.21.4';

(async () => {
  const backend = new FusionBackend();
  await backend.init();
  const version = await backend.loadVersion(versionId);
  const resolver = new GameResolver(backend.mirrors, gameDir);
  const files = resolver.resolveLibraries(version);

  console.log('[diag] 库文件总数', files.length);
  const sample = files.slice(0, 4);
  sample.forEach((f) => {
    console.log('---');
    console.log('label:', f.label, '| dest:', path.relative(gameDir, f.dest));
    f.urls.slice(0, 4).forEach((u) => console.log('   url:', u));
    console.log('   sha1:', f.sha1);
  });

  const res = await aggregatedDownloadMany(
    sample.map((f) => ({ urls: f.urls, dest: f.dest, sha1: f.sha1, label: f.label })),
    { concurrency: 2 },
  );
  console.log('[diag] ok=', res.ok, 'failed=', JSON.stringify(res.failed, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('[diag FAIL]', e && e.stack ? e.stack : e);
  process.exit(1);
});
