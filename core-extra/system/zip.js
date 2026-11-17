'use strict';

/**
 * 最小 ZIP 写入器（零依赖，只用 Node 内置模块）。
 *
 * 为什么自己写：本项目 package.json 只有 devDependencies，运行时不能 npm install，
 * 而诊断包必须是一个能直接发给客服的 .zip。
 *
 * 支持范围（够用即可，不做通用库）：
 *   - 压缩方法：8（deflate，zlib.deflateRawSync）/ 0（store，用于极小的条目）
 *   - 文件名：UTF-8（general purpose bit 11 = 0x0800），路径分隔符统一 '/'
 *   - 不写 data descriptor：crc / 压缩后大小直接进 local file header，
 *     少一个「标记位与偏移对不上」的出错点
 *   - 不写加密、不写 zip64（单文件 > 4GB 或条目过多直接抛错，诊断包不可能这么大）
 *
 * 产物经 Windows 资源管理器 / PowerShell Expand-Archive / 7-Zip 均可正常解开。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// CRC32（IEEE 802.3，ZIP 用的那个）：查表法，表只建一次
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/**
 * 算一段字节的 CRC32。
 * @param {Buffer} buf
 * @returns {number} 无符号 32 位整数
 */
function crc32(buf) {
  let c = -1; // 0xFFFFFFFF，用有符号 int 参与位运算更快
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

// ---------------------------------------------------------------------------
// DOS 时间 / 日期
//   date: bit15..9 年(-1980) | bit8..5 月(1-12) | bit4..0 日(1-31)
//   time: bit15..11 时 | bit10..5 分 | bit4..0 秒/2
// 1980 年之前一律夹到 1980-01-01，否则会写出非法值让解压工具报错。
// ---------------------------------------------------------------------------
function dosDateTime(input) {
  let d = input instanceof Date ? input : new Date(input || Date.now());
  if (!(d instanceof Date) || isNaN(d.getTime())) d = new Date();
  let year = d.getFullYear();
  if (year < 1980) {
    return { dosTime: 0, dosDate: (1 << 5) | 1 }; // 1980-01-01 00:00:00
  }
  if (year > 2107) year = 2107; // DOS 年份上限
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { dosTime: dosTime & 0xffff, dosDate: dosDate & 0xffff };
}

/** 归一化条目名：统一 '/'、去掉盘符/前导斜杠/../ 这类会跑到包外的东西。 */
function normalizeName(name) {
  let n = String(name == null ? '' : name).replace(/\\/g, '/');
  n = n.replace(/^[a-zA-Z]:/, ''); // 去掉 "C:"
  n = n.replace(/^\/+/, '');
  // 逐段过滤：空段、'.'、'..' 全部丢掉，避免 zip slip
  n = n
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
  return n;
}

/** < 64 字节的条目直接 store：deflate 的头部开销比省下来的还多。 */
const STORE_THRESHOLD = 64;

/**
 * 写一个 zip 文件。
 *
 * @param {string} outFile 目标 zip 绝对路径（父目录不存在会自动创建）
 * @param {{name:string, data:Buffer|string, mtime?:Date}[]} entries 条目列表
 * @returns {Promise<{size:number, file:string}>}
 */
async function writeZip(outFile, entries) {
  if (typeof outFile !== 'string' || !outFile) throw new Error('缺少输出路径');
  const list = Array.isArray(entries) ? entries : [];
  const file = path.resolve(outFile);

  const used = new Set();
  const records = [];
  let offset = 0;

  for (const entry of list) {
    if (!entry) continue;
    let name = normalizeName(entry.name);
    if (!name) continue;
    if (name.endsWith('/')) name = name.slice(0, -1); // 目录条目不支持，直接跳过
    if (!name) continue;

    // 同名条目：加序号，别让解压工具覆盖掉前一个
    if (used.has(name)) {
      const ext = path.posix.extname(name);
      const base = ext ? name.slice(0, name.length - ext.length) : name;
      let i = 2;
      while (used.has(base + '-' + i + ext)) i += 1;
      name = base + '-' + i + ext;
    }
    used.add(name);

    const raw = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data == null ? '' : String(entry.data), 'utf8');
    const crc = crc32(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const { dosTime, dosDate } = dosDateTime(entry.mtime);

    let method = 8;
    let payload = raw;
    if (raw.length < STORE_THRESHOLD) {
      method = 0;
    } else {
      const deflated = zlib.deflateRawSync(raw, { level: 9 });
      // 压不动（已经压缩过的内容）就退回 store，别为了方法好看让包变大
      if (deflated.length >= raw.length) method = 0;
      else payload = deflated;
    }

    if (raw.length > 0xffffffff || payload.length > 0xffffffff) {
      throw new Error('条目过大，超出 zip 单文件 4GB 上限：' + name);
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract（2.0 = 支持 deflate）
    local.writeUInt16LE(0x0800, 6); // flag：bit11 = 文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18); // 压缩后大小
    local.writeUInt32LE(raw.length, 22); // 原始大小
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field 长度

    records.push({
      nameBuf,
      method,
      dosTime,
      dosDate,
      crc,
      csize: payload.length,
      usize: raw.length,
      offset,
      local,
      payload,
    });
    offset += local.length + nameBuf.length + payload.length;
  }

  if (offset > 0xffffffff) throw new Error('诊断包过大，超出 zip 4GB 上限');

  // ---- central directory ----
  const centralParts = [];
  let centralSize = 0;
  for (const r of records) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central directory file header signature
    cd.writeUInt16LE(0x0014, 4); // version made by：FAT / 2.0
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8); // flag（与 local header 必须一致）
    cd.writeUInt16LE(r.method, 10);
    cd.writeUInt16LE(r.dosTime, 12);
    cd.writeUInt16LE(r.dosDate, 14);
    cd.writeUInt32LE(r.crc, 16);
    cd.writeUInt32LE(r.csize, 20);
    cd.writeUInt32LE(r.usize, 24);
    cd.writeUInt16LE(r.nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0x20, 38); // external attrs：archive 位
    cd.writeUInt32LE(r.offset, 42); // local header 偏移
    centralParts.push(cd, r.nameBuf);
    centralSize += cd.length + r.nameBuf.length;
  }

  const cdOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // 当前磁盘号
  eocd.writeUInt16LE(0, 6); // central directory 起始磁盘号
  eocd.writeUInt16LE(records.length, 8); // 本盘条目数
  eocd.writeUInt16LE(records.length, 10); // 总条目数
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // 注释长度

  // ---- 落盘：先 mkdir -p，再顺序写，避免把几十 MB 全拼成一个大 Buffer ----
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.promises.open(file, 'w');
  try {
    for (const r of records) {
      await handle.write(r.local);
      await handle.write(r.nameBuf);
      if (r.payload.length) await handle.write(r.payload);
    }
    for (const part of centralParts) await handle.write(part);
    await handle.write(eocd);
  } finally {
    await handle.close();
  }

  const st = await fs.promises.stat(file);
  return { size: st.size, file };
}

module.exports = { writeZip, crc32 };
