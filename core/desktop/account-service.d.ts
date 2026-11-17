/**
 * 账号服务：正版设备码登录 + 离线账号，令牌与活动账号本地持久化。
 *
 * 放在桌面桥接层，是因为「登录要展示设备码、失败要弹提示」本身就是 UI 交互，
 * 由宿主进程内的 AccountService 直接推事件给渲染进程最省事：
 *   - 账号列表/活动账号落盘在 `<dataDir>/accounts.json` 与 `<dataDir>/active-account.json`；
 *   - Microsoft 登录走 OAuth 设备码：先同步返回 user_code，再后台轮询换签；
 *   - 所有异步进度只通过构造时注入的 `onEvent` 回调发出（不直接依赖 EventBus）。
 */
import { Logger } from "../core/logger";
import type { LaunchIdentity } from "../auth/account";
/** 给渲染进程的账号视图（不含令牌等敏感字段）。 */
export interface AccountView {
    id: string;
    type: "offline" | "microsoft" | "yggdrasil";
    username: string;
    uuid: string;
    /** 头像用：微软账号给皮肤站 URL，离线用 crafatar/dicebear 之类（自己拼，不请求） */
    avatarUrl?: string;
    /** 是否已过期（microsoft 且 expiresAt < now） */
    expired?: boolean;
}
/** 设备码视图：前端据此提示用户「打开网址 + 输入代码」。 */
export interface DeviceCodeView {
    userCode: string;
    verificationUri: string;
    /** 秒 */
    expiresIn: number;
    intervalSec: number;
}
export interface AccountServiceOptions {
    /** 数据目录，账号存这里 */
    dataDir: string;
    log?: Logger;
    /** Microsoft OAuth client_id，默认用内置的公开启动器 client_id */
    clientId?: string;
    /** 事件回调：service 主动推送 */
    onEvent?: (event: string, data: unknown) => void;
}
/** 校验离线玩家名。 */
export declare function validateOfflineName(name: string): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare class AccountService {
    private readonly dataDir;
    private readonly log;
    private readonly clientId;
    private readonly onEvent;
    private readonly store;
    private readonly activePath;
    private activeId;
    /** init() 并发去重 */
    private loadPromise;
    /** MicrosoftAuth 惰性创建（没配 clientId 时不构造，避免构造期抛错） */
    private msAuth;
    /** 当前进行中的登录流程（同一时间只允许一个） */
    private run;
    private disposed;
    constructor(opts: AccountServiceOptions);
    /** 载入 accounts.json 并恢复上次活动账号。 */
    init(): Promise<void>;
    list(): {
        accounts: AccountView[];
        activeId: string | null;
    };
    /** 离线账号：名称 3-16 位，仅字母数字下划线。 */
    addOffline(username: string): Promise<AccountView>;
    /** 正版：启动设备码流程，立即返回设备码；成功后通过事件推送结果。 */
    startMicrosoftLogin(): Promise<DeviceCodeView>;
    /** 取消正在等待的设备码登录。 */
    cancelLogin(): void;
    remove(id: string): Promise<boolean>;
    setActive(id: string): Promise<boolean>;
    /** 当前活动的启动身份；微软账号令牌过期时先尝试 refresh。 */
    activeIdentity(): Promise<LaunchIdentity | null>;
    dispose(): void;
    private emit;
    private getAuth;
    private saveActive;
    private ensureLoaded;
    private load;
    /** 后台登录：轮询设备码 → 换签 → 落盘 → 推事件。 */
    private runLogin;
}
//# sourceMappingURL=account-service.d.ts.map