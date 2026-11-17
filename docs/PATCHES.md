# 前端补丁规范

`ui/patch/` 里的每个文件是一段独立的前端增量，按文件名前缀的**数值**顺序加载。主文件 `ui/index.html` 只负责引用列表，不内联这些逻辑。

## 命名

```
<编号>-<简短名称>.js
10-restore-default.js
230-radius.js
240-account.js
```

编号必须留空档（10、20、25……），方便在中间插入新补丁而不用整体重排。

## 加载顺序

`ui/index.html` 中的引用块按数字排序，**不能按字典序**——字典序会把 `100-*` 排到 `20-*` 前面。重建引用时用：

```js
files.sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
```

## 三个约束

1. **幂等守卫**：补丁可能被重复注入（预览页、热重载），开头写 `if (window.__xclPatchN) return; window.__xclPatchN = 1;`。
2. **样式唯一 id**：插入 `<style>` 时固定用 `id="patch-N-style"`，先移除旧节点再插入，避免反复叠加。
3. **命名前缀**：该补丁新增的 class / id 统一用 `mN-` 前缀，避免和其它补丁撞名。

## 性能

- 动画只改 `transform` 和 `opacity`；不要动 `width`、`top`、`box-shadow` 这类会触发布局/重绘的属性。
- `will-change` 只在动画期间加，动画结束立刻删。
- 尊重 `html[data-motion="off"]` 和 `prefers-reduced-motion`：关动效时元素要静止可见，不是消失。

## 验证

改动后至少检查：

- 所有补丁 `node --check` 通过；
- `ui/index.html` 内联脚本语法通过；
- 预览页能加载完所有补丁且控制台 0 报错；
- 新增 DOM 在圆角为 0 / 22 / 40 三档下都不溢出。
