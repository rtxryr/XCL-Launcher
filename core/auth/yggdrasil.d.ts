/**
 * Yggdrasil / Authlib-Injector 第三方认证（ely.by、littleskin.cn、自建皮肤站）。
 *
 * Authlib-Injector 约定：认证服务器根地址 + /authserver/authenticate 登录，
 * 令牌为 JWT，api 由服务端下发。进游戏时把 baseUrl 经 -javaagent 或
 * --userType 交给加载器；此处只负责换签出 username/uuid/accessToken。
 */
import { Logger } from "../core/logger";
import { Account } from "./account";
export interface YggdrasilProfile {
    id: string;
    name: string;
}
export declare class YggdrasilAuth {
    private baseUrl;
    private log;
    constructor(baseUrl: string, log: Logger);
    /** 用户名密码登录，返回账号。 */
    authenticate(username: string, password: string, clientToken?: string): Promise<Omit<Account, "id">>;
    /** 令牌刷新。 */
    refresh(accessToken: string, clientToken: string): Promise<{
        accessToken: string;
    }>;
    /** 校验令牌有效性。 */
    validate(accessToken: string): Promise<boolean>;
}
//# sourceMappingURL=yggdrasil.d.ts.map