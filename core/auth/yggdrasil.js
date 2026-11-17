"use strict";
/**
 * Yggdrasil / Authlib-Injector 第三方认证（ely.by、littleskin.cn、自建皮肤站）。
 *
 * Authlib-Injector 约定：认证服务器根地址 + /authserver/authenticate 登录，
 * 令牌为 JWT，api 由服务端下发。进游戏时把 baseUrl 经 -javaagent 或
 * --userType 交给加载器；此处只负责换签出 username/uuid/accessToken。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.YggdrasilAuth = void 0;
const crypto_1 = require("crypto");
const errors_1 = require("../core/errors");
async function postJson(url, body) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    }).catch((e) => {
        throw (0, errors_1.wrapError)("AUTH", `请求失败: ${url}`, e, true);
    });
    const text = await res.text();
    if (!res.ok)
        throw new errors_1.FusionError("AUTH", `HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
}
class YggdrasilAuth {
    baseUrl;
    log;
    constructor(baseUrl, log) {
        this.baseUrl = baseUrl;
        this.log = log;
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }
    /** 用户名密码登录，返回账号。 */
    async authenticate(username, password, clientToken) {
        const r = await postJson(`${this.baseUrl}/authserver/authenticate`, {
            agent: { name: "Minecraft", version: 1 },
            username,
            password,
            clientToken: clientToken ?? cryptoRandomToken(),
            requestUser: true,
        });
        const profile = r?.selectedProfile;
        if (!profile?.id)
            throw new errors_1.FusionError("AUTH", "Yggdrasil 登录未返回角色（该账号可能无 Minecraft 角色）");
        this.log.info(`Yggdrasil 登录成功: ${profile.name}`);
        return {
            type: "yggdrasil",
            username: profile.name,
            uuid: profile.id,
            accessToken: r.accessToken,
            userType: "mojang",
            authServer: this.baseUrl,
            meta: { clientToken: r.clientToken },
        };
    }
    /** 令牌刷新。 */
    async refresh(accessToken, clientToken) {
        const r = await postJson(`${this.baseUrl}/authserver/refresh`, {
            accessToken,
            clientToken,
            requestUser: true,
        });
        return { accessToken: r.accessToken };
    }
    /** 校验令牌有效性。 */
    async validate(accessToken) {
        try {
            await postJson(`${this.baseUrl}/authserver/validate`, { accessToken });
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.YggdrasilAuth = YggdrasilAuth;
function cryptoRandomToken() {
    return (0, crypto_1.randomBytes)(16).toString("hex");
}
//# sourceMappingURL=yggdrasil.js.map