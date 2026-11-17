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
import { Config } from "./core/config";
import { EventBus, BackendEvents } from "./core/events";
import { Logger } from "./core/logger";
import { MirrorManager } from "./net/mirrors";
import { ManifestService } from "./meta/manifest";
import { VersionJson } from "./meta/version";
import { GameInstaller } from "./download/install";
import { JavaService } from "./runtime/java";
import { AccountStore, Account, LaunchIdentity } from "./auth/account";
import { DeviceCodePrompt } from "./auth/microsoft";
import { InstanceManager, Instance } from "./instance/instance";
import { LoaderInstaller, LoaderType } from "./loader";
import { LaunchResult } from "./launch/launcher";
import { MultiplayerManager, MultiplayerConfig, HostedSession, JoinedSession } from "./multiplayer";
import { ServerHost, ServerSpec, ServerEntry, ServerStatus } from "./server";
export interface BackendOptions {
    configRoot?: string;
    multiplayer?: MultiplayerConfig;
    log?: Logger;
}
export declare class FusionBackend {
    readonly config: Config;
    readonly events: EventBus<BackendEvents>;
    readonly log: Logger;
    readonly mirrors: MirrorManager;
    readonly manifest: ManifestService;
    readonly java: JavaService;
    readonly installer: GameInstaller;
    readonly accounts: AccountStore;
    readonly instances: InstanceManager;
    readonly loaders: LoaderInstaller;
    readonly multiplayer: MultiplayerManager;
    /** 一键开服务器（本地 MC 服务端进程管理） */
    readonly servers: ServerHost;
    private ready;
    constructor(opts?: BackendOptions);
    /** 加载持久化状态（账号等）。 */
    init(): Promise<void>;
    listVersions(type?: string): Promise<import("./meta/manifest").ManifestVersion[]>;
    loadVersion(versionId: string): Promise<VersionJson>;
    /** 安装一个游戏版本到全局 gameDir（库/资源共享）。 */
    installVersion(versionId: string, opts?: {
        skipAssets?: boolean;
    }): Promise<import("./download/install").InstallSummary>;
    addOfflineAccount(username: string): Account;
    loginMicrosoft(onPrompt: (p: DeviceCodePrompt) => void): Promise<Account>;
    loginYggdrasil(server: string, username: string, password: string): Promise<Account>;
    getIdentity(accountId: string): LaunchIdentity;
    createInstance(props: {
        name: string;
        gameVersion: string;
        loader?: Instance["loader"];
    }): Promise<Instance>;
    listInstances(): Promise<Instance[]>;
    installLoader(instanceId: string, loader: LoaderType, loaderVersion: string): Promise<{
        versionId: string;
        version: VersionJson;
    }>;
    /** 组装启动命令（不执行），供预览/调试。 */
    buildLaunchCommand(instanceId: string, accountId: string): Promise<string[]>;
    /** 启动游戏。 */
    launch(instanceId: string, accountId: string): Promise<LaunchResult>;
    hostGame(transportId: string, opts: {
        gamePort: number;
        name?: string;
        tryPortMapping?: boolean;
    }): Promise<HostedSession>;
    joinGame(transportId: string, opts: {
        connectionInfo: string;
        name?: string;
    }): Promise<JoinedSession>;
    discoverLan(timeoutMs?: number): Promise<import(".").LanGame[]>;
    listTransports(): {
        id: string;
        name: string;
        remoteServer?: string;
    }[];
    /** 创建并安装一个 MC 服务端（下载 server.jar / 跑加载器安装器 / 写配置 / 同步 mods）。 */
    createServer(spec: ServerSpec): Promise<ServerEntry>;
    listServers(): ServerEntry[];
    startServer(id: string): Promise<ServerStatus>;
    stopServer(id: string): Promise<{
        forced: boolean;
    }>;
    /** 查询状态：给 id 返回单个，否则返回全部。 */
    serverStatus(id?: string): ServerStatus | ServerStatus[];
    /** 向服务端控制台下发命令（op / whitelist / save-all / stop 等）。 */
    serverCommand(id: string, cmd: string): void;
    removeServer(id: string): Promise<void>;
    stopAllServers(): Promise<void>;
}
//# sourceMappingURL=backend.d.ts.map