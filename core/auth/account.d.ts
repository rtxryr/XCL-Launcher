/**
 * 账号模型与存储。
 * 支持离线、Microsoft（正版）、Yggdrasil（第三方皮肤站，如 ely.by / littleskin.cn）三类。
 * 启动时只需 username / uuid / accessToken / userType 四要素。
 */
import { Logger } from "../core/logger";
export type AccountType = "offline" | "microsoft" | "yggdrasil";
export interface Account {
    id: string;
    type: AccountType;
    /** 玩家名 */
    username: string;
    /** 无连字符 UUID（Minecraft 用） */
    uuid: string;
    /** 访问令牌；离线为占位 */
    accessToken: string;
    /** 进游戏的 --userType：msa / mojang / legacy */
    userType: "msa" | "mojang" | "legacy";
    /** Microsoft：刷新令牌与过期时间 */
    refreshToken?: string;
    expiresAt?: number;
    /** Yggdrasil：认证服务器地址 */
    authServer?: string;
    /** Xbox/Minecraft 令牌关联信息 */
    meta?: Record<string, unknown>;
}
/** 进游戏需要的最小身份。 */
export interface LaunchIdentity {
    username: string;
    uuid: string;
    accessToken: string;
    userType: "msa" | "mojang" | "legacy";
}
export declare function toIdentity(acc: Account): LaunchIdentity;
/** 由玩家名生成离线 UUID（Mojang 离线名 → UUID 的 md8 变体）。 */
export declare function offlineUuid(username: string): string;
/** 账号持久化管理。 */
export declare class AccountStore {
    private dataDir;
    private log;
    private accounts;
    private path;
    constructor(dataDir: string, log: Logger);
    load(): Promise<void>;
    save(): Promise<void>;
    list(): Account[];
    get(id: string): Account | undefined;
    add(acc: Omit<Account, "id"> & {
        id?: string;
    }): Account;
    remove(id: string): boolean;
    update(id: string, patch: Partial<Account>): Account | undefined;
}
//# sourceMappingURL=account.d.ts.map