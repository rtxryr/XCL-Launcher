"use strict";
/**
 * FusionMC Core —— 公共导出。
 * 一个「取长补短」的 Minecraft 启动器后端核心：
 *  多镜像聚合下载 / 游戏启动 / 账号认证 / 实例管理 / 加载器 / 全方式联机 / 一键开服。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGGREGATE_DEFAULTS = exports.candidateUrls = exports.MirrorBreaker = exports.orderCandidates = exports.probeMirrors = exports.aggregatedDownloadMany = exports.aggregatedDownload = exports.GameResolver = exports.GameInstaller = exports.extractNatives = exports.JavaService = exports.buildContext = exports.evaluateRules = exports.mavenPath = exports.mergeInherited = exports.ManifestService = exports.avatarUrls = exports.skinUrls = exports.temurinUrl = exports.javaRuntimeManifestCandidates = exports.versionManifestCandidates = exports.sourceCatalog = exports.AVATAR_SERVICES = exports.SKIN_SERVICES = exports.CURSEFORGE_CDN = exports.CURSEFORGE_API = exports.MODRINTH_CDN = exports.MODRINTH_API = exports.JAVA_RUNTIME_MANIFEST = exports.NEOFORGE_MAVEN = exports.FORGE_MAVEN = exports.FABRIC_META = exports.ASSETS_CDN = exports.LIBRARIES_MAVEN = exports.VERSION_MANIFEST = exports.ALL_SOURCE_SETS = exports.downloadMany = exports.downloadFile = exports.CustomProvider = exports.MCIMProvider = exports.MCBBSProvider = exports.BMCLAPIProvider = exports.OfficialProvider = exports.MirrorManager = exports.FusionError = exports.rootLogger = exports.Logger = exports.EventBus = exports.Config = exports.FusionBackend = void 0;
exports.VERSION = exports.pickNodes = exports.parseStatePayload = exports.normalizeRoomCode = exports.generateRoomCode = exports.TerracottaTransport = exports.isMinecraftHandshake = exports.isHttpProbe = exports.parseControlLine = exports.makeApikey = exports.RedstoneTransport = exports.buildNatPmpRequest = exports.mapNatPmp = exports.discoverUPnP = exports.openPort = exports.decodeFrames = exports.encodeFrame = exports.RelayTransport = exports.WebRtcTransport = exports.DirectTransport = exports.discoverLanGames = exports.LanTransport = exports.GameBridge = exports.MultiplayerManager = exports.sanitizeServerName = exports.requiredJavaMajor = exports.detectLaunchKindFromFiles = exports.renderServerProperties = exports.serverPropertiesDefaults = exports.ServerHost = exports.LoaderInstaller = exports.buildClasspath = exports.buildGameArgs = exports.buildJvmArgs = exports.GameProcess = exports.launchGame = exports.buildCommand = exports.InstanceManager = exports.YggdrasilAuth = exports.MicrosoftAuth = exports.createOfflineAccount = exports.offlineUuid = exports.toIdentity = exports.AccountStore = void 0;
var backend_1 = require("./backend");
Object.defineProperty(exports, "FusionBackend", { enumerable: true, get: function () { return backend_1.FusionBackend; } });
// core
var config_1 = require("./core/config");
Object.defineProperty(exports, "Config", { enumerable: true, get: function () { return config_1.Config; } });
var events_1 = require("./core/events");
Object.defineProperty(exports, "EventBus", { enumerable: true, get: function () { return events_1.EventBus; } });
var logger_1 = require("./core/logger");
Object.defineProperty(exports, "Logger", { enumerable: true, get: function () { return logger_1.Logger; } });
Object.defineProperty(exports, "rootLogger", { enumerable: true, get: function () { return logger_1.rootLogger; } });
var errors_1 = require("./core/errors");
Object.defineProperty(exports, "FusionError", { enumerable: true, get: function () { return errors_1.FusionError; } });
// net
var mirrors_1 = require("./net/mirrors");
Object.defineProperty(exports, "MirrorManager", { enumerable: true, get: function () { return mirrors_1.MirrorManager; } });
Object.defineProperty(exports, "OfficialProvider", { enumerable: true, get: function () { return mirrors_1.OfficialProvider; } });
Object.defineProperty(exports, "BMCLAPIProvider", { enumerable: true, get: function () { return mirrors_1.BMCLAPIProvider; } });
Object.defineProperty(exports, "MCBBSProvider", { enumerable: true, get: function () { return mirrors_1.MCBBSProvider; } });
Object.defineProperty(exports, "MCIMProvider", { enumerable: true, get: function () { return mirrors_1.MCIMProvider; } });
Object.defineProperty(exports, "CustomProvider", { enumerable: true, get: function () { return mirrors_1.CustomProvider; } });
var downloader_1 = require("./net/downloader");
Object.defineProperty(exports, "downloadFile", { enumerable: true, get: function () { return downloader_1.downloadFile; } });
Object.defineProperty(exports, "downloadMany", { enumerable: true, get: function () { return downloader_1.downloadMany; } });
var sources_1 = require("./net/sources");
Object.defineProperty(exports, "ALL_SOURCE_SETS", { enumerable: true, get: function () { return sources_1.ALL_SOURCE_SETS; } });
Object.defineProperty(exports, "VERSION_MANIFEST", { enumerable: true, get: function () { return sources_1.VERSION_MANIFEST; } });
Object.defineProperty(exports, "LIBRARIES_MAVEN", { enumerable: true, get: function () { return sources_1.LIBRARIES_MAVEN; } });
Object.defineProperty(exports, "ASSETS_CDN", { enumerable: true, get: function () { return sources_1.ASSETS_CDN; } });
Object.defineProperty(exports, "FABRIC_META", { enumerable: true, get: function () { return sources_1.FABRIC_META; } });
Object.defineProperty(exports, "FORGE_MAVEN", { enumerable: true, get: function () { return sources_1.FORGE_MAVEN; } });
Object.defineProperty(exports, "NEOFORGE_MAVEN", { enumerable: true, get: function () { return sources_1.NEOFORGE_MAVEN; } });
Object.defineProperty(exports, "JAVA_RUNTIME_MANIFEST", { enumerable: true, get: function () { return sources_1.JAVA_RUNTIME_MANIFEST; } });
Object.defineProperty(exports, "MODRINTH_API", { enumerable: true, get: function () { return sources_1.MODRINTH_API; } });
Object.defineProperty(exports, "MODRINTH_CDN", { enumerable: true, get: function () { return sources_1.MODRINTH_CDN; } });
Object.defineProperty(exports, "CURSEFORGE_API", { enumerable: true, get: function () { return sources_1.CURSEFORGE_API; } });
Object.defineProperty(exports, "CURSEFORGE_CDN", { enumerable: true, get: function () { return sources_1.CURSEFORGE_CDN; } });
Object.defineProperty(exports, "SKIN_SERVICES", { enumerable: true, get: function () { return sources_1.SKIN_SERVICES; } });
Object.defineProperty(exports, "AVATAR_SERVICES", { enumerable: true, get: function () { return sources_1.AVATAR_SERVICES; } });
Object.defineProperty(exports, "sourceCatalog", { enumerable: true, get: function () { return sources_1.sourceCatalog; } });
Object.defineProperty(exports, "versionManifestCandidates", { enumerable: true, get: function () { return sources_1.versionManifestCandidates; } });
Object.defineProperty(exports, "javaRuntimeManifestCandidates", { enumerable: true, get: function () { return sources_1.javaRuntimeManifestCandidates; } });
Object.defineProperty(exports, "temurinUrl", { enumerable: true, get: function () { return sources_1.temurinUrl; } });
Object.defineProperty(exports, "skinUrls", { enumerable: true, get: function () { return sources_1.skinUrls; } });
Object.defineProperty(exports, "avatarUrls", { enumerable: true, get: function () { return sources_1.avatarUrls; } });
// meta
var manifest_1 = require("./meta/manifest");
Object.defineProperty(exports, "ManifestService", { enumerable: true, get: function () { return manifest_1.ManifestService; } });
var version_1 = require("./meta/version");
Object.defineProperty(exports, "mergeInherited", { enumerable: true, get: function () { return version_1.mergeInherited; } });
Object.defineProperty(exports, "mavenPath", { enumerable: true, get: function () { return version_1.mavenPath; } });
var rules_1 = require("./meta/rules");
Object.defineProperty(exports, "evaluateRules", { enumerable: true, get: function () { return rules_1.evaluateRules; } });
Object.defineProperty(exports, "buildContext", { enumerable: true, get: function () { return rules_1.buildContext; } });
// runtime
var java_1 = require("./runtime/java");
Object.defineProperty(exports, "JavaService", { enumerable: true, get: function () { return java_1.JavaService; } });
var natives_1 = require("./runtime/natives");
Object.defineProperty(exports, "extractNatives", { enumerable: true, get: function () { return natives_1.extractNatives; } });
// download
var install_1 = require("./download/install");
Object.defineProperty(exports, "GameInstaller", { enumerable: true, get: function () { return install_1.GameInstaller; } });
var resolve_1 = require("./download/resolve");
Object.defineProperty(exports, "GameResolver", { enumerable: true, get: function () { return resolve_1.GameResolver; } });
var aggregator_1 = require("./download/aggregator");
Object.defineProperty(exports, "aggregatedDownload", { enumerable: true, get: function () { return aggregator_1.aggregatedDownload; } });
Object.defineProperty(exports, "aggregatedDownloadMany", { enumerable: true, get: function () { return aggregator_1.aggregatedDownloadMany; } });
Object.defineProperty(exports, "probeMirrors", { enumerable: true, get: function () { return aggregator_1.probeMirrors; } });
Object.defineProperty(exports, "orderCandidates", { enumerable: true, get: function () { return aggregator_1.orderCandidates; } });
Object.defineProperty(exports, "MirrorBreaker", { enumerable: true, get: function () { return aggregator_1.MirrorBreaker; } });
Object.defineProperty(exports, "candidateUrls", { enumerable: true, get: function () { return aggregator_1.candidateUrls; } });
Object.defineProperty(exports, "AGGREGATE_DEFAULTS", { enumerable: true, get: function () { return aggregator_1.AGGREGATE_DEFAULTS; } });
// auth
var account_1 = require("./auth/account");
Object.defineProperty(exports, "AccountStore", { enumerable: true, get: function () { return account_1.AccountStore; } });
Object.defineProperty(exports, "toIdentity", { enumerable: true, get: function () { return account_1.toIdentity; } });
Object.defineProperty(exports, "offlineUuid", { enumerable: true, get: function () { return account_1.offlineUuid; } });
var offline_1 = require("./auth/offline");
Object.defineProperty(exports, "createOfflineAccount", { enumerable: true, get: function () { return offline_1.createOfflineAccount; } });
var microsoft_1 = require("./auth/microsoft");
Object.defineProperty(exports, "MicrosoftAuth", { enumerable: true, get: function () { return microsoft_1.MicrosoftAuth; } });
var yggdrasil_1 = require("./auth/yggdrasil");
Object.defineProperty(exports, "YggdrasilAuth", { enumerable: true, get: function () { return yggdrasil_1.YggdrasilAuth; } });
// instance
var instance_1 = require("./instance/instance");
Object.defineProperty(exports, "InstanceManager", { enumerable: true, get: function () { return instance_1.InstanceManager; } });
// launch
var launcher_1 = require("./launch/launcher");
Object.defineProperty(exports, "buildCommand", { enumerable: true, get: function () { return launcher_1.buildCommand; } });
Object.defineProperty(exports, "launchGame", { enumerable: true, get: function () { return launcher_1.launchGame; } });
Object.defineProperty(exports, "GameProcess", { enumerable: true, get: function () { return launcher_1.GameProcess; } });
var args_1 = require("./launch/args");
Object.defineProperty(exports, "buildJvmArgs", { enumerable: true, get: function () { return args_1.buildJvmArgs; } });
Object.defineProperty(exports, "buildGameArgs", { enumerable: true, get: function () { return args_1.buildGameArgs; } });
var classpath_1 = require("./launch/classpath");
Object.defineProperty(exports, "buildClasspath", { enumerable: true, get: function () { return classpath_1.buildClasspath; } });
// loader
var loader_1 = require("./loader");
Object.defineProperty(exports, "LoaderInstaller", { enumerable: true, get: function () { return loader_1.LoaderInstaller; } });
// server（一键开服）
var server_1 = require("./server");
Object.defineProperty(exports, "ServerHost", { enumerable: true, get: function () { return server_1.ServerHost; } });
Object.defineProperty(exports, "serverPropertiesDefaults", { enumerable: true, get: function () { return server_1.serverPropertiesDefaults; } });
Object.defineProperty(exports, "renderServerProperties", { enumerable: true, get: function () { return server_1.renderServerProperties; } });
Object.defineProperty(exports, "detectLaunchKindFromFiles", { enumerable: true, get: function () { return server_1.detectLaunchKindFromFiles; } });
Object.defineProperty(exports, "requiredJavaMajor", { enumerable: true, get: function () { return server_1.requiredJavaMajor; } });
Object.defineProperty(exports, "sanitizeServerName", { enumerable: true, get: function () { return server_1.sanitizeServerName; } });
// multiplayer
var multiplayer_1 = require("./multiplayer");
Object.defineProperty(exports, "MultiplayerManager", { enumerable: true, get: function () { return multiplayer_1.MultiplayerManager; } });
var transport_1 = require("./multiplayer/transport");
Object.defineProperty(exports, "GameBridge", { enumerable: true, get: function () { return transport_1.GameBridge; } });
var lan_1 = require("./multiplayer/lan");
Object.defineProperty(exports, "LanTransport", { enumerable: true, get: function () { return lan_1.LanTransport; } });
Object.defineProperty(exports, "discoverLanGames", { enumerable: true, get: function () { return lan_1.discoverLanGames; } });
var direct_1 = require("./multiplayer/direct");
Object.defineProperty(exports, "DirectTransport", { enumerable: true, get: function () { return direct_1.DirectTransport; } });
var webrtc_1 = require("./multiplayer/webrtc");
Object.defineProperty(exports, "WebRtcTransport", { enumerable: true, get: function () { return webrtc_1.WebRtcTransport; } });
var relay_1 = require("./multiplayer/relay");
Object.defineProperty(exports, "RelayTransport", { enumerable: true, get: function () { return relay_1.RelayTransport; } });
Object.defineProperty(exports, "encodeFrame", { enumerable: true, get: function () { return relay_1.encodeFrame; } });
Object.defineProperty(exports, "decodeFrames", { enumerable: true, get: function () { return relay_1.decodeFrames; } });
var nat_1 = require("./multiplayer/nat");
Object.defineProperty(exports, "openPort", { enumerable: true, get: function () { return nat_1.openPort; } });
Object.defineProperty(exports, "discoverUPnP", { enumerable: true, get: function () { return nat_1.discoverUPnP; } });
Object.defineProperty(exports, "mapNatPmp", { enumerable: true, get: function () { return nat_1.mapNatPmp; } });
Object.defineProperty(exports, "buildNatPmpRequest", { enumerable: true, get: function () { return nat_1.buildNatPmpRequest; } });
var redstone_1 = require("./multiplayer/redstone");
Object.defineProperty(exports, "RedstoneTransport", { enumerable: true, get: function () { return redstone_1.RedstoneTransport; } });
Object.defineProperty(exports, "makeApikey", { enumerable: true, get: function () { return redstone_1.makeApikey; } });
Object.defineProperty(exports, "parseControlLine", { enumerable: true, get: function () { return redstone_1.parseControlLine; } });
Object.defineProperty(exports, "isHttpProbe", { enumerable: true, get: function () { return redstone_1.isHttpProbe; } });
Object.defineProperty(exports, "isMinecraftHandshake", { enumerable: true, get: function () { return redstone_1.isMinecraftHandshake; } });
var terracotta_1 = require("./multiplayer/terracotta");
Object.defineProperty(exports, "TerracottaTransport", { enumerable: true, get: function () { return terracotta_1.TerracottaTransport; } });
Object.defineProperty(exports, "generateRoomCode", { enumerable: true, get: function () { return terracotta_1.generateRoomCode; } });
Object.defineProperty(exports, "normalizeRoomCode", { enumerable: true, get: function () { return terracotta_1.normalizeRoomCode; } });
Object.defineProperty(exports, "parseStatePayload", { enumerable: true, get: function () { return terracotta_1.parseStatePayload; } });
Object.defineProperty(exports, "pickNodes", { enumerable: true, get: function () { return terracotta_1.pickNodes; } });
exports.VERSION = "0.1.0";
//# sourceMappingURL=index.js.map