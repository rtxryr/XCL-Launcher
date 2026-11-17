"use strict";
/**
 * 一键开服务器模块 —— 公共出口。
 * 参考 VersePC（GPL-3.0）实现思路。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeServerName = exports.requiredJavaMajor = exports.detectLaunchKindFromFiles = exports.renderServerProperties = exports.serverPropertiesDefaults = exports.ServerHost = void 0;
var host_1 = require("./host");
Object.defineProperty(exports, "ServerHost", { enumerable: true, get: function () { return host_1.ServerHost; } });
Object.defineProperty(exports, "serverPropertiesDefaults", { enumerable: true, get: function () { return host_1.serverPropertiesDefaults; } });
Object.defineProperty(exports, "renderServerProperties", { enumerable: true, get: function () { return host_1.renderServerProperties; } });
Object.defineProperty(exports, "detectLaunchKindFromFiles", { enumerable: true, get: function () { return host_1.detectLaunchKindFromFiles; } });
Object.defineProperty(exports, "requiredJavaMajor", { enumerable: true, get: function () { return host_1.requiredJavaMajor; } });
Object.defineProperty(exports, "sanitizeServerName", { enumerable: true, get: function () { return host_1.sanitizeServerName; } });
//# sourceMappingURL=index.js.map