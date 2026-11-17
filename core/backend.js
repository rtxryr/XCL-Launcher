"use strict";
/**
 * FusionBackend —— 后端门面（进程内 API 服务层）。
 *
 * 把下载/安装/启动/认证/实例/加载器/联机统一编排成一个可被 UI 直接调用的对象。
 *
 * 说明（呼应「服务器不要设在本机」）：
 *  - 这里【不绑定任何本地 HTTP/WebSocket 服务】；UI（Electron/Tauri 主进程）在同进程内
 *    直接 import 并调用本类方法。
 *  - 联机所需的信令/中继服务器均为【远程端点】，通过 multiplayer 配置传入。
 *  - 若确需网络 API，应由调用方把它部署到【远程】服务，而非本机。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FusionBackend = void 0;
const path_1 = require("path");
const config_1 = require("./core/config");
const events_1 = require("./core/events");
const util_1 = require("./core/util");
const mirrors_1 = require("./net/mirrors");
const manifest_1 = require("./meta/manifest");
const rules_1 = require("./meta/rules");
const install_1 = require("./download/install");
const java_1 = require("./runtime/java");
const account_1 = require("./auth/account");
const offline_1 = require("./auth/offline");
const microsoft_1 = require("./auth/microsoft");
const yggdrasil_1 = require("./auth/yggdrasil");
const instance_1 = require("./instance/instance");
const loader_1 = require("./loader");
const launcher_1 = require("./launch/launcher");
const resolve_1 = require("./download/resolve");
const multiplayer_1 = require("./multiplayer");
const server_1 = require("./server");
class FusionBackend {
    config;
    events = new events_1.EventBus();
    log;
    mirrors;
    manifest;
    java;
    installer;
    accounts;
    instances;
    loaders;
    multiplayer;
    /** 一键开服务器（本地 MC 服务端进程管理） */
    servers;
    ready = false;
    constructor(opts = {}) {
        this.config = config_1.Config.load(opts.configRoot);
        this.log = opts.log ?? this.config.logger;
        const root = this.config.value.root;
        this.mirrors = new mirrors_1.MirrorManager(this.config.runtime.mirror, this.config.runtime.customMirror
            ? {
                mavenUrl: this.config.runtime.customMirror.mavenUrl ?? "",
                resourcesUrl: this.config.runtime.customMirror.resourcesUrl ?? "",
                manifestUrl: this.config.runtime.customMirror.versionManifestUrl,
            }
            : undefined);
        this.manifest = new manifest_1.ManifestService(this.mirrors, this.log.child("manifest"));
        this.java = new java_1.JavaService(this.mirrors, this.log.child("java"), (0, path_1.join)(root, "runtime"));
        this.installer = new install_1.GameInstaller(this.mirrors, this.config.gameDir, this.log.child("install"));
        this.accounts = new account_1.AccountStore(root, this.log.child("auth"));
        this.instances = new instance_1.InstanceManager(this.config.instancesDir, this.log.child("instance"));
        this.loaders = new loader_1.LoaderInstaller(this.mirrors, this.config.gameDir, this.log.child("loader"));
        this.multiplayer = new multiplayer_1.MultiplayerManager(this.log.child("mp"), opts.multiplayer ?? {});
        this.servers = new server_1.ServerHost({
            mirrors: this.mirrors,
            manifest: this.manifest,
            java: this.java,
            log: this.log.child("server"),
            rootDir: (0, path_1.join)(root, "servers"),
            onLog: (e) => this.events.emit("server:log", { id: e.id, line: e.line, level: e.level }),
            onStatus: (s) => {
                this.log.info(`服务端 ${s.id} 状态: ${s.state}` + (s.message ? ` (${s.message})` : ""));
                // 必须真的发事件：面板靠它把 starting 翻成 running、把 error 立刻显示出来
                this.events.emit("server:status", {
                    id: s.id,
                    state: s.state,
                    port: s.port,
                    pid: s.pid,
                    startedAt: s.startedAt,
                    message: s.message,
                });
            },
        });
    }
    /** 加载持久化状态（账号等）。 */
    async init() {
        await this.accounts.load();
        this.ready = true;
        this.log.info("X Craft Launcher 后端就绪（进程内门面，未起本地服务）");
    }
    // ---------- 版本与安装 ----------
    async listVersions(type) {
        return this.manifest.listVersions(type);
    }
    async loadVersion(versionId) {
        return this.manifest.loadVersionById(versionId);
    }
    /** 安装一个游戏版本到全局 gameDir（库/资源共享）。 */
    async installVersion(versionId, opts) {
        const version = await this.loadVersion(versionId);
        const nativesDir = (0, path_1.join)(this.config.gameDir, "natives", version.id);
        return this.installer.install(version, {
            events: this.events,
            nativesDir,
            concurrency: this.config.runtime.downloadConcurrency,
            skipAssets: opts?.skipAssets,
        });
    }
    // ---------- 账号 ----------
    addOfflineAccount(username) {
        const acc = (0, offline_1.createOfflineAccount)(username);
        return this.accounts.add(acc);
    }
    async loginMicrosoft(onPrompt) {
        const clientId = this.config.runtime.msClientId;
        if (!clientId)
            throw new Error("未配置 Microsoft clientId（config.runtime.msClientId）");
        const auth = new microsoft_1.MicrosoftAuth(clientId, this.log.child("ms"));
        const acc = await auth.loginByDeviceCode(onPrompt);
        return this.accounts.add(acc);
    }
    async loginYggdrasil(server, username, password) {
        const auth = new yggdrasil_1.YggdrasilAuth(server, this.log.child("ygg"));
        const acc = await auth.authenticate(username, password);
        return this.accounts.add(acc);
    }
    getIdentity(accountId) {
        const acc = this.accounts.get(accountId);
        if (!acc)
            throw new Error(`账号不存在: ${accountId}`);
        return (0, account_1.toIdentity)(acc);
    }
    // ---------- 实例 ----------
    createInstance(props) {
        return this.instances.create(props);
    }
    listInstances() {
        return this.instances.list();
    }
    // ---------- 加载器 ----------
    async installLoader(instanceId, loader, loaderVersion) {
        const inst = await this.instances.get(instanceId);
        const base = await this.loadVersion(inst.gameVersion);
        const res = await this.loaders.install(loader, base, loaderVersion);
        await this.instances.update(instanceId, { launchVersion: res.versionId });
        return { versionId: res.versionId, version: res.version };
    }
    // ---------- 启动 ----------
    /** 组装启动命令（不执行），供预览/调试。 */
    async buildLaunchCommand(instanceId, accountId) {
        const inst = await this.instances.get(instanceId);
        const versionId = inst.launchVersion ?? inst.gameVersion;
        const version = await this.loadVersion(versionId);
        const identity = this.getIdentity(accountId);
        const gameDir = this.instances.gameDirOf(instanceId);
        const nativesDir = (0, path_1.join)(this.config.gameDir, "natives", versionId);
        const resolver = new resolve_1.GameResolver(this.mirrors, this.config.gameDir);
        const ctx = (0, rules_1.buildContext)();
        const classpathFiles = resolver.resolveLibraries(version);
        const jars = classpathFiles
            .filter((f) => f.kind === "library" || f.kind === "client")
            .map((f) => f.dest);
        const clientJar = classpathFiles.find((f) => f.kind === "client")?.dest ?? "";
        const classpath = [...jars].join((0, util_1.classpathSep)());
        const java = await this.java.resolve(version.javaVersion?.majorVersion, inst.settings.javaPath ?? this.config.runtime.javaPath);
        return (0, launcher_1.buildCommand)({
            javaPath: java.javaPath,
            version,
            identity,
            paths: {
                nativesDir,
                librariesDir: (0, path_1.join)(this.config.gameDir, "libraries"),
                assetsDir: (0, path_1.join)(this.config.gameDir, "assets"),
                gameDir,
                classpath,
                classpathSeparator: (0, util_1.classpathSep)(),
            },
            settings: {
                maxMemoryMB: inst.settings.maxMemoryMB ?? this.config.runtime.maxMemoryMB,
                extraJvmArgs: inst.settings.extraJvmArgs,
                extraGameArgs: inst.settings.extraGameArgs,
                width: inst.settings.width,
                height: inst.settings.height,
                fullscreen: inst.settings.fullscreen,
            },
            ctx,
        });
    }
    /** 启动游戏。 */
    async launch(instanceId, accountId) {
        const inst = await this.instances.get(instanceId);
        const versionId = inst.launchVersion ?? inst.gameVersion;
        const version = await this.loadVersion(versionId);
        const identity = this.getIdentity(accountId);
        const gameDir = this.instances.gameDirOf(instanceId);
        const nativesDir = (0, path_1.join)(this.config.gameDir, "natives", versionId);
        const resolver = new resolve_1.GameResolver(this.mirrors, this.config.gameDir);
        const ctx = (0, rules_1.buildContext)();
        const classpathFiles = resolver.resolveLibraries(version);
        const jars = classpathFiles
            .filter((f) => f.kind === "library" || f.kind === "client")
            .map((f) => f.dest);
        const classpath = jars.join((0, util_1.classpathSep)());
        const java = await this.java.resolve(version.javaVersion?.majorVersion, inst.settings.javaPath ?? this.config.runtime.javaPath);
        const handle = (0, launcher_1.launchGame)({
            log: this.log.child("launch"),
            events: this.events,
            javaPath: java.javaPath,
            version,
            identity,
            paths: {
                nativesDir,
                librariesDir: (0, path_1.join)(this.config.gameDir, "libraries"),
                assetsDir: (0, path_1.join)(this.config.gameDir, "assets"),
                gameDir,
                classpath,
                classpathSeparator: (0, util_1.classpathSep)(),
            },
            settings: {
                maxMemoryMB: inst.settings.maxMemoryMB ?? this.config.runtime.maxMemoryMB,
                extraJvmArgs: inst.settings.extraJvmArgs,
                extraGameArgs: inst.settings.extraGameArgs,
                width: inst.settings.width,
                height: inst.settings.height,
                fullscreen: inst.settings.fullscreen,
            },
            ctx,
        });
        await this.instances.markPlayed(instanceId);
        return handle.wait();
    }
    // ---------- 联机 ----------
    hostGame(transportId, opts) {
        return this.multiplayer.host(transportId, opts);
    }
    joinGame(transportId, opts) {
        return this.multiplayer.join(transportId, opts);
    }
    discoverLan(timeoutMs = 3000) {
        return this.multiplayer.discover(timeoutMs);
    }
    listTransports() {
        return this.multiplayer.list();
    }
    // ---------- 一键开服 ----------
    /** 创建并安装一个 MC 服务端（下载 server.jar / 跑加载器安装器 / 写配置 / 同步 mods）。 */
    createServer(spec) {
        return this.servers.create(spec);
    }
    listServers() {
        return this.servers.list();
    }
    startServer(id) {
        return this.servers.start(id);
    }
    stopServer(id) {
        return this.servers.stop(id);
    }
    /** 查询状态：给 id 返回单个，否则返回全部。 */
    serverStatus(id) {
        return this.servers.status(id);
    }
    /** 向服务端控制台下发命令（op / whitelist / save-all / stop 等）。 */
    serverCommand(id, cmd) {
        this.servers.command(id, cmd);
    }
    removeServer(id) {
        return this.servers.remove(id);
    }
    stopAllServers() {
        return this.servers.stopAll();
    }
}
exports.FusionBackend = FusionBackend;
//# sourceMappingURL=backend.js.map