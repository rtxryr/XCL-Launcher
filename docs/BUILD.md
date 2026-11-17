# 构建与打包

## 环境

- Windows 10 / 11 x64
- Node.js 18+
- npm

Electron 和 electron-builder 的二进制默认从国外源下载，国内网络建议设置镜像：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install --no-audit --no-fund
```

若 `node_modules/electron/dist/` 不存在，补一次：

```bash
node node_modules/electron/install.js
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 准备资源后启动开发版 |
| `npm run prepare:assets` | 编译 / 复制资源，不打包 |
| `npm run pack:dir` | 目录版（绿色）→ `release2/win-unpacked/` |
| `npm run dist` | NSIS 安装包 → `release2/X-Craft-Launcher-Setup-<version>.exe` |

## prepare 做了什么

1. 在 `../fusionmc-core` 执行构建（dist 比 src 新则跳过）；
2. 清空 `core/` 后复制 dist（排除 `*.map`），再把 `core-extra/` 覆盖回去；
3. 复制 core 的运行时依赖；
4. **默认保留现有 `ui/index.html`，不覆盖**。只有文件不存在或显式指定 `UI_HTML` 时才从外部复制前端；
5. 同步窗口图标。

第 4 条是刻意设计的：早期版本每次 prepare 都把 `ui/index.html` 覆盖回旧前端，导致更新日志、版本号和补丁引用全部丢失。不要恢复成无条件复制。

## 打包入口

只用 `scripts/pack-eb.cjs`，不要直接调 `npx electron-builder`。它会：

- 清掉 `ELECTRON_RUN_AS_NODE`、`NODE_OPTIONS` 等污染环境变量；
- 处理 `fs.cpSync` 在本机的兼容问题；
- 输出目录被占用时自动换用带时间戳的新目录，避免静默卡死。

## 常见坑

- **启动即报找不到模块**：检查 `electron-builder.yml` 的 `files` 是否漏了主进程 `require` 的本地模块，以及该模块是否在 `core-extra/` 中。
- **更新器窗口按钮文字乱码**：生成的 PowerShell 脚本必须带 UTF-8 BOM，PowerShell 5.1 读无 BOM 文件会按 ANSI 解析中文。
- **圆环进度闪**：不要在 WinForms 里叠加 Label + Panel 定时重绘；用双缓冲自绘控件，并且只在百分比数值变化时 `Invalidate()`。
- **打包后更新不生效**：新模块必须写进 `electron-builder.yml` 的 `files`，否则 asar 里没有。
