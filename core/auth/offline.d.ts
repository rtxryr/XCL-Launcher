/**
 * 离线账号：无需联网验证，用玩家名生成占位令牌。
 * 单人游戏完全正常，需要验证的服务器会拒绝（这是预期）。
 */
import { Account } from "./account";
export declare function createOfflineAccount(username: string): Account;
//# sourceMappingURL=offline.d.ts.map