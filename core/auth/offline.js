"use strict";
/**
 * 离线账号：无需联网验证，用玩家名生成占位令牌。
 * 单人游戏完全正常，需要验证的服务器会拒绝（这是预期）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOfflineAccount = createOfflineAccount;
const account_1 = require("./account");
function createOfflineAccount(username) {
    return {
        id: "",
        type: "offline",
        username,
        uuid: (0, account_1.offlineUuid)(username),
        accessToken: "0", // 离线占位令牌
        userType: "legacy",
        meta: {},
    };
}
//# sourceMappingURL=offline.js.map