# X Craft Launcher

> 把折腾，留给启动器。把世界，留给你。

[![version](https://img.shields.io/badge/version-1.1.5-54E6B0?style=flat-square)](https://github.com/XCL-Launcher/XCL-Launcher/releases)
[![platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-70D6FF?style=flat-square)](#)
[![license](https://img.shields.io/badge/license-MIT-A68CF9?style=flat-square)](LICENSE)

一个 Windows 上的 Minecraft 启动器。把版本管理、依赖下载、Java 匹配、账号、联机和开服收进同一个窗口——选一个版本，然后走进世界。

本项目目前处于**公测阶段**，安装包未购买代码签名证书，首次运行可能触发 SmartScreen 提示。

---

## 功能亮点

### 版本与下载
- 正式版 / 快照 / Forge / Fabric 统一列表，支持搜索、排序、后台下载
- 多镜像测速择优、分片下载、断点续传，落地前逐个 SHA-1 校验
- 并发线程数跟随设备性能自动取值，被限流会自动降速补一轮
- assets、libraries、natives 一次下齐；按版本自动匹配并安装 Java 运行时

### 一键开服
- 自动建目录、写 eula、按 GB 换算内存、拉起服务端
- 终端实时滚日志，以 `Done` 行为准判定真正启动完成
- 内存 / 在线人数 / TPS / 延迟同屏可见，`say` / `op` / `list` / `stop` 直接下发
- 磁盘上已有服务端就直接启动，不重复下载

### 界面与装扮
- 八套内置配色整站切换，第 8 套是自定义调色盘
- 像素风、毛玻璃、光晕流转独立开关，透明度 0～100 无级可调
- 界面圆角 0～40 实时跟随，卡片、按钮、输入框、头像统一曲率
- 首页装扮支持真 3D：方块分面建模、火把为杆 + 火焰、工具带厚度、人物分块

### 账号与联机
- 微软账号 8 位代码免密授权；离线账号只填用户名
- 多账号并列存放，一键切换，删除需二次确认；令牌只留本机
- 红石远程中继与虚拟局域网两条路，不需要公网 IP 或端口映射

### 性能与更新
- Super X 启动引擎按 Java 大版本门控，启动前自检，不通过只做调度
- 每 20 秒采样可用内存，低于阈值且持续紧张才提示，5 分钟冷却；系统进程与运行中的 Java 永不入列
- 「重启并更新」改为下载官方安装包，由独立窗口静默安装并自动重启应用，只显示圆环百分比
- 内测上报自动抹除令牌、邮箱、哈希与本机路径

---

## 下载与安装

正式发布包请到 **[Releases](https://github.com/XCL-Launcher/XCL-Launcher/releases)** 页面下载：

| 文件 | 说明 |
| --- | --- |
| `X-Craft-Launcher-Setup-<version>.exe` | NSIS 安装程序，推荐普通用户使用 |
| `xcl-<version>.7z` | 绿色版，解压即用 |

系统要求：Windows 10 / 11 64 位，8 GB 内存起（一键开服建议再多留 1–2 GB）。

如果打开时提示 “Windows 已保护你的电脑”，选择 **更多信息 → 仍要运行**。所有发布包都会校验 SHA-256。

---

## 从源码运行

需要 Node.js 18+ 与 npm。Electron 二进制较大，国内网络建议使用镜像：

```bash
git clone https://github.com/XCL-Launcher/XCL-Launcher.git
cd XCL-Launcher

export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

npm install --no-audit --no-fund
npm start
```

如果 `npm install` 后 `node_modules/electron/dist/` 不存在（二进制没下下来），单独补一次：

```bash
node node_modules/electron/install.js
```

## 打包

```bash
npm run pack:dir   # 目录版（绿色）→ release2/win-unpacked/
npm run dist       # NSIS 安装包 → release2/X-Craft-Launcher-Setup-<version>.exe
```

`scripts/pack-eb.cjs` 负责清理被污染的环境变量、处理 `fs.cpSync` 兼容性，并在输出目录被占用时自动换目录，避免静默卡死。详见 [docs/BUILD.md](docs/BUILD.md)。

---

## 目录结构

```
XCL-Launcher/
├── main.js                  # Electron 主进程：窗口、单实例、IPC、退出清理
├── preload.js               # contextBridge：window.FMBridge
├── update-service.js        # 更新检查 / 下载 / 校验 / 应用
├── update-installer.js      # 安装包式更新器窗口（双缓冲圆环进度）
├── electron-builder.yml     # 打包配置
├── ui/
│   ├── index.html           # 前端主体与应用内更新日志
│   └── patch/               # 36 个按编号加载的外挂补丁
├── core/                    # 编译后的后端与运行时依赖
├── core-extra/              # 构建脚本不会清掉的补充模块
├── scripts/
│   ├── prepare.mjs          # 构建前置：编译 / 复制资源
│   ├── pack-eb.cjs          # 打包入口
│   └── *.js / *.cjs         # 开发期验证与排障脚本
├── build/                   # 图标资源
└── docs/                    # 架构、构建、补丁规范
```

`ui/` 与 `core/` 同时是构建产物和开箱即用的前端 / 后端副本；仓库内保留它们，克隆后无需先构建另一个仓库即可打包。

---

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [构建与打包](docs/BUILD.md)
- [前端补丁规范](docs/PATCHES.md)
- [更新日志](CHANGELOG.md)
- [参与贡献](CONTRIBUTING.md)

## 免责声明

Minecraft 是 Mojang Studios 的商标。本项目与 Mojang Studios、Microsoft 没有隶属关系，也未获其背书。游戏本体资源在首次启动时从官方源下载，不随安装包分发。第三方组件（Electron / Chromium / Node.js / LWJGL / Fabric Loader / 7-Zip / Terracotta 等）按各自原许可证分发，见 [LICENSE-THIRD-PARTY.md](LICENSE-THIRD-PARTY.md)。

## 许可证

[MIT](LICENSE) © X Craft Launcher contributors
