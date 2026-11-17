/**
 * Electron preload 模板（纯字符串，不含任何 electron 依赖）。
 *
 * 用法：
 *  1. 主进程构建时把 `PRELOAD_TEMPLATE` 写到磁盘（例如 `<userData>/preload.js`，
 *     或打包时写入 `resources/preload.js`），并在 `BrowserWindow` 上设置：
 *       new BrowserWindow({ webPreferences: { preload, contextIsolation: true, nodeIntegration: false } })
 *  2. 主进程按 `attachPreloadExample` 里的说明注册 `ipcMain.handle("fmbridge:invoke", ...)`，
 *     并用 `bridge.attachEmitter()` 把后端事件推给渲染进程。
 *  3. 渲染进程即可使用 `window.FMBridge.invoke("server:list")` / `window.FMBridge.on("progress", cb)`。
 *
 * 说明：桥接层不监听任何端口，渲染进程 → 主进程只走 Electron 内置 IPC。
 */
/** 渲染进程 → 主进程的调用通道（与 bridge.ts / 主进程必须一致）。 */
export declare const BRIDGE_INVOKE_CHANNEL = "fmbridge:invoke";
/** 主进程 → 渲染进程的事件通道前缀（完整通道为 `fmbridge:event:<event>`）。 */
export declare const BRIDGE_EVENT_PREFIX = "fmbridge:event:";
/** 可直接写入 Electron `preload.js` 的 CommonJS 源码。 */
export declare const PRELOAD_TEMPLATE = "\"use strict\";\n/**\n * FusionMC \u684C\u9762\u6865\u63A5 preload\uFF08CommonJS\uFF09\u3002\n *\n * \u7531 Electron \u4E3B\u8FDB\u7A0B\u4EE5 `webPreferences.preload` \u52A0\u8F7D\uFF1B\u5728\u5F00\u542F contextIsolation \u7684\u524D\u63D0\u4E0B\uFF0C\n * \u53EA\u628A\u300C\u8C03\u7528\u300D\u4E0E\u300C\u4E8B\u4EF6\u8BA2\u9605\u300D\u4E24\u4E2A\u6700\u5C0F\u80FD\u529B\u66B4\u9732\u7ED9\u6E32\u67D3\u8FDB\u7A0B\uFF0C\u4E0D\u900F\u51FA Node/IPC \u539F\u59CB\u5BF9\u8C61\u3002\n *\n *   const { ok, data, error } = await window.FMBridge.invoke(\"server:list\");\n *   const off = window.FMBridge.on(\"progress\", (p) => console.log(p.phase, p.current, p.total));\n *   off(); // \u53D6\u6D88\u8BA2\u9605\n */\n\nconst { contextBridge, ipcRenderer } = require(\"electron\");\n\nconst INVOKE_CHANNEL = \"fmbridge:invoke\";\nconst EVENT_PREFIX = \"fmbridge:event:\";\n\ncontextBridge.exposeInMainWorld(\"FMBridge\", {\n  /** \u6807\u8BB0\uFF1A\u6E32\u67D3\u8FDB\u7A0B\u53EF\u7528\u5B83\u505A\u80FD\u529B\u63A2\u6D4B\uFF08\u6D4F\u89C8\u5668\u91CC\u8C03\u8BD5\u65F6\u4E3A undefined\uFF09\u3002 */\n  available: true,\n\n  /**\n   * \u8C03\u7528\u6865\u63A5\u5C42\u7684\u67D0\u4E2A\u901A\u9053\u3002\n   * @param {string} channel \u901A\u9053\u540D\uFF0C\u5982 \"server:list\"\n   * @param {unknown} [payload] \u8F7D\u8377\uFF08\u5BF9\u8C61\uFF09\n   * @returns {Promise<{ ok: boolean, data?: unknown, error?: string }>}\n   */\n  invoke: (channel, payload) => ipcRenderer.invoke(INVOKE_CHANNEL, channel, payload),\n\n  /**\n   * \u8BA2\u9605\u4E3B\u8FDB\u7A0B\u8F6C\u53D1\u7684\u4E8B\u4EF6\uFF08progress / log / gameOutput / gameExit / peer / peerStatus ...\uFF09\u3002\n   * @param {string} event \u4E8B\u4EF6\u540D\n   * @param {(data: unknown) => void} cb \u56DE\u8C03\n   * @returns {() => void} \u53D6\u6D88\u8BA2\u9605\n   */\n  on: (event, cb) => {\n    const name = EVENT_PREFIX + event;\n    const listener = (_e, data) => cb(data);\n    ipcRenderer.on(name, listener);\n    return () => ipcRenderer.removeListener(name, listener);\n  },\n});\n";
/**
 * 主进程侧接线示例（说明性字符串，非可执行代码）。
 *
 * 演示：注册 invoke 分发、转发事件、进度 sink、退出时清理。
 */
export declare const attachPreloadExample = "// \u2014\u2014 Electron \u4E3B\u8FDB\u7A0B\uFF08main.js\uFF09\u2014\u2014\nconst { app, BrowserWindow, ipcMain } = require(\"electron\");\nconst { DesktopBridge } = require(\"fusionmc-core/dist/desktop\"); // \u6216 dist/desktop/bridge\nconst { FusionBackend } = require(\"fusionmc-core\");\n\n// 1) \u5EFA\u6865\u63A5\u5C42\uFF08\u8FDB\u7A0B\u5185\uFF0C\u4E0D\u76D1\u542C\u7AEF\u53E3\uFF09\nconst backend = new FusionBackend({});\nawait backend.init();\nconst bridge = new DesktopBridge({ backend });\n\n// 2) \u6E32\u67D3\u8FDB\u7A0B \u2192 \u4E3B\u8FDB\u7A0B\uFF1A\u4E00\u6761 invoke \u901A\u9053\u5206\u53D1\u5230\u6240\u6709\u5B50\u901A\u9053\nipcMain.handle(\"fmbridge:invoke\", (_event, channel, payload) => bridge.handle(channel, payload));\n\n// 3) \u4E3B\u8FDB\u7A0B \u2192 \u6E32\u67D3\u8FDB\u7A0B\uFF1A\u540E\u7AEF\u4E8B\u4EF6 + \u4E0B\u8F7D\u8FDB\u5EA6\nconst win = new BrowserWindow({\n  webPreferences: {\n    preload: require(\"path\").join(__dirname, \"preload.js\"),\n    contextIsolation: true,\n    nodeIntegration: false,\n  },\n});\nconst emitToWin = (event, data) => {\n  if (!win.isDestroyed()) win.webContents.send(\"fmbridge:event:\" + event, data);\n};\nconst detach = bridge.attachEmitter(emitToWin);\nbridge.setProgressSink(emitToWin);\n\n// 4) \u9000\u51FA\u65F6\u6536\u5C3E\uFF08\u505C\u6389\u7EA2\u77F3/Terracotta \u4F1A\u8BDD\uFF0C\u907F\u514D\u6B8B\u7559\u8FDB\u7A0B\uFF09\napp.on(\"before-quit\", async () => {\n  detach();\n  await bridge.dispose();\n});\n\n// \u2014\u2014 \u6E32\u67D3\u8FDB\u7A0B \u2014\u2014\n// const { ok, data, error } = await window.FMBridge.invoke(\"server:create\", { name: \"\u597D\u53CB\u670D\", versionId: \"1.21.4\", port: 25565 });\n// const list = await window.FMBridge.invoke(\"server:list\");\n// const off = window.FMBridge.on(\"progress\", (p) => console.log(p));\n";
//# sourceMappingURL=preload.d.ts.map