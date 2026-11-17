# 参与贡献

欢迎提 Issue 和 Pull Request。

## 流程

1. Fork 本仓库，从 `main` 建一个功能分支：`git checkout -b feat/xxx`。
2. 按 [构建与打包](docs/BUILD.md) 配置依赖镜像并安装。
3. 改动后先 `npm start` 跑一遍，确认主流程没有回归。
4. 提交信息用简短的中文或英文祈使句，例如 `修复设置分栏滚动串位`、`add ring progress updater`。
5. 提 PR 时说明改了什么、怎么验证的，涉及界面请附截图。

## 前端改动

`ui/index.html` 是主体，界面增量一律放在 `ui/patch/` 的外挂补丁里，按 [补丁规范](docs/PATCHES.md) 编号。不要直接把新功能堆进主文件——补丁可被单独禁用，也方便排查冲突。

## 后端改动

`core/` 是编译产物，改后端请修改 `fusionmc-core` 源码仓库后重新执行 `node scripts/prepare.mjs`。`core-extra/` 里的文件不会被构建脚本清空，只能放确实需要随包分发的补充模块。

## 不要提交

- `node_modules/`、`release/`、`release2/` 等构建产物与依赖
- 日志、崩溃转储、`*.bak-*` 备份文件
- 本机路径、令牌、邀请码等环境相关信息
