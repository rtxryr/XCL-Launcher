"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachPreloadExample = exports.PRELOAD_TEMPLATE = exports.BRIDGE_EVENT_PREFIX = exports.BRIDGE_INVOKE_CHANNEL = void 0;
/** 渲染进程 → 主进程的调用通道（与 bridge.ts / 主进程必须一致）。 */
exports.BRIDGE_INVOKE_CHANNEL = "fmbridge:invoke";
/** 主进程 → 渲染进程的事件通道前缀（完整通道为 `fmbridge:event:<event>`）。 */
exports.BRIDGE_EVENT_PREFIX = "fmbridge:event:";
/** 可直接写入 Electron `preload.js` 的 CommonJS 源码。 */
exports.PRELOAD_TEMPLATE = `"use strict";
/**
 * FusionMC 桌面桥接 preload（CommonJS）。
 *
 * 由 Electron 主进程以 \`webPreferences.preload\` 加载；在开启 contextIsolation 的前提下，
 * 只把「调用」与「事件订阅」两个最小能力暴露给渲染进程，不透出 Node/IPC 原始对象。
 *
 *   const { ok, data, error } = await window.FMBridge.invoke("server:list");
 *   const off = window.FMBridge.on("progress", (p) => console.log(p.phase, p.current, p.total));
 *   off(); // 取消订阅
 */

const { contextBridge, ipcRenderer } = require("electron");

const INVOKE_CHANNEL = "fmbridge:invoke";
const EVENT_PREFIX = "fmbridge:event:";

contextBridge.exposeInMainWorld("FMBridge", {
  /** 标记：渲染进程可用它做能力探测（浏览器里调试时为 undefined）。 */
  available: true,

  /**
   * 调用桥接层的某个通道。
   * @param {string} channel 通道名，如 "server:list"
   * @param {unknown} [payload] 载荷（对象）
   * @returns {Promise<{ ok: boolean, data?: unknown, error?: string }>}
   */
  invoke: (channel, payload) => ipcRenderer.invoke(INVOKE_CHANNEL, channel, payload),

  /**
   * 订阅主进程转发的事件（progress / log / gameOutput / gameExit / peer / peerStatus ...）。
   * @param {string} event 事件名
   * @param {(data: unknown) => void} cb 回调
   * @returns {() => void} 取消订阅
   */
  on: (event, cb) => {
    const name = EVENT_PREFIX + event;
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.removeListener(name, listener);
  },
});
`;
/**
 * 主进程侧接线示例（说明性字符串，非可执行代码）。
 *
 * 演示：注册 invoke 分发、转发事件、进度 sink、退出时清理。
 */
exports.attachPreloadExample = `// —— Electron 主进程（main.js）——
const { app, BrowserWindow, ipcMain } = require("electron");
const { DesktopBridge } = require("fusionmc-core/dist/desktop"); // 或 dist/desktop/bridge
const { FusionBackend } = require("fusionmc-core");

// 1) 建桥接层（进程内，不监听端口）
const backend = new FusionBackend({});
await backend.init();
const bridge = new DesktopBridge({ backend });

// 2) 渲染进程 → 主进程：一条 invoke 通道分发到所有子通道
ipcMain.handle("fmbridge:invoke", (_event, channel, payload) => bridge.handle(channel, payload));

// 3) 主进程 → 渲染进程：后端事件 + 下载进度
const win = new BrowserWindow({
  webPreferences: {
    preload: require("path").join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
  },
});
const emitToWin = (event, data) => {
  if (!win.isDestroyed()) win.webContents.send("fmbridge:event:" + event, data);
};
const detach = bridge.attachEmitter(emitToWin);
bridge.setProgressSink(emitToWin);

// 4) 退出时收尾（停掉红石/Terracotta 会话，避免残留进程）
app.on("before-quit", async () => {
  detach();
  await bridge.dispose();
});

// —— 渲染进程 ——
// const { ok, data, error } = await window.FMBridge.invoke("server:create", { name: "好友服", versionId: "1.21.4", port: 25565 });
// const list = await window.FMBridge.invoke("server:list");
// const off = window.FMBridge.on("progress", (p) => console.log(p));
`;
//# sourceMappingURL=preload.js.map