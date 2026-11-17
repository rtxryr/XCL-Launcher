"use strict";
/**
 * 桌面桥接层公共出口。
 *
 * 桥接层不监听任何端口，仅做进程内 IPC 分发：宿主（Electron/Tauri 主进程）
 * 把渲染进程的调用转给 `DesktopBridge.handle()`，把后端事件转给 `attachEmitter()`。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRIDGE_EVENT_PREFIX = exports.BRIDGE_INVOKE_CHANNEL = exports.attachPreloadExample = exports.PRELOAD_TEMPLATE = exports.toFriendlyError = exports.BRIDGE_CHANNELS = exports.DesktopBridge = void 0;
var bridge_1 = require("./bridge");
Object.defineProperty(exports, "DesktopBridge", { enumerable: true, get: function () { return bridge_1.DesktopBridge; } });
Object.defineProperty(exports, "BRIDGE_CHANNELS", { enumerable: true, get: function () { return bridge_1.BRIDGE_CHANNELS; } });
Object.defineProperty(exports, "toFriendlyError", { enumerable: true, get: function () { return bridge_1.toFriendlyError; } });
var preload_1 = require("./preload");
Object.defineProperty(exports, "PRELOAD_TEMPLATE", { enumerable: true, get: function () { return preload_1.PRELOAD_TEMPLATE; } });
Object.defineProperty(exports, "attachPreloadExample", { enumerable: true, get: function () { return preload_1.attachPreloadExample; } });
Object.defineProperty(exports, "BRIDGE_INVOKE_CHANNEL", { enumerable: true, get: function () { return preload_1.BRIDGE_INVOKE_CHANNEL; } });
Object.defineProperty(exports, "BRIDGE_EVENT_PREFIX", { enumerable: true, get: function () { return preload_1.BRIDGE_EVENT_PREFIX; } });
//# sourceMappingURL=index.js.map