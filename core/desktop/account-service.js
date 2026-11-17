"use strict";
/**
 * 账号服务：正版设备码登录 + 离线账号，令牌与活动账号本地持久化。
 *
 * 放在桌面桥接层，是因为「登录要展示设备码、失败要弹提示」本身就是 UI 交互，
 * 由宿主进程内的 AccountService 直接推事件给渲染进程最省事：
 *   - 账号列表/活动账号落盘在 `<dataDir>/accounts.json` 与 `<dataDir>/active-account.json`；
 *   - Microsoft 登录走 OAuth 设备码：先同步返回 user_code，再后台轮询换签；
 *   - 所有异步进度只通过构造时注入的 `onEvent` 回调发出（不直接依赖 EventBus）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountService = void 0;
exports.validateOfflineName = validateOfflineName;
const path_1 = require("path");
const logger_1 = require("../core/logger");
const util_1 = require("../core/util");
const account_1 = require("../auth/account");
const account_2 = require("../auth/account");
const offline_1 = require("../auth/offline");
const microsoft_1 = require("../auth/microsoft");
/** 内置的公开启动器 client_id（Xbox Live 公共客户端，仅用于设备码流程）。 */
const DEFAULT_MS_CLIENT_ID = "00000000402b5328";
/** 头像服务：只拼 URL，不在此处发起任何网络请求。 */
const AVATAR_BASE = "https://mc-heads.net/avatar";
/** 离线玩家名规则：3-16 位字母/数字/下划线。 */
const OFFLINE_NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
/** 校验离线玩家名。 */
function validateOfflineName(name) {
    if (typeof name !== "string" || name.trim() === "") {
        return { ok: false, reason: "玩家名不能为空" };
    }
    if (!OFFLINE_NAME_RE.test(name)) {
        if (name.length < 3)
            return { ok: false, reason: "玩家名至少 3 个字符" };
        if (name.length > 16)
            return { ok: false, reason: "玩家名最多 16 个字符" };
        return { ok: false, reason: "玩家名只能包含字母、数字和下划线" };
    }
    return { ok: true };
}
/** Account → AccountView。 */
function toView(acc) {
    const bare = acc.uuid.replace(/-/g, "");
    const view = {
        id: acc.id,
        type: acc.type,
        username: acc.username,
        uuid: bare,
        avatarUrl: `${AVATAR_BASE}/${bare}/64`,
    };
    if (acc.type === "microsoft" && typeof acc.expiresAt === "number" && acc.expiresAt < Date.now()) {
        view.expired = true;
    }
    return view;
}
/** 登录失败 → 中文友好文案。 */
function loginErrorMessage(e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/declined|access_denied|authorization_declined/i.test(msg)) {
        return "登录被拒绝：你在浏览器中取消了授权";
    }
    if (/expired_token|设备码确认超时|expired/i.test(msg)) {
        return "设备码已过期或确认超时，请重新发起正版登录";
    }
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|请求失败/i.test(msg)) {
        return "网络连接失败，请检查网络后重试";
    }
    const trimmed = msg.trim();
    return trimmed === "" ? "登录失败，请稍后重试" : trimmed;
}
class AccountService {
    dataDir;
    log;
    clientId;
    onEvent;
    store;
    activePath;
    activeId = null;
    /** init() 并发去重 */
    loadPromise = null;
    /** MicrosoftAuth 惰性创建（没配 clientId 时不构造，避免构造期抛错） */
    msAuth = null;
    /** 当前进行中的登录流程（同一时间只允许一个） */
    run = null;
    disposed = false;
    constructor(opts) {
        this.dataDir = opts.dataDir;
        this.log = opts.log ?? new logger_1.Logger("silent");
        this.clientId = opts.clientId && opts.clientId.trim() !== "" ? opts.clientId : DEFAULT_MS_CLIENT_ID;
        this.onEvent = opts.onEvent;
        this.store = new account_1.AccountStore(this.dataDir, this.log);
        this.activePath = (0, path_1.join)(this.dataDir, "active-account.json");
    }
    /** 载入 accounts.json 并恢复上次活动账号。 */
    async init() {
        await this.ensureLoaded();
    }
    list() {
        return {
            accounts: this.store.list().map(toView),
            activeId: this.activeId,
        };
    }
    /** 离线账号：名称 3-16 位，仅字母数字下划线。 */
    async addOffline(username) {
        await this.ensureLoaded();
        const check = validateOfflineName(username);
        if (!check.ok)
            throw new Error(check.reason);
        const name = username.trim();
        const base = (0, offline_1.createOfflineAccount)(name);
        const acc = this.store.add({
            type: base.type,
            username: base.username,
            uuid: base.uuid,
            accessToken: base.accessToken,
            userType: base.userType,
            meta: base.meta,
        });
        await this.store.save();
        if (!this.activeId) {
            this.activeId = acc.id;
            await this.saveActive();
        }
        this.log.info(`已添加离线账号：${acc.username}`);
        return toView(acc);
    }
    /** 正版：启动设备码流程，立即返回设备码；成功后通过事件推送结果。 */
    async startMicrosoftLogin() {
        await this.ensureLoaded();
        if (this.disposed)
            throw new Error("账号服务已释放");
        // 同一时间只允许一个登录流程
        this.cancelLogin();
        const auth = this.getAuth();
        const prompt = await auth.requestDeviceCode();
        const view = {
            userCode: prompt.userCode,
            verificationUri: prompt.verificationUri,
            expiresIn: Math.max(0, Math.round((prompt.expiresAt - Date.now()) / 1000)),
            intervalSec: prompt.intervalSec,
        };
        const run = { cancelled: false, resolveCancel: null };
        this.run = run;
        // 返回前先推设备码，前端可直接展示
        this.emit("account:deviceCode", view);
        // 后台轮询，不阻塞本次调用
        void this.runLogin(run, prompt, auth);
        return view;
    }
    /** 取消正在等待的设备码登录。 */
    cancelLogin() {
        const run = this.run;
        if (!run) {
            this.log.debug("没有进行中的登录流程，取消操作忽略");
            return;
        }
        this.run = null;
        run.cancelled = true;
        run.resolveCancel?.();
        run.resolveCancel = null;
        this.log.info("已取消微软登录");
    }
    async remove(id) {
        await this.ensureLoaded();
        const removed = this.store.remove(id);
        if (!removed)
            return false;
        await this.store.save();
        if (this.activeId === id) {
            const rest = this.store.list();
            this.activeId = rest.length > 0 ? rest[0].id : null;
            await this.saveActive();
        }
        this.log.info(`已删除账号：${id}`);
        return true;
    }
    async setActive(id) {
        await this.ensureLoaded();
        if (!this.store.get(id))
            return false;
        this.activeId = id;
        await this.saveActive();
        return true;
    }
    /** 当前活动的启动身份；微软账号令牌过期时先尝试 refresh。 */
    async activeIdentity() {
        await this.ensureLoaded();
        const acc = this.activeId ? this.store.get(this.activeId) : undefined;
        if (!acc)
            return null;
        const expired = typeof acc.expiresAt === "number" && acc.expiresAt < Date.now();
        if (acc.type === "microsoft" && expired && acc.refreshToken) {
            try {
                const t = await this.getAuth().refresh(acc.refreshToken);
                const updated = this.store.update(acc.id, {
                    accessToken: t.accessToken,
                    refreshToken: t.refreshToken,
                    expiresAt: Date.now() + 3600_000,
                });
                await this.store.save();
                this.log.info("微软令牌已刷新");
                return (0, account_2.toIdentity)(updated ?? acc);
            }
            catch (e) {
                this.log.warn(`微软令牌刷新失败，继续使用旧身份：${e instanceof Error ? e.message : String(e)}`);
                return (0, account_2.toIdentity)(acc);
            }
        }
        return (0, account_2.toIdentity)(acc);
    }
    dispose() {
        this.disposed = true;
        this.cancelLogin();
    }
    // -------------------------------------------------------------------------
    // 内部
    // -------------------------------------------------------------------------
    emit(event, data) {
        if (!this.onEvent)
            return;
        try {
            this.onEvent(event, data);
        }
        catch (e) {
            this.log.warn(`账号事件 ${event} 投递失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }
    getAuth() {
        if (!this.msAuth)
            this.msAuth = new microsoft_1.MicrosoftAuth(this.clientId, this.log.child("ms"));
        return this.msAuth;
    }
    async saveActive() {
        await (0, util_1.writeJson)(this.activePath, { activeId: this.activeId });
    }
    ensureLoaded() {
        if (!this.loadPromise) {
            this.loadPromise = this.load().catch((e) => {
                // 失败后允许下次重试
                this.loadPromise = null;
                throw e;
            });
        }
        return this.loadPromise;
    }
    async load() {
        await this.store.load();
        if ((0, util_1.pathExists)(this.activePath)) {
            try {
                const raw = await (0, util_1.readJson)(this.activePath);
                if (typeof raw.activeId === "string" && raw.activeId !== "")
                    this.activeId = raw.activeId;
            }
            catch (e) {
                this.log.warn("活动账号文件解析失败，忽略", e);
            }
        }
        // 上次的活动账号可能已被删除
        if (this.activeId && !this.store.get(this.activeId))
            this.activeId = null;
        // 默认活动账号：优先上次的，否则第一个
        if (!this.activeId) {
            const first = this.store.list()[0];
            this.activeId = first ? first.id : null;
        }
        this.log.info(`账号已载入：${this.store.list().length} 个，活动账号 ${this.activeId ?? "无"}`);
    }
    /** 后台登录：轮询设备码 → 换签 → 落盘 → 推事件。 */
    async runLogin(run, prompt, auth) {
        const cancelPromise = new Promise((resolve) => {
            run.resolveCancel = () => resolve(null);
        });
        try {
            // 包一层，取消后残留的轮询不会产生未处理 rejection
            const polled = auth.pollForToken(prompt).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
            const outcome = await Promise.race([polled, cancelPromise]);
            if (outcome === null || run.cancelled)
                return;
            if (!outcome.ok)
                throw outcome.error;
            const { account } = await auth.complete(outcome.value.accessToken);
            if (run.cancelled)
                return;
            const saved = this.store.add({
                ...account,
                refreshToken: outcome.value.refreshToken,
                expiresAt: Date.now() + 3600_000,
            });
            await this.store.save();
            this.activeId = saved.id;
            await this.saveActive();
            this.log.info(`微软登录成功：${saved.username}`);
            this.emit("account:loginSuccess", { account: toView(saved) });
        }
        catch (e) {
            if (run.cancelled)
                return;
            const message = loginErrorMessage(e);
            this.log.warn(`微软登录失败：${e instanceof Error ? e.message : String(e)}`);
            this.emit("account:loginError", { message });
        }
        finally {
            if (this.run === run)
                this.run = null;
            run.resolveCancel = null;
        }
    }
}
exports.AccountService = AccountService;
//# sourceMappingURL=account-service.js.map