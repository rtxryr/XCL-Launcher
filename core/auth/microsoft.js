"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicrosoftAuth = void 0;
const errors_1 = require("../core/errors");
const http_1 = require("../net/http");
const MS_DEVICE_CODE = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const MS_TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_AUTH = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE = "https://api.minecraftservices.com/minecraft/profile";
async function postJson(url, body, headers = {}) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    }).catch((e) => {
        throw (0, errors_1.wrapError)("AUTH", `请求失败: ${url}`, e, true);
    });
    const text = await res.text();
    if (!res.ok) {
        throw new errors_1.FusionError("AUTH", `HTTP ${res.status} ${url}: ${text.slice(0, 200)}`, {
            retryable: res.status >= 500,
        });
    }
    return JSON.parse(text);
}
async function postForm(url, form) {
    const body = new URLSearchParams(form).toString();
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(30_000),
    }).catch((e) => {
        throw (0, errors_1.wrapError)("AUTH", `请求失败: ${url}`, e, true);
    });
    const text = await res.text();
    if (!res.ok) {
        throw new errors_1.FusionError("AUTH", `HTTP ${res.status} ${url}: ${text.slice(0, 200)}`, {
            retryable: res.status >= 500,
        });
    }
    return JSON.parse(text);
}
class MicrosoftAuth {
    clientId;
    log;
    constructor(clientId, log) {
        this.clientId = clientId;
        this.log = log;
        if (!clientId)
            throw new errors_1.FusionError("AUTH", "缺少 Microsoft clientId");
    }
    /** 步骤 1：申请设备码。 */
    async requestDeviceCode() {
        const r = await postForm(MS_DEVICE_CODE, {
            client_id: this.clientId,
            scope: "XboxLive.signin offline_access",
        });
        return {
            userCode: r.user_code,
            verificationUri: r.verification_uri,
            intervalSec: r.interval ?? 5,
            expiresAt: Date.now() + (r.expires_in ?? 900) * 1000,
            deviceCode: r.device_code,
        };
    }
    /** 步骤 2：轮询直到用户确认，拿到 MS token。 */
    async pollForToken(prompt) {
        const deadline = prompt.expiresAt;
        let interval = prompt.intervalSec * 1000;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, interval));
            try {
                const t = await postForm(MS_TOKEN, {
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    client_id: this.clientId,
                    device_code: prompt.deviceCode,
                });
                return { accessToken: t.access_token, refreshToken: t.refresh_token };
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (/authorization_pending|slow_down/i.test(msg)) {
                    if (/slow_down/i.test(msg))
                        interval += 2000;
                    continue;
                }
                throw e;
            }
        }
        throw new errors_1.FusionError("AUTH", "设备码确认超时");
    }
    /** 用 refresh_token 刷新 MS token。 */
    async refresh(refreshToken) {
        const t = await postForm(MS_TOKEN, {
            grant_type: "refresh_token",
            client_id: this.clientId,
            refresh_token: refreshToken,
            scope: "XboxLive.signin offline_access",
        });
        return { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken };
    }
    /** 步骤 3-6：MS token → Xbox → XSTS → Minecraft → profile。 */
    async complete(msAccessToken) {
        // Xbox Live
        const xbl = await postJson(XBL_AUTH, {
            Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: msAccessToken },
            RelyingParty: "http://auth.xboxlive.com",
            TokenType: "JWT",
        });
        const uhs = xbl?.DisplayClaims?.xui?.[0]?.uhs;
        const xblToken = xbl.Token;
        if (!uhs || !xblToken)
            throw new errors_1.FusionError("AUTH", "Xbox Live 认证失败");
        // XSTS
        const xsts = await postJson(XSTS_AUTH, {
            Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] },
            RelyingParty: "rp://api.minecraftservices.com/",
            TokenType: "JWT",
        }).catch((e) => {
            throw (0, errors_1.wrapError)("AUTH", "XSTS 授权失败（账号可能未拥有 Minecraft 或需同意条款）", e);
        });
        const xstsToken = xsts.Token;
        // Minecraft 登录
        const mc = await postJson(MC_LOGIN, {
            identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
        });
        const mcToken = mc.access_token;
        // profile
        const profRes = await (0, http_1.httpGetBuffer)(MC_PROFILE, {
            headers: { authorization: `Bearer ${mcToken}` },
        });
        const profile = JSON.parse(profRes.toString("utf-8"));
        if (!profile?.id)
            throw new errors_1.FusionError("AUTH", "获取 Minecraft 档案失败（可能未拥有游戏）");
        const account = {
            type: "microsoft",
            username: profile.name,
            uuid: profile.id,
            accessToken: mcToken,
            userType: "msa",
            meta: { msRefreshToken: undefined },
        };
        this.log.info(`Microsoft 登录成功: ${profile.name}`);
        return { account, profile };
    }
    /** 一步到位：设备码 + 轮询 + 换签。onPrompt 用于把 user_code 展示给用户。 */
    async loginByDeviceCode(onPrompt) {
        const prompt = await this.requestDeviceCode();
        onPrompt(prompt);
        const ms = await this.pollForToken(prompt);
        const { account } = await this.complete(ms.accessToken);
        account.refreshToken = ms.refreshToken;
        account.expiresAt = Date.now() + 3600_000;
        return account;
    }
}
exports.MicrosoftAuth = MicrosoftAuth;
//# sourceMappingURL=microsoft.js.map