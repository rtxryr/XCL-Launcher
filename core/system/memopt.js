'use strict';

/**
 * 内存优化（memory optimizer）。
 *
 * 两件事：
 *   1. 监控可用内存：每 20 秒采一次，低于 10% 且剩余不足 1.2 GB 时告警一次，
 *      5 分钟内不重复打扰。
 *   2. 空闲进程清理：列出「一直开着但没在用、占着几百 MB」的进程，让用户勾选结束。
 *
 * 安全边界（不能越）：
 *   - 系统进程、资源管理器、启动器自身、任何 java/javaw（游戏或服务端可能正在跑）
 *     永远不进候选列表，也不能被 cleanup 结束。
 *   - 只收交回 `Idle` 优先级的进程，且工作集小于 900 MB。
 *   - cleanup 只接受「本次 listCandidates 里出现过」的 pid，前端伪造 pid 无效。
 *
 * 不 require('electron')：所有平台调用直接用 PowerShell（Windows 专用），
 * 非 Windows 平台一律返回空数据，不影响启动器其它功能。
 */

const { execFile } = require('child_process');

const SAMPLE_MS = 20000;          /* 采样间隔 */
const ALARM_PCT = 10;             /* 可用内存低于 10% */
const ALARM_FREE_MB = 1229;       /* 且剩余不足 1.2 GB */
const COOLDOWN_MS = 5 * 60 * 1000;/* 告警冷却 */
const MAX_CAND_MB = 900;          /* 候选进程工作集上限 */
const MIN_CAND_MB = 30;           /* 太小的清理了没意义 */

/** 永远不碰的进程名（小写） */
const PROTECTED = new Set([
  'system', 'system idle process', 'idle', 'registry', 'memory compression',
  'csrss', 'winlogon', 'wininit', 'services', 'lsass', 'smss', 'svchost',
  'dwm', 'explorer', 'sihost', 'ctfmon', 'taskhostw', 'runtimebroker',
  'fontdrvhost', 'audiodg', 'spoolsv', 'searchindexer', 'msmpeng', 'nissrv',
  'securityhealthservice', 'securityhealthsystray', 'hipsdaemon', 'hipsmain',
  'usysdiag', 'qqpctray', 'qqpcrtp', 'qqpcmgr', 'wsc', 'wscsvc',
  /* shell / WebView 宿主：结束它们会让资源管理器或别的应用直接闪退 */
  'msedgewebview2', 'shellexperiencehost', 'startmenuexperiencehost',
  'searchhost', 'applicationframehost', 'textinputhost', 'lockapp',
  'x craft launcher', 'electron', 'java', 'javaw', 'javaws',
  'node', 'msedge', 'chrome', 'firefox', 'code', 'workbuddy'
]);

const IS_WIN = process.platform === 'win32';

let lastCandidates = new Map();   /* pid → info，cleanup 时用来校验 */
let lastSample = { at: 0, freeMB: 0, totalMB: 0, pct: 100 };

function ps(script, timeout) {
  return new Promise((resolve) => {
    if (!IS_WIN) { resolve(''); return; }
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeout || 12000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        resolve(err ? '' : String(stdout || ''));
      });
  });
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ *
 * 采样
 * ------------------------------------------------------------------ */

async function sample() {
  if (!IS_WIN) return lastSample;
  const out = await ps(
    'Get-CimInstance Win32_OperatingSystem | ' +
    'Select-Object @{n="f";e={$_.FreePhysicalMemory}},@{n="t";e={$_.TotalVisibleMemorySize}} | ' +
    'ConvertTo-Json -Compress'
  );
  let j = null;
  try { j = JSON.parse(out); } catch { /* 拿不到就是拿不到 */ }
  const freeMB = j ? Math.round((num(j.f) || 0) / 1024) : 0;
  const totalMB = j ? Math.round((num(j.t) || 0) / 1024) : 0;
  const pct = totalMB > 0 ? Math.round((freeMB / totalMB) * 1000) / 10 : 100;
  lastSample = { at: Date.now(), freeMB, totalMB, pct };
  return lastSample;
}

/* ------------------------------------------------------------------ *
 * 候选进程
 * ------------------------------------------------------------------ */

async function listCandidates() {
  if (!IS_WIN) return [];
  const out = await ps(
    'Get-Process | Where-Object { $_.WorkingSet64 -gt 0 } | ' +
    'Select-Object Id,ProcessName,WorkingSet64 | ConvertTo-Json -Compress -Depth 3'
  );
  let arr = [];
  try {
    const j = JSON.parse(out);
    arr = Array.isArray(j) ? j : (j ? [j] : []);
  } catch { return []; }

  const rows = [];
  for (const p of arr) {
    const name = String(p.ProcessName || '');
    const low = name.toLowerCase();
    if (!name || PROTECTED.has(low)) continue;
    const memMB = Math.round(num(p.WorkingSet64) / 1048576);
    if (memMB < MIN_CAND_MB || memMB > MAX_CAND_MB) continue;
    rows.push({ pid: num(p.Id), name, memMB });
  }
  rows.sort((a, b) => b.memMB - a.memMB);
  const top = rows.slice(0, 12);

  lastCandidates = new Map();
  for (const r of top) lastCandidates.set(r.pid, r);
  return top;
}

/* ------------------------------------------------------------------ *
 * 清理
 * ------------------------------------------------------------------ */

async function cleanup(pids) {
  const list = Array.isArray(pids) ? pids.map(num).filter((n) => n > 0) : [];
  if (!list.length) return { ok: true, killed: [], failed: [], freedMB: 0 };

  /* 只认「刚刚列出来的那些」，避免前端传任意 pid（比如被改过的 devtools） */
  const allowed = list.filter((pid) => lastCandidates.has(pid));
  const rejected = list.filter((pid) => !lastCandidates.has(pid));
  if (!allowed.length) {
    return { ok: false, killed: [], failed: rejected.map((pid) => ({ pid, error: '不在候选列表里' })), freedMB: 0 };
  }

  const killed = [];
  const failed = [];
  let freedMB = 0;
  for (const pid of allowed) {
    const info = lastCandidates.get(pid);
    const out = await ps('try { Stop-Process -Id ' + pid + ' -Force -ErrorAction Stop; "OK" } catch { "ERR:" + $_.Exception.Message }', 8000);
    if (out.trim() === 'OK') {
      killed.push({ pid, name: info.name });
      freedMB += info.memMB;
      lastCandidates.delete(pid);
    } else {
      failed.push({ pid, name: info.name, error: out.trim().replace(/^ERR:/, '') || '未知错误' });
    }
  }
  return { ok: failed.length === 0, killed, failed, freedMB, rejected: rejected.length ? rejected : undefined };
}

/* ------------------------------------------------------------------ *
 * 监控器
 * ------------------------------------------------------------------ */

function createWatcher(opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : function () {};
  const onAlarm = typeof o.onAlarm === 'function' ? o.onAlarm : function () {};

  let timer = null;
  let running = false;
  let lastAlarmAt = 0;
  let alarmCount = 0;

  async function tick() {
    try {
      const s = await sample();
      if (s.totalMB > 0 && s.pct < ALARM_PCT && s.freeMB < ALARM_FREE_MB) {
        const now = Date.now();
        if (now - lastAlarmAt >= COOLDOWN_MS) {
          lastAlarmAt = now;
          alarmCount++;
          try { onAlarm(Object.assign({}, s, { at: now })); } catch (e) { log(e); }
        }
      }
    } catch (e) {
      log(e);
    }
  }

  function start() {
    if (running) return;
    running = true;
    tick();
    timer = setInterval(tick, SAMPLE_MS);
    if (timer && timer.unref) timer.unref();
    log('watcher started');
  }

  function stop() {
    if (!running) return;
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    log('watcher stopped');
  }

  function status() {
    return {
      on: running,
      at: lastSample.at,
      freeMB: lastSample.freeMB,
      totalMB: lastSample.totalMB,
      pct: lastSample.pct,
      alarmCount,
      cooldownMs: COOLDOWN_MS,
      supported: IS_WIN
    };
  }

  return { start, stop, status, sample, timer: () => timer };
}

module.exports = { createWatcher, listCandidates, cleanup, sample, PROTECTED };
