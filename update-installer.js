'use strict';
/**
 * 安装程序式更新（installer-based update）。
 *
 * 与旧的「下载 zip → 解压覆盖」相比，这条链路更贴近用户直觉：
 *   点「重启并更新」→ 下载官方安装程序 → 主程序退出 → 安装程序静默安装 → 自动打开新版本。
 *
 * 为什么要单独的「更新器」而不是直接跑安装包：
 *   安装程序要替换安装目录里的 exe / dll，只要还有一个进程占着这些文件就会失败；
 *   而「显示进度的窗口」本身如果是 Electron 主程序，它同样占着 exe。
 *   所以这里用系统自带的 Windows PowerShell + WinForms 画一个窗口，
 *   它跑在 powershell.exe 里，不占用安装目录的任何文件，主程序可以放心退出。
 *
 * 关于「不闪」（2026-11-16 重做，勿改回 Label 叠加）：
 *   最初用 Label 显示百分比、Panel 显示横条，每 250ms 改一次文字 →
 *   子控件各自擦背景重画，在任何机器上都会闪。
 *   现在改成：一个 C# 编译出来的自定义控件（Control 子类），
 *   SetStyle(AllPaintingInWmPaint | OptimizedDoubleBuffer | UserPaint)，
 *   整个圆环和百分比都在同一张内存位图上画完再一次性贴到屏幕，物理上不可能闪。
 *   万一某台机器禁用了 Add-Type 编译，会自动回退到「窗体自绘」：
 *   同样是一个双缓冲表面，只是少一层控件，仍然不闪。
 *
 * 约束：
 *   - 不引入任何外部依赖（WinForms 是系统组件）；
 *   - 窗口只显示「正在更新」+ 圆环百分比 + 一句提示，不暴露文件名/命令/日志；
 *   - 静默安装用 NSIS 的 /S；安装目录交给安装包自己按注册表决定（与上次安装一致）；
 *   - 全程写日志到 %TEMP%\xcl-installer-update.log，出问题能查，但不展示给用户。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** 安装程序在官网上的 slug（db 里 s_xcl_0002 的 slug）。 */
const SETUP_SLUG = 'xcraft-launcher-setup';

/** 等待主进程退出的宽限时间；超时由更新器强制结束。 */
const WAIT_APP_SEC = 20;

function psQuote(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
}

/**
 * 生成更新器脚本。
 * @param {object} o
 *   setup    {string} 安装程序绝对路径
 *   dest     {string} 当前安装目录（装完在这里找 exe）
 *   exeName  {string} 主程序文件名
 *   appPid   {number} 主进程 PID（等它退出）
 *   version  {string} 目标版本（只写日志）
 */
function buildUpdaterScript(o) {
  const setup = psQuote(o.setup);
  const dest = psQuote(o.dest);
  const exeName = psQuote(o.exeName || 'X Craft Launcher.exe');
  const appPid = Number(o.appPid) || 0;
  const version = psQuote(o.version || '');

  return `param()
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Script:Setup   = ${setup}
$Script:Dest    = ${dest}
$Script:ExeName = ${exeName}
$Script:AppPid  = ${appPid}
$Script:WantVer = ${version}
$Script:WaitSec = ${WAIT_APP_SEC}
$Script:Log     = Join-Path $env:TEMP 'xcl-installer-update.log'

function Write-Log([string]$m) {
  try { Add-Content -Path $Script:Log -Value ("[" + (Get-Date -Format 'HH:mm:ss') + "] " + $m) -Encoding UTF8 } catch {}
}

Write-Log ("updater start; setup=" + $Script:Setup + "; dest=" + $Script:Dest + "; pid=" + $Script:AppPid + "; ver=" + $Script:WantVer)

# ================= 圆环进度控件（C# 自定义控件，双缓冲自绘） =================
$Script:HasRing = $false
$ringCode = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

public class XclRing : Control
{
    private int _pct;
    public int Percent
    {
        get { return _pct; }
        set
        {
            int v = value;
            if (v < 0) v = 0;
            if (v > 100) v = 100;
            if (_pct != v) { _pct = v; Invalidate(); }
        }
    }

    public XclRing()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
               | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        DoubleBuffered = true;
        BackColor = Color.FromArgb(15, 19, 25);
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        e.Graphics.Clear(BackColor);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.Clear(BackColor);

        int size = Math.Min(Width, Height);
        float thick = Math.Max(9f, size * 0.082f);
        float pad = thick / 2f + 1f;
        RectangleF rect = new RectangleF(pad, pad, size - pad * 2f, size - pad * 2f);

        using (Pen bg = new Pen(Color.FromArgb(42, 50, 62), thick))
        {
            bg.StartCap = LineCap.Round;
            bg.EndCap = LineCap.Round;
            g.DrawArc(bg, rect, 0f, 359.9f);
        }

        if (_pct > 0)
        {
            using (Pen fg = new Pen(Color.FromArgb(84, 230, 176), thick))
            {
                fg.StartCap = LineCap.Round;
                fg.EndCap = LineCap.Round;
                g.DrawArc(fg, rect, -90f, 359.9f * _pct / 100f);
            }
        }

        string txt = _pct.ToString() + "%";
        using (Font f = new Font("Microsoft YaHei UI", size * 0.2f, FontStyle.Bold, GraphicsUnit.Pixel))
        using (StringFormat sf = new StringFormat())
        {
            sf.Alignment = StringAlignment.Center;
            sf.LineAlignment = StringAlignment.Center;
            using (SolidBrush br = new SolidBrush(Color.White))
            {
                g.DrawString(txt, f, br, new RectangleF(0, 0, Width, Height), sf);
            }
        }
    }
}
'@

try {
  if (-not ('XclRing' -as [type])) {
    try {
      Add-Type -TypeDefinition $ringCode -ErrorAction Stop
    } catch {
      Add-Type -TypeDefinition $ringCode -ReferencedAssemblies @('System.Drawing.dll', 'System.Windows.Forms.dll') -ErrorAction Stop
    }
  }
  $Script:HasRing = $true
} catch {
  Write-Log ('ring compile failed: ' + $_.Exception.Message)
  $Script:HasRing = $false
}

# ================= 窗口 =================
$W = 420
$H = 300
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.ClientSize = New-Object System.Drawing.Size($W, $H)
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 19, 25)
$form.TopMost = $true
$form.ShowInTaskbar = $true
$form.Text = '正在更新'
$form.DoubleBuffered = $true
$Script:Form = $form

# 圆角窗（只设一次，重绘时不动它，避免边缘抖动）
$round = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 18
$round.AddArc(0, 0, $r, $r, 180, 90)
$round.AddArc($W - $r, 0, $r, $r, 270, 90)
$round.AddArc($W - $r, $H - $r, $r, $r, 0, 90)
$round.AddArc(0, $H - $r, $r, $r, 90, 90)
$round.CloseFigure()
$form.Region = New-Object System.Drawing.Region($round)

# 标题（静态文本，画一次不再重绘）
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = '正在更新'
$lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(148, 158, 170)
$lblTitle.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10.5)
$lblTitle.AutoSize = $false
$lblTitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$lblTitle.BackColor = [System.Drawing.Color]::Transparent
$lblTitle.Size = New-Object System.Drawing.Size($W, 22)
$lblTitle.Location = New-Object System.Drawing.Point(0, 26)
$form.Controls.Add($lblTitle)

# 圆环
$Script:Pct = 0
$Script:RingRect = New-Object System.Drawing.Rectangle(126, 58, 168, 168)
if ($Script:HasRing) {
  $ring = New-Object XclRing
  $ring.Size = New-Object System.Drawing.Size(168, 168)
  $ring.Location = New-Object System.Drawing.Point(126, 58)
  $form.Controls.Add($ring)
  $Script:Ring = $ring
} else {
  # 回退：直接画在双缓冲窗体上（同样不会闪）
  $form.Add_Paint({
    param($s, $e)
    $g = $e.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $rc = $Script:RingRect
    $size = [Math]::Min($rc.Width, $rc.Height)
    $thick = [Math]::Max(9, [int]($size * 0.082))
    $pad = [int]($thick / 2) + 1
    $rr = New-Object System.Drawing.RectangleF(($rc.X + $pad), ($rc.Y + $pad), ($size - $pad * 2), ($size - $pad * 2))
    $penBg = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(42, 50, 62)), $thick
    $penBg.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $penBg.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($penBg, $rr, 0, 359.9)
    $penBg.Dispose()
    if ($Script:Pct -gt 0) {
      $penFg = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(84, 230, 176)), $thick
      $penFg.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $penFg.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $g.DrawArc($penFg, $rr, -90, (359.9 * $Script:Pct / 100))
      $penFg.Dispose()
    }
    $font = New-Object System.Drawing.Font('Microsoft YaHei UI', [float]($size * 0.2), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sfmt = New-Object System.Drawing.StringFormat
    $sfmt.Alignment = [System.Drawing.StringAlignment]::Center
    $sfmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString(([string]$Script:Pct + '%'), $font, [System.Drawing.Brushes]::White, $rc, $sfmt)
    $font.Dispose()
  })
}

# 底部提示（用户指定文案，一字不改）
$lblTip = New-Object System.Windows.Forms.Label
$lblTip.Text = '更新正在进行，完成后会自动进入应用'
$lblTip.ForeColor = [System.Drawing.Color]::FromArgb(108, 118, 132)
$lblTip.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9.5)
$lblTip.AutoSize = $false
$lblTip.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$lblTip.BackColor = [System.Drawing.Color]::Transparent
$lblTip.Size = New-Object System.Drawing.Size($W, 20)
$lblTip.Location = New-Object System.Drawing.Point(0, 246)
$form.Controls.Add($lblTip)

function Set-Pct([int]$v) {
  if ($v -lt $Script:Pct) { return }
  $p = [Math]::Min(100, $v)
  if ($p -eq $Script:Pct) { return }
  $Script:Pct = $p
  if ($Script:HasRing -and $Script:Ring) {
    $Script:Ring.Percent = $p
  } else {
    $Script:Form.Invalidate($Script:RingRect)
  }
}

# 无边框窗口拖动
$Script:Drag = $false
$Script:DragPt = New-Object System.Drawing.Point(0, 0)
$form.Add_MouseDown({ param($s, $e) $Script:Drag = $true; $Script:DragPt = $e.Location })
$form.Add_MouseMove({ param($s, $e) if ($Script:Drag) { $form.Left += ($e.X - $Script:DragPt.X); $form.Top += ($e.Y - $Script:DragPt.Y) } })
$form.Add_MouseUp({ param($s, $e) $Script:Drag = $false })

# ================= 主循环 =================
# 不用 .NET Timer：PowerShell 里 Timer 事件在某些机器上会静默不触发（实测卡在 0%）。
# 改成手动泵消息（DoEvents）+ 同一个循环里推进状态机，任何环境都稳定。
$Script:Stage = 0
$Script:T0 = Get-Date
$Script:StageAt = Get-Date
$Script:Proc = $null
$Script:Done = $false

$form.Show()
[System.Windows.Forms.Application]::DoEvents()

while (-not $Script:Done) {
  [System.Windows.Forms.Application]::DoEvents()
  try {
    switch ($Script:Stage) {
      0 {
        # 等主程序退出；超过宽限期强制结束，避免安装程序写文件失败
        $alive = $false
        if ($Script:AppPid -gt 0) {
          $p = Get-Process -Id $Script:AppPid -ErrorAction SilentlyContinue
          if ($p) { $alive = $true }
        }
        if ($alive) {
          $waited = ((Get-Date) - $Script:T0).TotalSeconds
          Set-Pct ([int]([Math]::Min(7, 1 + $waited)))
          if ($waited -gt $Script:WaitSec) {
            Write-Log 'app still alive; force stop'
            Stop-Process -Id $Script:AppPid -Force -ErrorAction SilentlyContinue
          }
        } else {
          Set-Pct 8
          Write-Log 'launching setup /S'
          $Script:Proc = Start-Process -FilePath $Script:Setup -ArgumentList '/S --updated' -PassThru -WindowStyle Hidden
          $Script:Stage = 1
          $Script:T0 = Get-Date
        }
      }
      1 {
        # 安装中：按时间平滑推进到 90%，等安装进程自己结束
        $el = ((Get-Date) - $Script:T0).TotalSeconds
        Set-Pct (8 + [int]([Math]::Min(82, $el * 1.8)))
        # 兜底：安装程序卡住或没起来也不要把窗口挂在 90% 不动，5 分钟转失败分支
        if ($el -gt 300) {
          Write-Log 'setup timeout'
          $Script:Stage = 9
          $Script:StageAt = Get-Date
        }
        if ($Script:Proc -ne $null -and $Script:Proc.HasExited) {
          Write-Log ('setup exit code=' + $Script:Proc.ExitCode)
          if ($Script:Proc.ExitCode -eq 0 -or $Script:Proc.ExitCode -eq 3010) {
            Set-Pct 93
            $Script:Stage = 2
            $Script:StageAt = Get-Date
          } else {
            $Script:Stage = 9
            $Script:StageAt = Get-Date
          }
        }
      }
      2 {
        Set-Pct 96
        $exe = Join-Path $Script:Dest $Script:ExeName
        if (-not (Test-Path $exe)) {
          $alt = Join-Path $env:LOCALAPPDATA ('Programs\\X Craft Launcher\\' + $Script:ExeName)
          if (Test-Path $alt) { $exe = $alt }
        }
        Write-Log ('relaunch ' + $exe)
        if (Test-Path $exe) { Start-Process -FilePath $exe }
        Set-Pct 100
        $Script:Stage = 3
        $Script:StageAt = Get-Date
      }
      3 {
        if (((Get-Date) - $Script:StageAt).TotalMilliseconds -gt 900) { $Script:Done = $true }
      }
      9 {
        Set-Pct 100
        $lblTitle.Text = '更新没有完成'
        $lblTip.Text = '正在打开启动器，请在应用内重试'
        $Script:Stage = 10
        $Script:StageAt = Get-Date
        $exe = Join-Path $Script:Dest $Script:ExeName
        if (Test-Path $exe) { Start-Process -FilePath $exe }
      }
      10 {
        if (((Get-Date) - $Script:StageAt).TotalMilliseconds -gt 2600) { $Script:Done = $true }
      }
      default { $Script:Done = $true }
    }
  } catch {
    Write-Log ('loop error: ' + $_.Exception.Message)
    $Script:Done = $true
  }
  Start-Sleep -Milliseconds 120
}

$form.Close()
Write-Log 'updater end'

`;
}

/**
 * 启动更新器（后台，不阻塞）。
 * @returns {{ ok:boolean, script?:string, error?:string }}
 */
function launchUpdater(o) {
  try {
    const dir = path.join(os.tmpdir(), 'xcl-updater');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'update-' + Date.now() + '.ps1');
    // PowerShell 5.1 读无 BOM 的 UTF-8 会把中文读成乱码，必须带 BOM
    fs.writeFileSync(file, '\ufeff' + buildUpdaterScript(o), 'utf8');

    const ps = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const child = spawn(
      ps,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    return { ok: true, script: file };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { SETUP_SLUG, buildUpdaterScript, launchUpdater };
