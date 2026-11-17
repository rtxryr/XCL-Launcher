/**
 * FusionMC Core —— 公共导出。
 * 一个「取长补短」的 Minecraft 启动器后端核心：
 *  多镜像聚合下载 / 游戏启动 / 账号认证 / 实例管理 / 加载器 / 全方式联机 / 一键开服。
 */
export { FusionBackend, BackendOptions } from "./backend";
export { Config, RuntimeConfig, MirrorId } from "./core/config";
export { EventBus, BackendEvents } from "./core/events";
export { Logger, rootLogger } from "./core/logger";
export { FusionError, ErrorCode } from "./core/errors";
export { MirrorManager, DownloadProvider, OfficialProvider, BMCLAPIProvider, MCBBSProvider, MCIMProvider, CustomProvider, } from "./net/mirrors";
export { downloadFile, downloadMany } from "./net/downloader";
export { ALL_SOURCE_SETS, VERSION_MANIFEST, LIBRARIES_MAVEN, ASSETS_CDN, FABRIC_META, FORGE_MAVEN, NEOFORGE_MAVEN, JAVA_RUNTIME_MANIFEST, MODRINTH_API, MODRINTH_CDN, CURSEFORGE_API, CURSEFORGE_CDN, SKIN_SERVICES, AVATAR_SERVICES, sourceCatalog, versionManifestCandidates, javaRuntimeManifestCandidates, temurinUrl, skinUrls, avatarUrls, } from "./net/sources";
export type { EndpointSet, SourceCategory } from "./net/sources";
export { ManifestService } from "./meta/manifest";
export { VersionJson, mergeInherited, mavenPath } from "./meta/version";
export { evaluateRules, buildContext, Rule, RuleContext } from "./meta/rules";
export { JavaService, JavaRuntime } from "./runtime/java";
export { extractNatives } from "./runtime/natives";
export { GameInstaller } from "./download/install";
export { GameResolver, ResolvedFile } from "./download/resolve";
export { aggregatedDownload, aggregatedDownloadMany, probeMirrors, orderCandidates, MirrorBreaker, candidateUrls, AGGREGATE_DEFAULTS, } from "./download/aggregator";
export type { AggregateDownloadOptions, AggregateProgress, AggregateResult, MirrorProbe, DownloadSourceMode, } from "./download/aggregator";
export { Account, LaunchIdentity, AccountStore, toIdentity, offlineUuid } from "./auth/account";
export { createOfflineAccount } from "./auth/offline";
export { MicrosoftAuth, DeviceCodePrompt } from "./auth/microsoft";
export { YggdrasilAuth } from "./auth/yggdrasil";
export { InstanceManager, Instance } from "./instance/instance";
export { buildCommand, launchGame, GameProcess, LaunchResult } from "./launch/launcher";
export { buildJvmArgs, buildGameArgs, LaunchPaths, LaunchSettings } from "./launch/args";
export { buildClasspath } from "./launch/classpath";
export { LoaderInstaller, LoaderType } from "./loader";
export { ServerHost, serverPropertiesDefaults, renderServerProperties, detectLaunchKindFromFiles, requiredJavaMajor, sanitizeServerName, } from "./server";
export type { ServerSpec, ServerEntry, ServerState, ServerStatus, ServerLogEvent } from "./server";
export { MultiplayerManager, MultiplayerConfig, HostedSession, JoinedSession } from "./multiplayer";
export { Transport, Tunnel, GameBridge, HostHandle } from "./multiplayer/transport";
export { LanTransport, discoverLanGames, LanGame } from "./multiplayer/lan";
export { DirectTransport } from "./multiplayer/direct";
export { WebRtcTransport } from "./multiplayer/webrtc";
export { RelayTransport, encodeFrame, decodeFrames } from "./multiplayer/relay";
export { openPort, discoverUPnP, mapNatPmp, buildNatPmpRequest } from "./multiplayer/nat";
export { RedstoneTransport, makeApikey, parseControlLine, isHttpProbe, isMinecraftHandshake, } from "./multiplayer/redstone";
export type { RedstoneNode, RedstoneOptions } from "./multiplayer/redstone";
export { TerracottaTransport, generateRoomCode, normalizeRoomCode, parseStatePayload, pickNodes, } from "./multiplayer/terracotta";
export type { TerracottaState, TerracottaOptions } from "./multiplayer/terracotta";
export declare const VERSION = "0.1.0";
//# sourceMappingURL=index.d.ts.map