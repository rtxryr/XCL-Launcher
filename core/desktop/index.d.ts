/**
 * 桌面桥接层公共出口。
 *
 * 桥接层不监听任何端口，仅做进程内 IPC 分发：宿主（Electron/Tauri 主进程）
 * 把渲染进程的调用转给 `DesktopBridge.handle()`，把后端事件转给 `attachEmitter()`。
 */
export { DesktopBridge, BRIDGE_CHANNELS, toFriendlyError, } from "./bridge";
export type { BridgeChannel, BridgeOptions, BridgeResult, BridgeTransportLike, ServerListItem, } from "./bridge";
export { PRELOAD_TEMPLATE, attachPreloadExample, BRIDGE_INVOKE_CHANNEL, BRIDGE_EVENT_PREFIX, } from "./preload";
//# sourceMappingURL=index.d.ts.map