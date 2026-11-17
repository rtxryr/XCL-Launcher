'use strict';
/**
 * 更新服务的本地 mock（自测用，不参与打包）。
 *
 * 用法：
 *   node scripts/mock-update-server.cjs            # 监听 3987
 *   const { start } = require('./mock-update-server.cjs'); await start();
 *
 * 实现的接口（与真实站点一致，全部要求 ?sharecode=4XX2XCSHDN）：
 *   GET  /api/v1/app/update?app=xcraft-launcher&current=1.0.0
 *   POST /api/v1/app/verify-key        { app, key }
 *   GET  /api/v1/app/package?app=..&token=..
 * 另外提供测试控制端点：
 *   GET /__requests              已收到的请求列表（用于验证资源门控真的没发请求）
 *   GET /__control?reset=1       清空请求记录与开关
 *   GET /__control?badSha=1      让 update 返回错误的 sha256
 *   GET /__control?slow=1        下载按 150ms/块 节流（给 update:cancel 留时间）
 *   GET /__config                当前 mock 状态
 *
 * 更新包是一个真实可解压的 zip（内含假的 "X Craft Launcher.exe" 文本文件）。
 */

const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = Number(process.env.MOCK_PORT) || 3987;
const SHARECODE = '4XX2XCSHDN';
const INSTALL_KEY = 'XCL-4XX2-2026-INSTALL';
const APP = 'xcraft-launcher';
const VERSION = '1.2.0';
const NOTES = '1. 修复启动器在某些机器上白屏的问题\n2. 提升下载并发与断点续传稳定性\n3. 新增自动更新功能';

// ---------------------------------------------------------------------------
// 极简 zip 写入（不引第三方包）：deflate 压缩 + 本地头 + 中央目录
// ---------------------------------------------------------------------------
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** @param {{name:string,data:string|Buffer}[]} entries */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  // 固定时间戳：2026-01-01 00:00（DOS 格式，避免解压工具嫌日期非法）
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data, { level: 9 });

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6); // 文件名 UTF-8
    lfh.writeUInt16LE(8, 8); // deflate
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    lfh.writeUInt16LE(0, 28);
    chunks.push(lfh, name, comp);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38); // external attrs
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, name);

    offset += 30 + name.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([Buffer.concat(chunks), cdBuf, eocd]);
}

/**
 * 生成 1.2.0 更新包：只有程序文件，不含 Game 目录。
 * @param {boolean} nested true 时把所有条目包进单顶层目录 `X Craft Launcher/`
 *   ——与真实发布 zip 的结构一致，用来验证客户端的 strip-components 逻辑。
 */
function buildPackage(nested) {
  const prefix = nested ? 'X Craft Launcher/' : '';
  const entries = [
    {
      name: 'X Craft Launcher.exe',
      data: nested
        ? 'MOCK EXE v1.2.0 NESTED (not a real executable)\n'
        : 'MOCK EXE v1.2.0 (not a real executable)\n',
    },
    { name: 'resources/app.txt', data: 'v1.2.0 app payload\n' },
    { name: 'resources/version.txt', data: VERSION + '\n' },
    { name: 'resources/new-in-120.txt', data: '这是 1.2.0 新增的文件\n' },
    // 200KB 近似随机数据：让进度事件、速度计算有真实体量（压缩率低）
    { name: 'resources/assets.bin', data: crypto.randomBytes(200 * 1024) },
  ];
  return buildZip(entries.map((e) => ({ name: prefix + e.name, data: e.data })));
}

function createState() {
  return {
    flat: buildPackage(false),
    nested: buildPackage(true),
    nestedMode: false, // 由 /__control?nested=1 切换
    badSha: false,
    slow: false,
    tokenSeq: 0,
    requests: [],
  };
}

function zipOf(st) {
  return st.nestedMode ? st.nested : st.flat;
}
function shaOf(st) {
  return crypto.createHash('sha256').update(zipOf(st)).digest('hex');
}

function start(opts) {
  const o = opts || {};
  const st = createState();
  const port = o.port || PORT;

  const send = (res, code, body, headers) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}));
    res.end(buf);
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1:' + port);
    const p = u.pathname;

    // ---- 测试控制端点（不带 sharecode 要求） ----
    if (p === '/__requests') return send(res, 200, JSON.stringify(st.requests));
    if (p === '/__config') {
      return send(
        res,
        200,
        JSON.stringify({
          badSha: st.badSha,
          slow: st.slow,
          nested: st.nestedMode,
          sha256: shaOf(st),
          size: zipOf(st).length,
        }),
      );
    }
    if (p === '/__control') {
      if (u.searchParams.get('reset')) {
        st.requests = [];
        st.badSha = false;
        st.slow = false;
        st.nestedMode = false;
      }
      if (u.searchParams.get('badSha') !== null) st.badSha = u.searchParams.get('badSha') === '1';
      if (u.searchParams.get('slow') !== null) st.slow = u.searchParams.get('slow') === '1';
      // nested=1：切换成「单顶层目录」结构的包（与真实发布 zip 一致）
      if (u.searchParams.get('nested') !== null) st.nestedMode = u.searchParams.get('nested') === '1';
      return send(
        res,
        200,
        JSON.stringify({ ok: true, badSha: st.badSha, slow: st.slow, nested: st.nestedMode }),
      );
    }

    st.requests.push({ at: Date.now(), method: req.method, url: req.url });

    // 网关要求 sharecode
    if (u.searchParams.get('sharecode') !== SHARECODE) {
      return send(res, 403, JSON.stringify({ ok: false, error: 'sharecode 无效' }));
    }

    // 1) 检查更新
    if (p === '/api/v1/app/update' && req.method === 'GET') {
      if (u.searchParams.get('app') !== APP) {
        return send(res, 404, JSON.stringify({ ok: false, error: 'app 不存在' }));
      }
      const current = u.searchParams.get('current') || '0.0.0';
      const zip = zipOf(st);
      const body = {
        ok: true,
        hasUpdate: true,
        current: current,
        latest: {
          version: VERSION,
          size: zip.length,
          sha256: st.badSha ? 'f'.repeat(64) : shaOf(st),
          publishedAt: '2026-11-05T00:00:00Z',
          notes: NOTES,
        },
        minSupported: '1.0.0',
      };
      return send(res, 200, JSON.stringify(body));
    }

    // 2) 安装密钥换令牌
    if (p === '/api/v1/app/verify-key' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let j = {};
        try {
          j = JSON.parse(raw || '{}');
        } catch {
          return send(res, 400, JSON.stringify({ ok: false, error: 'JSON 解析失败' }));
        }
        if (j.app !== APP || j.key !== INSTALL_KEY) {
          return send(res, 403, JSON.stringify({ ok: false, error: '安装密钥无效' }));
        }
        st.tokenSeq += 1;
        send(res, 200, JSON.stringify({ ok: true, token: 'mock-token-' + st.tokenSeq, expiresIn: 3600 }));
      });
      return;
    }

    // 3) 下载更新包
    if (p === '/api/v1/app/package' && req.method === 'GET') {
      const token = u.searchParams.get('token') || '';
      if (!token.startsWith('mock-token-')) {
        return send(res, 403, JSON.stringify({ ok: false, error: 'token 无效' }));
      }
      const zip = zipOf(st);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': zip.length,
        'X-Checksum-Sha256': shaOf(st),
        'Accept-Ranges': 'bytes',
      });
      if (!st.slow) {
        // 分 20 块、每块间隔 100ms 发送：客户端能观察到多次进度事件（约 2 秒下完）
        const chunk = Math.max(1, Math.ceil(zip.length / 20));
        let off = 0;
        const timer = setInterval(() => {
          if (off >= zip.length) {
            clearInterval(timer);
            return res.end();
          }
          res.write(zip.subarray(off, off + chunk));
          off += chunk;
        }, 100);
        req.on('close', () => clearInterval(timer));
        return;
      }
      // slow 模式：60 块 × 100ms ≈ 6 秒，留足 update:cancel 的时间窗
      const chunk = Math.max(1, Math.ceil(zip.length / 60));
      let off = 0;
      const timer = setInterval(() => {
        if (off >= zip.length) {
          clearInterval(timer);
          return res.end();
        }
        res.write(zip.subarray(off, off + chunk));
        off += chunk;
      }, 100);
      req.on('close', () => clearInterval(timer));
      return;
    }

    send(res, 404, JSON.stringify({ ok: false, error: 'not found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        port,
        state: st,
        // 当前生效包的只读视图（随 /__control?nested= 切换）
        get sha256() {
          return shaOf(st);
        },
        get size() {
          return zipOf(st).length;
        },
        get nested() {
          return st.nestedMode;
        },
        close: () =>
          new Promise((r) => {
            server.closeAllConnections && server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}

module.exports = { start, buildZip, buildPackage };

if (require.main === module) {
  start().then((h) => {
    process.stdout.write(
      'mock 更新服务已启动 http://127.0.0.1:' + h.port + '\n' +
        '  sha256=' + h.sha256 + '\n' +
        '  size=' + h.size + '\n',
    );
  });
}
