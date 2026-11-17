# 架构说明

## 进程模型

```
main.js (Electron 主进程)
  ├── preload.js → contextBridge 暴露 window.FMBridge
  │                  ├── invoke(channel, payload)  主进程能力调用
  │                  └── on(channel, cb)           主进程事件推送
  ├── BrowserWindow → ui/index.html + ui/patch/*.js（渲染进程）
  ├── core/          编译后的后端，进程内门面，不另起本地服务
  ├── update-service.js     更新检查 / 下载 / 校验 / 应用
  └── update-installer.js   独立更新器窗口的生成与启动
```

单实例锁避免重复启动。退出时统一清理联机服务与游戏子进程；更新退出使用 `app.exit(0)` 快速释放 exe / dll 占用，再交给更新脚本或更新器接管。

## 前端：主文件 + 外挂补丁

`ui/index.html` 提供页面骨架与基础样式，`ui/patch/<编号>-<名称>.js` 按顺序加载，每个补丁做一件独立的事（动效、皮肤、圆角、账号、通知、内测、内存优化等）。补丁靠 `window.__xclPatchN` 做幂等守卫，样式用唯一 `patch-N-style` id，类名统一 `mN-` 前缀。

详见 [补丁规范](PATCHES.md)。

## 后端：core 与 core-extra

`core/` 是 `fusionmc-core` 的编译产物及运行时依赖，包含认证、下载、实例、启动、元数据、多人联机、服务端与系统采样等模块。`scripts/prepare.mjs` 会先清空 `core/` 再复制 dist，因此**任何需要随包分发的补充模块都不能直接放在 `core/`**。

`core-extra/` 在 prepare 复制完成后覆盖进 `core/`，目前放 `diag.js`、`perf.js`、`zip.js`、`beta.js`、`memopt.js`、`superx.js`、`limits.js`。历史上因为漏掉 `diag.js`，打包后一启动就报 `Cannot find module './core/system/diag'`。

## 更新链路

`update-service.js` 检查更新时会同时查主包与同版本安装程序：

- 有同版本安装包 → 下载 Setup.exe → SHA-256 校验 → 生成 PowerShell 更新器脚本并拉起 → 主进程退出。
- 没有安装包信息 → 退回旧的「下载 7z → 解压覆盖 → 重启」链路。

更新器是独立的 PowerShell + WinForms 进程，不占用安装目录文件。窗口用双缓冲自绘圆环和百分比，等主进程 PID 消失后用 `/S --updated` 静默安装，最后自己拉起新版本。

## 性能约定

- 界面动效只改 `transform` / `opacity`，`will-change` 用完即删。
- `html[data-motion="off"]` 与 `prefers-reduced-motion` 下动效降级。
- 三维装扮全页共享一个离屏 WebGLRenderer，渲染结果 drawImage 回各卡片的 2D canvas；多个 renderer 会触发 “Too many active WebGL contexts”。
