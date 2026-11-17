/**
 * 把 exe 的版本资源改成指定版本（保留图标与其它字段）。
 * 用法：node scripts/bump-exe.cjs <exe路径> <1.0.5>
 */
const fs = require("fs");
const ResEdit = require("resedit");

const exePath = process.argv[2];
const verStr = process.argv[3] || "1.0.5";
const parts = verStr.split(".").map((n) => parseInt(n, 10));
while (parts.length < 4) parts.push(0);

const buf = fs.readFileSync(exePath);
const exe = ResEdit.NtExecutable.from(buf);
const res = ResEdit.NtExecutableResource.from(exe);
const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
if (!infos.length) throw new Error("没有版本资源：" + exePath);

const vi = infos[0];
const cur = (vi.data.strings && vi.data.strings[0]) || { lang: 1033, codepage: 1200, values: {} };
console.log("原字符串:", JSON.stringify(cur.values));

vi.setFileVersion(parts[0], parts[1], parts[2], parts[3]);
vi.setProductVersion(parts[0], parts[1], parts[2], parts[3]);
vi.setStringValues(
  { lang: cur.lang, codepage: cur.codepage },
  Object.assign({}, cur.values, {
    FileVersion: verStr,
    ProductVersion: parts.join("."),
  }),
);
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));

const chk = ResEdit.Resource.VersionInfo.fromEntries(
  ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(fs.readFileSync(exePath))).entries,
)[0];
console.log("新字符串:", JSON.stringify(chk.data.strings[0].values));
console.log("完成：" + exePath + "  " + fs.statSync(exePath).size + " 字节");
