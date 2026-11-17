/**
 * Microsoft 正版认证（OAuth 2.0 设备码流程）。
 *
 * 流程（各步令牌层层换签）：
 *  1. 申请设备码 → 用户在浏览器输入 user_code 确认
 *  2. 轮询换 Microsoft access_token (+ refresh_token)
 *  3. Xbox Live 认证（RpsTicket）→ 得 user hash (uhs)
 *  4. XSTS 授权（RelyingParty=rp://api.minecraftservices.com）→ XSTS token
 *  5. Minecraft 登录（identityToken = "XBL3.0 x=<uhs>;<xsts>"）→ Minecraft access_token
 *  6. 拉取 profile（id + name）与权益校验
 *
 * client_id 由调用方配置（第三方启动器需注册自己的 Azure 应用；勿硬编码敏感凭据）。
 */
import { Logger } from "../core/logger";
import { Account } from "./account";
export interface DeviceCodePrompt {
    userCode: string;
    verificationUri: string;
    intervalSec: number;
    expiresAt: number;
    deviceCode: string;
}
export interface MinecraftProfile {
    id: string;
    name: string;
}
export declare class MicrosoftAuth {
    private clientId;
    private log;
    constructor(clientId: string, log: Logger);
    /** 步骤 1：申请设备码。 */
    requestDeviceCode(): Promise<DeviceCodePrompt>;
    /** 步骤 2：轮询直到用户确认，拿到 MS token。 */
    pollForToken(prompt: DeviceCodePrompt): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    /** 用 refresh_token 刷新 MS token。 */
    refresh(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    /** 步骤 3-6：MS token → Xbox → XSTS → Minecraft → profile。 */
    complete(msAccessToken: string): Promise<{
        account: Omit<Account, "id">;
        profile: MinecraftProfile;
    }>;
    /** 一步到位：设备码 + 轮询 + 换签。onPrompt 用于把 user_code 展示给用户。 */
    loginByDeviceCode(onPrompt: (p: DeviceCodePrompt) => void): Promise<Omit<Account, "id">>;
}
//# sourceMappingURL=microsoft.d.ts.map