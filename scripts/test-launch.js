/**
 * 启动链路验证：组装真实命令行并 spawn，观察输出后自动结束。
 * 用法：node scripts/test-launch.js [versionId]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { FusionBackend } = require('../core/backend.js');
const { GameResolver } = require('../core/download/resolve.js');
const { launchGame } = require('../core/launch/launcher.js');
const { buildContext } = require('../core/meta/rules.js');
const { classpathSep } = require('../core/core/util.js');

const gameDir = 'E:/任衍瑞/软件开发/XCL/Game';
const versionId = process.argv[2] || '1.21.4';

(async () => {
  const backend = new FusionBackend();
  await backend.init();
  backend.config.value.gameDir = gameDir;

  const version = await backend.loadVersion(versionId);
  console.log('[launch] 版本', versionId, '| mainClass =', version.mainClass, '| javaVersion =', JSON.stringify(version.javaVersion || null));

  const java = await backend.java.resolve(
    version.javaVersion && version.javaVersion.majorVersion,
    backend.config.runtime.javaPath,
  );
  console.log('[launch] Java =', java.javaPath, '| major =', java.major, '| source =', java.source);

  const resolver = new GameResolver(backend.mirrors, gameDir);
  const files = resolver.resolveLibraries(version);
  const cp = files
    .filter((f) => f.kind === 'library' || f.kind === 'client')
    .map((f) => f.dest)
    .join(classpathSep());
  console.log('[launch] classpath 条目 =', cp.split(classpathSep()).length);

  const identity = {
    username: 'Tester',
    uuid: '00000000000000000000000000000001',
    accessToken: '0'.repeat(32),
    userType: 'legacy',
  };

  let matched = 0;
  backend.events.on('gameOutput', (d) => {
    const line = String(d.line || '');
    if (/Setting user|Backend library|OpenAL|LWJGL|Narrator|Stopping|Exception|Error|Failed|crash/i.test(line)) {
      matched++;
      console.log('[game:' + d.stream + ']', line.slice(0, 170));
    }
  });
  backend.events.on('gameExit', (d) => console.log('[gameExit]', JSON.stringify(d)));

  console.log('[launch] natives =', path.join(gameDir, 'natives', versionId),
    '| dll 数 =', fs.readdirSync(path.join(gameDir, 'natives', versionId)).length);

  const handle = launchGame({
    log: backend.log.child('launch'),
    events: backend.events,
    javaPath: java.javaPath,
    version,
    identity,
    paths: {
      nativesDir: path.join(gameDir, 'natives', versionId),
      librariesDir: path.join(gameDir, 'libraries'),
      assetsDir: path.join(gameDir, 'assets'),
      gameDir,
      classpath: cp,
      classpathSeparator: classpathSep(),
    },
    settings: { maxMemoryMB: 1024, width: 1280, height: 720 },
    ctx: buildContext(),
  });

  console.log('[launch] 已拉起进程 pid =', handle.pid);

  // 跑 25 秒足够看到主菜单日志；随后主动结束，避免一直占着窗口
  const timer = setTimeout(() => {
    console.log('[launch] 25s 到，结束进程');
    handle.kill();
  }, 25000);

  const res = await handle.wait();
  clearTimeout(timer);
  console.log('[launch] 退出 result =', JSON.stringify(res));
  console.log('[launch] 命中关键日志行 =', matched);
  process.exit(0);
})().catch((e) => {
  console.error('[launch FAIL]', e && e.stack ? e.stack : e);
  process.exit(1);
});
