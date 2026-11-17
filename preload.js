/**
 * X Craft Launcher 桌面版 preload（CommonJS）。
 *
 * 在 contextIsolation 开启的前提下，只把两个最小能力暴露给渲染进程：
 *   - window.FMBridge.invoke(channel, payload)  → 调用主进程的桥接通道
 *   - window.FMBridge.on(event, cb)             → 订阅主进程转发的后端事件
 *
 * 不暴露 ipcRenderer / require / process 等原始对象。
 * 本文件只允许 require('electron')。
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE_CHANNEL = 'fmbridge:invoke';
const EVENT_PREFIX = 'fmbridge:event:';

contextBridge.exposeInMainWorld('FMBridge', {
  /** 能力探测标记：桌面端为 true，纯浏览器里为 undefined。 */
  available: true,

  /**
   * 调用一个桥接通道。
   * @param {string} channel 通道名，如 "server:list"
   * @param {unknown} [payload] 载荷
   * @returns {Promise<{ ok: boolean, data?: unknown, error?: string }>}
   */
  invoke: (channel, payload) => ipcRenderer.invoke(INVOKE_CHANNEL, channel, payload),

  /**
   * 订阅事件。
   * @param {string} event 事件名，如 "progress" / "gameOutput"
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

/**
 * 无边框窗口控制（自定义标题栏用）。
 *
 * 只在桌面壳里存在；浏览器预览时 window.FMWindow 为 undefined，
 * 页面据此隐藏窗口按钮，不会出现"点了没反应"的死按钮。
 */
const WIN_CHANNEL = 'fmwin:control';

contextBridge.exposeInMainWorld('FMWindow', {
  available: true,

  /** 最小化 */
  minimize: () => ipcRenderer.invoke(WIN_CHANNEL, 'minimize'),

  /** 最大化 / 还原 */
  toggleMaximize: () => ipcRenderer.invoke(WIN_CHANNEL, 'toggle-maximize'),

  /** 关闭窗口（走正常退出流程，主进程会清理后端） */
  close: () => ipcRenderer.invoke(WIN_CHANNEL, 'close'),

  /**
   * 订阅最大化状态变化。
   * @param {(state: { maximized: boolean, fullscreen: boolean }) => void} cb
   * @returns {() => void} 取消订阅
   */
  onState: (cb) => {
    const name = EVENT_PREFIX + 'fmwin:state';
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.removeListener(name, listener);
  },
});

/**
 * 拖入文件的真实路径。
 *
 * Electron 32 起 File.path 被移除，渲染进程只能通过 webUtils.getPathForFile
 * 拿到磁盘路径（旧版本拿到的全是空串，表现为「拖进去没反应」）。
 * 只暴露这一个纯函数，不给渲染进程 require 能力。
 */
contextBridge.exposeInMainWorld('FMPath', {
  available: true,
  /** @param {File} file @returns {string} 绝对路径，取不到就返回空串 */
  forFile: (file) => {
    try {
      return (file && webUtils.getPathForFile(file)) || '';
    } catch (e) {
      return '';
    }
  },
});
