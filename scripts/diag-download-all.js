/** 全量下载诊断：跑全部库文件，打印失败清单与 URL。 */
const path = require('path');
const { FusionBackend } = require('../core/backend.js');
const { GameResolver } = require('../core/download/resolve.js');
const { aggregatedDownloadMany } = require('../core/download/aggregator.js');

const gameDir = 'E:/任衍瑞/软件开发/XCL/Game';
const versionId = process.argv[2] || '1.21.4';
const conc = Number(process.argv[3]) || 8;

(async () => {
  const backend = new FusionBackend();
  await backend.init();
  const version = await backend.loadVersion(versionId);
  const resolver = new GameResolver(backend.mirrors, gameDir);
  const files = resolver.resolveLibraries(version);

  const t0 = Date.now();
  const res = await aggregatedDownloadMany(
    files.map((f) => ({ urls: f.urls, dest: f.dest, sha1: f.sha1, label: f.label })),
    {
      concurrency: conc,
      onProgress: (d, t) => {
        if (d % 20 === 0 || d === t) console.log(`[progress] ${d}/${t}`);
      },
    },
  );
  console.log(`[diag] 并发 ${conc} · 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s · ok=${res.ok} · failed=${res.failed.length} · ${(res.bytes / 1048576).toFixed(1)}MB`);
  res.failed.slice(0, 12).forEach((f) => console.log('  ✗', path.basename(f.dest), '|', String(f.error).slice(0, 120)));
  process.exit(0);
})().catch((e) => {
  console.error('[diag FAIL]', e && e.stack ? e.stack : e);
  process.exit(1);
});
