"use strict";
/**
 * 设备性能检测 + 自适应运行限制（纯 Node，零 npm 依赖）。
 *
 * 提供三块能力：
 *  1) detectHardware：一次采集硬件快照（同步 + 进程内缓存），供设置页展示与推荐算法使用。
 *  2) stats：把每次启动的 CPU / 内存采样落盘（userDataDir/stats.json），累计 5 次后进入「稳定」状态。
 *  3) recommend / resolveLimits：把「硬件 + 历史采样 + 用户选择」折算成 -Xmx 大小、进程优先级、
 *     CPU 亲和性、附加 JVM 参数。
 *
 * 三条硬约束（上层按此对接，勿破坏）：
 *  - 所有外部命令走 execFile/execFileSync 的参数数组，绝不拼字符串命令（避免 shell 注入与中文路径问题）；
 *  - 所有外部命令都带超时（<= 5s），失败一律静默降级为默认值，本模块对外不抛异常；
 *  - 探测不到的字段给 '' / 0 / null，绝不出现 undefined（UI 直接渲染这些字段）。
 */

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, execFile } = require("node:child_process");

const IS_WIN = process.platform === "win32";
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;
/** 外部命令超时（3~5 秒区间） */
const PS_TIMEOUT = 4500;
const SAMPLE_TIMEOUT = 4000;
/** stats.json 里最多保留的启动记录条数 */
const MAX_LAUNCHES = 5;
const STATS_FILE = "stats.json";
const STATS_VERSION = 1;

/* ------------------------------------------------------------------ *
 * 通用小工具
 * ------------------------------------------------------------------ */

/** 取非负整数，非数字返回 0。 */
function toPosInt(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    return Math.round(n);
}

/** 保留 1 位小数。 */
function round1(n) {
    return Math.round(n * 10) / 10;
}

/** 向下取到 256 的倍数。 */
function floor256(n) {
    return Math.floor(n / 256) * 256;
}

/** 把外部文本转成字符串，去掉首尾空白与 BOM。 */
function clean(v) {
    if (v === undefined || v === null)
        return "";
    return String(v).replace(/^\uFEFF/, "").trim();
}

/**
 * 同步跑 PowerShell（Windows 专用）。脚本内部已 try/catch，这里再兜一层，
 * 任何失败（无 powershell、被策略拦截、超时）都返回 ''。
 */
function psSync(script, timeout) {
    if (!IS_WIN)
        return "";
    try {
        const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
            encoding: "utf8",
            timeout: timeout || PS_TIMEOUT,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            stdio: ["ignore", "pipe", "ignore"],
        });
        return typeof out === "string" ? out : "";
    }
    catch (e) {
        return "";
    }
}

/** 同步跑一个命令（参数数组），失败返回 ''。 */
function runSync(file, args, timeout) {
    try {
        const out = execFileSync(file, args, {
            encoding: "utf8",
            timeout: timeout || PS_TIMEOUT,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            stdio: ["ignore", "pipe", "ignore"],
        });
        return typeof out === "string" ? out : "";
    }
    catch (e) {
        return "";
    }
}

/**
 * 异步跑 PowerShell，返回 Promise<string>；永不 reject（失败给 ''）。
 * 自带一次性保护：超时与回调同时到达时只 resolve 一次。
 */
function psExec(script, timeout) {
    return new Promise((resolve) => {
        if (!IS_WIN) {
            resolve("");
            return;
        }
        let done = false;
        const finish = (v) => {
            if (done)
                return;
            done = true;
            resolve(typeof v === "string" ? v : "");
        };
        try {
            const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
                encoding: "utf8",
                timeout: timeout || SAMPLE_TIMEOUT,
                windowsHide: true,
                maxBuffer: 1024 * 1024,
            }, (err, stdout) => {
                if (err && !stdout)
                    finish("");
                else
                    finish(stdout || "");
            });
            // 兜底：某些环境下 timeout 不触发 kill 回调，这里再挂一个保险
            const guard = setTimeout(() => {
                try {
                    if (child && child.kill)
                        child.kill();
                }
                catch (e) { /* ignore */ }
                finish("");
            }, (timeout || SAMPLE_TIMEOUT) + 500);
            if (guard.unref)
                guard.unref();
            if (child && child.on) {
                child.on("close", () => {
                    try {
                        clearTimeout(guard);
                    }
                    catch (e) { /* ignore */ }
                });
            }
        }
        catch (e) {
            finish("");
        }
    });
}

/* ------------------------------------------------------------------ *
 * 1) 硬件快照
 * ------------------------------------------------------------------ */

let _hwCache = null;

/** 启动器所在目录（用于算「启动器所在盘」剩余空间）。 */
function launcherRoot() {
    const candidates = [
        clean(process.env.PORTABLE_EXECUTABLE_DIR),
        process.execPath ? path.dirname(process.execPath) : "",
        __dirname,
        process.cwd(),
    ];
    for (const c of candidates) {
        if (!c)
            continue;
        try {
            if (fs.statSync(c).isDirectory())
                return c;
        }
        catch (e) { /* 换下一个 */ }
    }
    return process.cwd();
}

/**
 * 一条 PowerShell 脚本取回 CPU 物理核数、显卡、显存、分辨率、磁盘介质类型。
 * 合并成一次调用是为了减少启动期的同步阻塞（每次 spawn 本身就要 0.6s 左右）。
 *
 * 实测（i5-11300H / Win11 26300）这几处写法差异极大：
 *  - `Get-CimInstance Win32_Processor`（全对象）≈2.4s，加 `-Property` 后 ≈1.1s；
 *  - `Get-PhysicalDisk`（storage 模块）≈4.7s，改用 `MSFT_PhysicalDisk` ≈1.3s。
 * 因此统一用 `-Property` 收窄属性、避开 Get-PhysicalDisk，整体约 3s。
 */
function probeWindows(timeout) {
    const script = [
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
        "$ErrorActionPreference='SilentlyContinue'",
        "try{$c=Get-CimInstance Win32_Processor -Property NumberOfCores,NumberOfLogicalProcessors|Select-Object -First 1;if($c){'cores='+$c.NumberOfCores;'logical='+$c.NumberOfLogicalProcessors}}catch{}",
        "try{$v=Get-CimInstance Win32_VideoController|Select-Object -First 1;if($v){'gpu='+$v.Name;'vram='+$v.AdapterRAM;'dw='+$v.CurrentHorizontalResolution;'dh='+$v.CurrentVerticalResolution}}catch{}",
        "try{$q=(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000').'HardwareInformation.qwMemorySize';if($q){'qwvram='+$q}}catch{}",
        "try{$d=Get-CimInstance -Namespace root\\microsoft\\windows\\storage -ClassName MSFT_PhysicalDisk -Property MediaType|Select-Object -First 1;if($d){'media='+$d.MediaType}}catch{}",
    ].join("; ");

    const map = Object.create(null);
    const out = psSync(script, timeout || PS_TIMEOUT);
    for (const line of out.split(/\r?\n/)) {
        const s = clean(line);
        if (!s)
            continue;
        const i = s.indexOf("=");
        if (i <= 0)
            continue;
        map[s.slice(0, i).toLowerCase()] = s.slice(i + 1).trim();
    }
    return map;
}

/** 整条探测失败（超时/被策略拦截）时，只抢救显卡名，保证界面不至于空着。 */
function probeGpuOnly() {
    const script = [
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
        "$ErrorActionPreference='SilentlyContinue'",
        "try{$v=Get-CimInstance Win32_VideoController -Property Name,AdapterRAM,CurrentHorizontalResolution,CurrentVerticalResolution|Select-Object -First 1;if($v){'gpu='+$v.Name;'vram='+$v.AdapterRAM;'dw='+$v.CurrentHorizontalResolution;'dh='+$v.CurrentVerticalResolution}}catch{}",
    ].join("; ");
    const map = Object.create(null);
    const out = psSync(script, 2000);
    for (const line of out.split(/\r?\n/)) {
        const s = clean(line);
        if (!s)
            continue;
        const i = s.indexOf("=");
        if (i <= 0)
            continue;
        map[s.slice(0, i).toLowerCase()] = s.slice(i + 1).trim();
    }
    return map;
}

/** wmic 兜底取显卡名（老系统 / PowerShell 被禁用时）。 */
function probeGpuNameByWmic() {
    if (!IS_WIN)
        return "";
    const out = runSync("wmic", ["path", "win32_VideoController", "get", "name"], PS_TIMEOUT);
    for (const line of out.split(/\r?\n/)) {
        const s = clean(line);
        if (!s || /^name$/i.test(s))
            continue;
        return s;
    }
    return "";
}

/** 磁盘剩余空间（启动器所在盘，GB，1 位小数）。 */
function probeDiskFreeGB() {
    const root = launcherRoot();
    // Node 18.15+ 支持 statfsSync（Windows 走 GetDiskFreeSpaceEx）
    try {
        if (typeof fs.statfsSync === "function") {
            const st = fs.statfsSync(root);
            const bytes = Number(st.bavail) * Number(st.bsize);
            if (Number.isFinite(bytes) && bytes > 0)
                return round1(bytes / GB);
        }
    }
    catch (e) { /* 走 wmic */ }
    if (!IS_WIN)
        return 0;
    // wmic 兜底
    try {
        const letter = (path.parse(path.resolve(root)).root || "").replace(/[\\/]/g, "").toUpperCase();
        const out = runSync("wmic", ["logicaldisk", "get", "DeviceID,FreeSpace"], PS_TIMEOUT);
        for (const line of out.split(/\r?\n/)) {
            const m = clean(line).match(/^([A-Za-z]:)\s+(\d+)/);
            if (!m)
                continue;
            if (!letter || m[1].toUpperCase() === letter)
                return round1(Number(m[2]) / GB);
        }
    }
    catch (e) { /* ignore */ }
    return 0;
}

/** Linux：从 /proc/meminfo 读 MemAvailable（os.freemem 只给 MemFree，偏差大）。 */
function linuxAvailableMB() {
    try {
        const text = fs.readFileSync("/proc/meminfo", "utf8");
        const m = text.match(/^MemAvailable:\s+(\d+)\s+kB/mi);
        if (m)
            return Math.round(Number(m[1]) / 1024);
    }
    catch (e) { /* ignore */ }
    return 0;
}

/** Linux：读 /sys/block/*\/queue/rotational 判断是否 SSD；判断不出给 null。 */
function linuxIsSSD() {
    try {
        const names = fs.readdirSync("/sys/block");
        const results = [];
        for (const n of names) {
            if (/^(loop|ram|dm-|sr|zram|fd)/i.test(n))
                continue;
            try {
                const flag = clean(fs.readFileSync(`/sys/block/${n}/queue/rotational`, "utf8"));
                if (flag === "0" || flag === "1")
                    results.push(flag === "0");
            }
            catch (e) { /* ignore */ }
        }
        if (!results.length)
            return null;
        // 任一块是机械盘就按机械盘算（游戏目录很可能落在它上面）
        return results.every(Boolean);
    }
    catch (e) {
        return null;
    }
}

/** CPU 型号 / 主频 / 逻辑线程数（os.cpus，够用）。 */
function cpuBasics() {
    let model = "";
    let mhz = 0;
    let threads = 0;
    try {
        const list = os.cpus() || [];
        threads = list.length;
        if (list[0]) {
            model = clean(list[0].model);
            mhz = toPosInt(list[0].speed);
        }
    }
    catch (e) { /* ignore */ }
    if (!threads)
        threads = 4;
    return { model, mhz, threads };
}

/**
 * 硬件快照（同步，带进程内缓存）。
 * @param {boolean} [force] true 时忽略缓存重测
 */
function detectHardware(force) {
    if (!force && _hwCache)
        return Object.assign({}, _hwCache);

    const cpu = cpuBasics();
    let threads = cpu.threads;
    let cores = 0;
    let gpuName = "";
    let gpuVramMB = 0;
    let displayW = 0;
    let displayH = 0;
    let isSSD = null;

    if (IS_WIN) {
        let m = probeWindows(4000);
        if (!m.gpu && !m.cores) {
            // 整条探测失败（超时 / 无 powershell / 被安全策略拦），至少抢救显卡名
            const salvage = probeGpuOnly();
            if (salvage.gpu)
                m = Object.assign(salvage, m);
        }
        const pCores = toPosInt(m.cores);
        const pLogical = toPosInt(m.logical);
        if (pCores > 0)
            cores = pCores;
        if (pLogical > 0)
            threads = pLogical;
        gpuName = clean(m.gpu);
        const qw = Number(clean(m.qwvram));
        const adapter = Math.abs(Number(clean(m.vram)) || 0);
        const vramBytes = Number.isFinite(qw) && qw > 0 ? qw : adapter;
        gpuVramMB = vramBytes > 0 ? Math.round(vramBytes / MB) : 0;
        displayW = toPosInt(m.dw);
        displayH = toPosInt(m.dh);
        // MSFT_PhysicalDisk.MediaType: 0 未指定 / 3 HDD / 4 SSD / 5 SCM；老系统给的是字符串
        const media = clean(m.media);
        if (media) {
            const code = Number(media);
            if (Number.isFinite(code)) {
                if (code === 4 || code === 5)
                    isSSD = true;
                else if (code === 3)
                    isSSD = false;
            }
            else {
                const up = media.toUpperCase();
                if (up.indexOf("SSD") >= 0)
                    isSSD = true;
                else if (up.indexOf("HDD") >= 0)
                    isSSD = false;
            }
        }
        if (!gpuName)
            gpuName = probeGpuNameByWmic();
    }
    else {
        isSSD = process.platform === "linux" ? linuxIsSSD() : null;
    }

    // 物理核数探测不到时按「有超线程」估一半（宁可少报也不虚报高配）
    if (cores <= 0)
        cores = Math.max(1, Math.ceil(threads / 2));

    let ramTotalMB = 0;
    let ramFreeMB = 0;
    try {
        ramTotalMB = Math.round(os.totalmem() / MB);
        ramFreeMB = Math.round(os.freemem() / MB);
    }
    catch (e) { /* ignore */ }
    if (process.platform === "linux") {
        const avail = linuxAvailableMB();
        if (avail > 0)
            ramFreeMB = avail;
    }

    const hw = {
        os: clean(process.platform), // win32 / darwin / linux，与 arch 成对
        arch: clean(os.arch()),
        cpuModel: cpu.model,
        cpuCores: cores,
        cpuThreads: threads,
        cpuMHz: cpu.mhz,
        ramTotalMB: ramTotalMB,
        ramFreeMB: ramFreeMB,
        gpuName: gpuName,
        gpuVramMB: gpuVramMB,
        diskFreeGB: probeDiskFreeGB(),
        isSSD: isSSD,
        displayW: displayW,
        displayH: displayH,
    };

    _hwCache = hw;
    return Object.assign({}, hw);
}

/* ------------------------------------------------------------------ *
 * 2) 采样统计落盘
 * ------------------------------------------------------------------ */

function emptyStats() {
    return { version: STATS_VERSION, launches: [], avgCpu: 0, avgRamMB: 0, settled: false };
}

function statsPath(userDataDir) {
    return path.join(String(userDataDir), STATS_FILE);
}

/** 把一条原始记录规整成固定字段。 */
function normalizeLaunch(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    return {
        at: toPosInt(o.at) || Date.now(),
        uptimeMs: toPosInt(o.uptimeMs),
        cpuAvg: round1(Math.max(0, Number(o.cpuAvg) || 0)),
        ramAvgMB: toPosInt(o.ramAvgMB),
        ramPeakMB: toPosInt(o.ramPeakMB),
    };
}

/** 由 launches 推出平均值与 settled，只保留最近 MAX_LAUNCHES 条。 */
function finalizeStats(launches) {
    const list = Array.isArray(launches) ? launches.map(normalizeLaunch).slice(-MAX_LAUNCHES) : [];
    let cpuSum = 0;
    let ramSum = 0;
    for (const it of list) {
        cpuSum += it.cpuAvg;
        ramSum += it.ramAvgMB;
    }
    const n = list.length;
    return {
        version: STATS_VERSION,
        launches: list,
        avgCpu: n ? round1(cpuSum / n) : 0,
        avgRamMB: n ? Math.round(ramSum / n) : 0,
        settled: n >= MAX_LAUNCHES,
    };
}

/**
 * 读 stats.json。
 * 文件不存在 -> 空统计（不写盘）；JSON 损坏 -> 备份为 stats.json.bad-<ts> 后重建空文件。
 */
function readStats(userDataDir) {
    if (!userDataDir)
        return emptyStats();
    const file = statsPath(userDataDir);
    let text = "";
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch (e) {
        return emptyStats();
    }
    try {
        const obj = JSON.parse(text);
        const launches = Array.isArray(obj && obj.launches) ? obj.launches : [];
        return finalizeStats(launches);
    }
    catch (e) {
        // 损坏：先备份再重建，避免用户的统计一直读不出来
        try {
            fs.renameSync(file, `${file}.bad-${Date.now()}`);
        }
        catch (e2) { /* 备份失败也不影响重建 */ }
        try {
            writeStats(userDataDir, emptyStats());
        }
        catch (e3) { /* ignore */ }
        return emptyStats();
    }
}

/** 原子写盘：先写 .tmp 再 rename（同分区 rename 是原子的）。 */
function writeStats(userDataDir, stats) {
    const dir = String(userDataDir);
    const file = statsPath(dir);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stats, null, 2), "utf8");
    fs.renameSync(tmp, file);
}

/**
 * 追加一条启动记录并落盘，FIFO 保留 5 条。
 * @param {string} userDataDir 形如 C:\Users\x\AppData\Roaming\XCL
 * @param {{at?:number,uptimeMs?:number,cpuAvg?:number,ramAvgMB?:number,ramPeakMB?:number}} sample
 */
function recordLaunch(userDataDir, sample) {
    const prev = readStats(userDataDir);
    const launches = prev.launches.slice();
    launches.push(normalizeLaunch(sample));
    const next = finalizeStats(launches);
    try {
        writeStats(userDataDir, next);
    }
    catch (e) {
        // 写不进去（只读盘 / 权限）时仍返回内存里的结果，不阻断启动
    }
    return next;
}

/** 清空统计（界面「重置检测」）。 */
function resetStats(userDataDir) {
    const next = emptyStats();
    if (!userDataDir)
        return next;
    try {
        writeStats(userDataDir, next);
    }
    catch (e) { /* ignore */ }
    return next;
}

/* ------------------------------------------------------------------ *
 * 3) 运行期采样
 * ------------------------------------------------------------------ */

/** 采样一次进程 CPU 累计秒数 + 工作集（字节）；进程不存在返回 null。 */
function sampleOnce(pid) {
    const script = [
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
        `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
        "if($p){'{0}|{1}' -f $p.CPU,$p.WorkingSet64}",
    ].join("; ");
    return psExec(script, SAMPLE_TIMEOUT).then((out) => {
        const s = clean(out);
        if (!s)
            return null;
        const parts = s.split("|");
        if (parts.length < 2)
            return null;
        const cpuSec = Number(clean(parts[0]));
        const workSet = Number(clean(parts[1]));
        if (!Number.isFinite(workSet) || workSet <= 0)
            return null;
        return { cpuSec: Number.isFinite(cpuSec) ? cpuSec : 0, workSet: workSet };
    }).catch(() => null);
}

/**
 * 游戏运行期间采样 javaw 的 CPU% / 工作集。
 * 第一次采样只作基线（累计 CPU 秒数需要差值才成占用率），不计入结果。
 * @param {number} pid
 * @param {{intervalMs?:number,maxSamples?:number}} [opts]
 * @returns {{stop:() => Promise<{cpuAvg:number,ramAvgMB:number,ramPeakMB:number,samples:number}>}}
 */
function startSampling(pid, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const intervalMs = Math.max(200, toPosInt(o.intervalMs) || 3000);
    const maxSamples = Math.max(1, toPosInt(o.maxSamples) || 20);
    const pidNum = toPosInt(pid);
    let cores = 1;
    try {
        cores = (os.cpus() || []).length || 1;
    }
    catch (e) {
        cores = 1;
    }

    const cpuList = [];
    let ramList = [];
    let ramPeakMB = 0;
    let prevCpuSec = -1;
    let prevAt = 0;
    let timer = null;
    let finished = false;
    let settle = null;
    const done = new Promise((resolve) => { settle = resolve; });

    const result = () => {
        let cpuSum = 0;
        for (const c of cpuList)
            cpuSum += c;
        const n = cpuList.length;
        let ramSum = 0;
        for (const r of ramList)
            ramSum += r;
        return {
            cpuAvg: n ? round1(cpuSum / n) : 0,
            ramAvgMB: ramList.length ? Math.round(ramSum / ramList.length) : 0,
            ramPeakMB: ramPeakMB,
            samples: n,
        };
    };

    const finish = () => {
        if (finished)
            return done;
        finished = true;
        if (timer) {
            try {
                clearTimeout(timer);
            }
            catch (e) { /* ignore */ }
            timer = null;
        }
        settle(result());
        return done;
    };

    const tick = () => {
        if (finished)
            return;
        sampleOnce(pidNum).then((s) => {
            if (finished)
                return;
            if (!s) {
                // 进程已退出 / 拿不到数据：提前结束
                finish();
                return;
            }
            const now = Date.now();
            const ramMB = Math.round(s.workSet / MB);
            if (ramMB > ramPeakMB)
                ramPeakMB = ramMB;
            ramList.push(ramMB);
            if (ramList.length > 512)
                ramList = ramList.slice(-256);
            if (prevCpuSec >= 0) {
                const dt = (now - prevAt) / 1000;
                if (dt > 0) {
                    const raw = ((s.cpuSec - prevCpuSec) / (dt * cores)) * 100;
                    if (Number.isFinite(raw))
                        cpuList.push(Math.max(0, Math.min(100, raw)));
                }
            }
            prevCpuSec = s.cpuSec;
            prevAt = now;
            if (cpuList.length >= maxSamples) {
                finish();
                return;
            }
            timer = setTimeout(tick, intervalMs);
            if (timer.unref)
                timer.unref();
        }).catch(() => {
            finish();
        });
    };

    // pid 不合法 / 非 Windows：直接给空结果，不装作在采样
    if (!pidNum || !IS_WIN) {
        finish();
        return { stop: () => done };
    }
    timer = setTimeout(tick, intervalMs);
    if (timer.unref)
        timer.unref();

    return {
        stop: () => {
            // 正在跑的那次采样结果会被丢弃，保证 stop() 立即 resolve
            return finish();
        },
    };
}

/* ------------------------------------------------------------------ *
 * 4) 推荐运行限制
 * ------------------------------------------------------------------ */

/** 内存档位（MB），按物理内存从小到大。 */
const MEM_TIERS = [2048, 4096, 6144, 8192, 12288, 16384];

/** 物理内存对应的档位下标。 */
function tierIndex(ramTotalMB) {
    if (ramTotalMB < 8192)
        return 0;
    if (ramTotalMB < 12288)
        return 1;
    if (ramTotalMB < 16384)
        return 2;
    if (ramTotalMB < 24576)
        return 3;
    if (ramTotalMB < 32768)
        return 4;
    return 5;
}

/** 容错：外部传进来的 stats 可能是 undefined / 老格式。 */
function normalizeStatsIn(stats) {
    if (!stats || typeof stats !== "object")
        return emptyStats();
    if (Array.isArray(stats.launches))
        return finalizeStats(stats.launches);
    return finalizeStats([]);
}

/** 设备等级。 */
function deviceLevel(ramTotalMB, threads) {
    if (ramTotalMB >= 16384 && threads >= 8)
        return "high";
    if (ramTotalMB >= 8192)
        return "mid";
    return "low";
}

/** 亲和性掩码的位数（用于文案）。 */
function maskCoreCount(mask) {
    const n = Number(mask);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    let c = 0;
    let v = Math.floor(n);
    while (v > 0) {
        c += v & 1;
        v = v >>> 1;
    }
    return c;
}

/** 内存展示：8192 -> "8 GB"，2560 -> "2.5 GB"。 */
function fmtGB(memMB) {
    const g = Math.round((memMB / 1024) * 10) / 10;
    return `${g} GB`;
}

/**
 * 按硬件 + 历史采样推荐运行限制。
 * @param {object} hw detectHardware() 的结果（允许不完整）
 * @param {object} stats readStats() 的结果（允许为空/undefined）
 */
function recommend(hw, stats) {
    const h = hw && typeof hw === "object" ? hw : {};
    const s = normalizeStatsIn(stats);

    let ramTotalMB = toPosInt(h.ramTotalMB);
    if (!ramTotalMB) {
        try {
            ramTotalMB = Math.round(os.totalmem() / MB);
        }
        catch (e) {
            ramTotalMB = 0;
        }
    }
    let threads = toPosInt(h.cpuThreads);
    if (!threads)
        threads = cpuBasics().threads;

    const level = deviceLevel(ramTotalMB, threads);
    const reasons = [];

    // --- 内存：档位 -> 高占用降档 -> 夹到物理内存 60% -> 256 对齐 ---
    const baseIdx = tierIndex(ramTotalMB);
    const tierMB = MEM_TIERS[baseIdx];
    const ramHighWater = ramTotalMB > 0 ? ramTotalMB * 0.85 : Infinity;
    const needDowngrade = s.avgRamMB > 0 && s.avgRamMB >= ramHighWater && baseIdx > 0;
    const idx = needDowngrade ? baseIdx - 1 : baseIdx;

    const capMB = ramTotalMB > 0 ? floor256(ramTotalMB * 0.6) : 0;
    let memoryMB = MEM_TIERS[idx];
    if (capMB > 0 && capMB < memoryMB)
        memoryMB = capMB;
    memoryMB = floor256(memoryMB);
    if (memoryMB < 1024)
        memoryMB = 1024; // 极端小内存机器上「最低 1G」优先于 60% 上限

    // 初始堆：推荐值的 1/4，512 起步
    let minMemoryMB = floor256(memoryMB / 4);
    if (minMemoryMB < 512)
        minMemoryMB = 512;
    if (minMemoryMB > memoryMB)
        minMemoryMB = memoryMB;

    // --- 优先级：核少或历史 CPU 高 -> below；核多且闲 -> above ---
    const hasCpuData = s.launches.length > 0;
    let priority = "normal";
    if (threads <= 4) {
        priority = "below";
        reasons.push(`仅 ${threads} 线程，降低优先级避免与系统争抢 CPU`);
    }
    else if (hasCpuData && s.avgCpu >= 80) {
        priority = "below";
        reasons.push(`历史平均 CPU 占用 ${s.avgCpu}%，降低优先级保障流畅度`);
    }
    else if (hasCpuData && s.avgCpu <= 35 && threads >= 8) {
        priority = "above";
        reasons.push(`历史平均 CPU 占用仅 ${s.avgCpu}%，可提高优先级加快加载`);
    }

    // --- CPU 亲和性：只在 3/4 线程时预留一个核给系统，其余不限 ---
    let affinityMask = null;
    if (threads === 3)
        affinityMask = "3"; // CPU0-1
    else if (threads === 4)
        affinityMask = "7"; // CPU0-2

    // --- JVM 参数：<=4G 用 SerialGC（省 GC 线程），否则 G1 ---
    const jvmArgs = memoryMB <= 4096
        ? ["-XX:+UseSerialGC"]
        : ["-XX:+UseG1GC", "-XX:MaxGCPauseMillis=50"];

    // --- 文案（最多 4 条）---
    const levelLabel = level === "high" ? "高配" : level === "mid" ? "中配" : "低配";
    const ramGB = Math.round((ramTotalMB / 1024) * 10) / 10;
    reasons.unshift(`${ramGB} GB 内存 / ${threads} 线程，判定为${levelLabel}设备`);
    reasons.push(capMB > 0 && capMB < tierMB
        ? `堆内存按档位取 ${fmtGB(memoryMB)}（物理内存 60% 上限 ${fmtGB(capMB)}）`
        : `堆内存按档位取 ${fmtGB(memoryMB)}`);
    if (needDowngrade) {
        reasons.push(`历史平均占用 ${s.avgRamMB}MB 已过物理内存 85%，档位下调一档`);
    }
    reasons.push(memoryMB <= 4096
        ? "堆 ≤ 4 GB，用 SerialGC 减少 GC 线程开销"
        : "堆 > 4 GB，用 G1GC 并限制单次停顿 50ms");

    return {
        level: level,
        memoryMB: memoryMB,
        minMemoryMB: minMemoryMB,
        priority: priority,
        affinityMask: affinityMask,
        jvmArgs: jvmArgs,
        reasons: reasons.slice(0, 4),
    };
}

/* ------------------------------------------------------------------ *
 * 5) 合并用户选择
 * ------------------------------------------------------------------ */

const PRIORITY_LABEL = { normal: "普通优先级", below: "低于正常", above: "高于正常" };

/** 手动内存：256 对齐，夹到 [1024, 物理内存-1024]。 */
function clampManualMemory(value, ramTotalMB) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    let m = Math.round(n / 256) * 256;
    const maxMB = ramTotalMB > 0 ? Math.max(1024, floor256(ramTotalMB - 1024)) : 0;
    if (maxMB > 0 && m > maxMB)
        m = maxMB;
    if (m < 1024)
        m = 1024;
    return m;
}

/** 手动 JVM 参数：去空、去重，并剔除 -Xmx/-Xms（由 memoryMB 统一表达）。 */
function cleanJvmArgs(list) {
    const out = [];
    if (!Array.isArray(list))
        return out;
    for (const item of list) {
        const s = clean(item);
        if (!s)
            continue;
        if (/^-Xm[sx]/i.test(s))
            continue;
        if (out.indexOf(s) < 0)
            out.push(s);
    }
    return out;
}

/**
 * 把推荐结果与用户选择合并成最终限制。
 * @param {object} hw
 * @param {object} stats
 * @param {{auto?:boolean,memoryMB?:number,priority?:string,affinityMask?:string|number|null,jvmArgs?:string[]}} [userChoice]
 */
function resolveLimits(hw, stats, userChoice) {
    const rec = recommend(hw, stats);
    const h = hw && typeof hw === "object" ? hw : {};
    let ramTotalMB = toPosInt(h.ramTotalMB);
    if (!ramTotalMB) {
        try {
            ramTotalMB = Math.round(os.totalmem() / MB);
        }
        catch (e) {
            ramTotalMB = 0;
        }
    }

    const choice = userChoice && typeof userChoice === "object" ? userChoice : null;
    // 只有「没传」或「显式 auto:true」才算自动；带了具体字段就按手动处理
    const auto = !choice || choice.auto === true;

    let memoryMB = rec.memoryMB;
    let priority = rec.priority;
    let affinityMask = rec.affinityMask;
    let jvmArgs = rec.jvmArgs.slice();

    if (!auto) {
        const manualMem = clampManualMemory(choice.memoryMB, ramTotalMB);
        if (manualMem)
            memoryMB = manualMem;
        const p = clean(choice.priority).toLowerCase();
        if (p === "normal" || p === "below" || p === "above")
            priority = p;
        if (choice.affinityMask !== undefined) {
            const raw = choice.affinityMask;
            const text = raw === null || raw === undefined ? "" : clean(raw).toLowerCase();
            if (text === "" || text === "null" || text === "auto" || text === "0") {
                affinityMask = null;
            }
            else {
                const n = Number(text);
                affinityMask = Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : null;
            }
        }
        if (Array.isArray(choice.jvmArgs))
            jvmArgs = cleanJvmArgs(choice.jvmArgs);
    }

    const coreText = affinityMask === null
        ? "不限核心"
        : `限制 ${maskCoreCount(affinityMask)} 核`;
    const summary = `${fmtGB(memoryMB)} 内存 · ${PRIORITY_LABEL[priority] || PRIORITY_LABEL.normal} · ${coreText}`;

    return {
        memoryMB: memoryMB,
        priority: priority,
        affinityMask: affinityMask,
        jvmArgs: jvmArgs,
        auto: auto,
        summary: summary,
    };
}

exports.detectHardware = detectHardware;
exports.readStats = readStats;
exports.recordLaunch = recordLaunch;
exports.resetStats = resetStats;
exports.startSampling = startSampling;
exports.recommend = recommend;
exports.resolveLimits = resolveLimits;
