#!/usr/bin/env node
"use strict";
/**
 * FusionMC 命令行入口 —— 直接驱动进程内后端门面（不经过任何本地服务器）。
 *
 * 用法示例：
 *   fusionmc versions
 *   fusionmc install 1.20.4
 *   fusionmc account:add offline steve
 *   fusionmc instance:create "我的世界" 1.20.4
 *   fusionmc launch-cmd <instanceId> <accountId>
 *   fusionmc mp:transports
 *   fusionmc mp:discover
 */
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const backend_1 = require("../backend");
const logger_1 = require("../core/logger");
const mirrors_1 = require("../net/mirrors");
const sources_1 = require("../net/sources");
const aggregator_1 = require("../download/aggregator");
const program = new commander_1.Command();
program
    .name("fusionmc")
    .description("FusionMC —— 取长补短的 Minecraft 启动器后端（下载/启动/认证/联机）")
    .version("0.1.0");
function backend() {
    return new backend_1.FusionBackend({ log: logger_1.rootLogger });
}
async function withBackend(fn) {
    const b = backend();
    await b.init();
    return fn(b);
}
// ---------- 版本 ----------
program
    .command("versions")
    .description("列出可用游戏版本")
    .option("-t, --type <type>", "过滤类型 release/snapshot")
    .action(async (opts) => {
    await withBackend(async (b) => {
        const list = await b.listVersions(opts.type);
        console.log(`共 ${list.length} 个版本：`);
        for (const v of list.slice(0, 30))
            console.log(`  ${v.id}  [${v.type}]`);
        if (list.length > 30)
            console.log(`  …（还有 ${list.length - 30} 个）`);
    });
});
program
    .command("install <versionId>")
    .description("下载安装一个游戏版本（库/资源/客户端）")
    .option("--skip-assets", "跳过资源对象（快速测试）")
    .action(async (versionId, opts) => {
    await withBackend(async (b) => {
        b.events.on("progress", (p) => {
            process.stdout.write(`\r[${p.phase}] ${p.current}/${p.total}   `);
        });
        const res = await b.installVersion(versionId, { skipAssets: opts.skipAssets });
        console.log(`\n安装完成: 库 ${res.libraries} natives ${res.natives} 资源 ${res.assets} 失败 ${res.failed}`);
    });
});
// ---------- 账号 ----------
const account = program.command("account").description("账号管理");
account
    .command("add offline <username>")
    .description("添加离线账号")
    .action(async (username) => {
    await withBackend(async (b) => {
        const acc = b.addOfflineAccount(username);
        await b.accounts.save();
        console.log(`已添加离线账号 ${acc.username} (${acc.uuid})`);
    });
});
account
    .command("list")
    .description("列出账号")
    .action(async () => {
    await withBackend(async (b) => {
        for (const a of b.accounts.list()) {
            console.log(`  ${a.id}  ${a.type}  ${a.username}  ${a.uuid}`);
        }
    });
});
// ---------- 实例 ----------
const instance = program.command("instance").description("实例管理");
instance
    .command("create <name> <gameVersion>")
    .description("创建实例")
    .action(async (name, gameVersion) => {
    await withBackend(async (b) => {
        const inst = await b.createInstance({ name, gameVersion });
        console.log(`已创建实例 ${inst.name} (${inst.id}) -> ${inst.gameVersion}`);
    });
});
instance
    .command("list")
    .description("列出实例")
    .action(async () => {
    await withBackend(async (b) => {
        for (const i of await b.listInstances()) {
            console.log(`  ${i.id}  ${i.name}  ${i.launchVersion ?? i.gameVersion}  [${i.loader.type}]`);
        }
    });
});
// ---------- 启动 ----------
program
    .command("launch-cmd <instanceId> <accountId>")
    .description("预览启动命令（不执行）")
    .action(async (instanceId, accountId) => {
    await withBackend(async (b) => {
        const cmd = await b.buildLaunchCommand(instanceId, accountId);
        console.log(cmd.join(" "));
    });
});
program
    .command("launch <instanceId> <accountId>")
    .description("启动游戏")
    .action(async (instanceId, accountId) => {
    await withBackend(async (b) => {
        b.events.on("gameOutput", (o) => console.log(`[${o.stream}] ${o.line}`));
        const res = await b.launch(instanceId, accountId);
        console.log(`游戏退出：code=${res.exitCode} signal=${res.signal}`);
    });
});
// ---------- 加载器 ----------
program
    .command("loader <instanceId> <type> <loaderVersion>")
    .description("为实例安装模组加载器（fabric/quilt/forge/neoforge）")
    .action(async (instanceId, type, loaderVersion) => {
    await withBackend(async (b) => {
        const r = await b.installLoader(instanceId, type, loaderVersion);
        console.log(`已安装 ${type} ${loaderVersion} -> 版本 ${r.versionId}`);
    });
});
// ---------- 下载源 ----------
program
    .command("sources")
    .description("列出全部下载源（官方 + 国内镜像）")
    .option("--json", "以 JSON 输出")
    .action((opts) => {
    const catalog = (0, sources_1.sourceCatalog)();
    if (opts.json) {
        console.log(JSON.stringify({ sets: catalog, manifest: (0, sources_1.versionManifestCandidates)(), java: (0, sources_1.javaRuntimeManifestCandidates)() }, null, 2));
        return;
    }
    for (const s of catalog) {
        console.log(`\n${s.name}  [${s.category}]`);
        console.log(`  官方: ${s.official}`);
        for (const m of s.mirrors)
            console.log(`  镜像: ${m}`);
        if (s.note)
            console.log(`  说明: ${s.note}`);
    }
    console.log(`\n版本清单候选（按优先级）:`);
    for (const u of (0, sources_1.versionManifestCandidates)())
        console.log(`  ${u}`);
    console.log(`\nJava 运行时清单候选:`);
    for (const u of (0, sources_1.javaRuntimeManifestCandidates)())
        console.log(`  ${u}`);
});
program
    .command("sources:probe <url>")
    .description("对某地址的所有镜像候选并行测速（Range 探针）")
    .option("-t, --timeout <ms>", "单源超时", "1500")
    .action(async (url, opts) => {
    const mm = new mirrors_1.MirrorManager("auto");
    const candidates = mm.candidates(url);
    console.log(`共 ${candidates.length} 个候选，开始并行测速…`);
    const probes = await (0, aggregator_1.probeMirrors)(candidates, { timeoutMs: Number(opts.timeout) });
    for (const p of probes) {
        if (p.ok) {
            console.log(`  ✓ ${p.latencyMs}ms  ${p.fileSize}B  Range=${p.supportsRange}  ${p.url}`);
        }
        else {
            console.log(`  ✗ 不可用  ${p.url}`);
        }
    }
});
// ---------- 一键开服 ----------
const server = program.command("server").description("一键开服务器（本地 MC 服务端）");
server
    .command("create <name> <versionId>")
    .description("创建并安装服务端（下载 jar / 跑加载器安装器 / 写配置）")
    .option("-p, --port <port>", "端口", "25565")
    .option("-m, --mem <mb>", "最大内存 MB", "2048")
    .option("--offline", "关闭正版验证（online-mode=false）")
    .action(async (name, versionId, opts) => {
    await withBackend(async (b) => {
        const e = await b.createServer({
            name,
            versionId,
            port: parseInt(opts.port, 10),
            maxMemoryMB: parseInt(opts.mem, 10),
            onlineMode: !opts.offline,
        });
        console.log(`已创建服务端 ${e.name} (${e.id})`);
        console.log(`  目录: ${e.dir}`);
        console.log(`  启动方式: ${e.launchKind ?? "?"}  Java: ${e.javaMajor ?? "?"}`);
    });
});
server
    .command("list")
    .description("列出所有服务端")
    .action(() => {
    withBackend(async (b) => {
        const list = b.listServers();
        if (list.length === 0)
            console.log("还没有服务端，用 server create 建一个");
        for (const s of list) {
            const st = b.serverStatus(s.id);
            console.log(`  ${s.id}  ${s.name}  ${s.versionId}  :${s.port}  [${st.state}]  ${s.dir}`);
        }
    });
});
server
    .command("start <id>")
    .description("启动服务端（日志实时输出）")
    .action(async (id) => {
    await withBackend(async (b) => {
        b.events.on("gameOutput", (o) => console.log(`[${o.stream}] ${o.line}`));
        const s = await b.startServer(id);
        console.log(`服务端已启动: ${s.state} 端口=${s.port} pid=${s.pid ?? "?"}`);
        console.log("按 Ctrl+C 退出启动器（服务端会继续运行；用 server stop 优雅关闭）");
    });
});
server
    .command("stop <id>")
    .description("优雅停止服务端（超时强杀）")
    .action(async (id) => {
    await withBackend(async (b) => {
        const r = await b.stopServer(id);
        console.log(r.forced ? "已强制结束（优雅停止超时）" : "已优雅停止");
    });
});
server
    .command("status [id]")
    .description("查看服务端状态")
    .action((id) => {
    withBackend(async (b) => {
        const s = b.serverStatus(id);
        console.log(JSON.stringify(s, null, 2));
    });
});
server
    .command("cmd <id> <command...>")
    .description("向服务端控制台发命令（op <玩家> / whitelist add <玩家> / save-all）")
    .action((id, parts) => {
    withBackend(async (b) => {
        const cmd = parts.join(" ");
        b.serverCommand(id, cmd);
        console.log(`> ${cmd}`);
    });
});
server
    .command("remove <id>")
    .description("删除服务端及其目录")
    .action(async (id) => {
    await withBackend(async (b) => {
        await b.removeServer(id);
        console.log(`已删除 ${id}`);
    });
});
// ---------- 联机 ----------
const mp = program.command("mp").description("联机（LAN/直连/P2P/中继）");
mp.command("transports")
    .description("列出可用联机方式")
    .action(async () => {
    await withBackend(async (b) => {
        for (const t of b.listTransports()) {
            console.log(`  ${t.id}  ${t.name}` + (t.remoteServer ? `  服务器=${t.remoteServer}` : "  （点对点，无服务器）"));
        }
    });
});
mp.command("discover")
    .description("局域网发现开放到 LAN 的世界")
    .action(async () => {
    await withBackend(async (b) => {
        const games = await b.discoverLan(4000);
        if (games.length === 0)
            console.log("未发现局域网世界");
        for (const g of games)
            console.log(`  ${g.endpoint}  ${g.motd}`);
    });
});
mp.command("host <transport> <gamePort>")
    .description("开房间（宿主）")
    .option("--map", "尝试 UPnP/NAT-PMP 端口映射")
    .action(async (transport, gamePort, opts) => {
    await withBackend(async (b) => {
        const s = await b.hostGame(transport, {
            gamePort: parseInt(gamePort, 10),
            tryPortMapping: opts.map,
        });
        console.log(`开房间成功（${s.transport}）连接信息: ${s.handle.connectionInfo}`);
        if (s.mapping)
            console.log(`端口映射: ${s.mapping.method} ${s.mapping.publicIp ?? "?"}:${s.mapping.publicPort}`);
    });
});
mp.command("join <transport> <connectionInfo>")
    .description("加入房间（客体）")
    .action(async (transport, connectionInfo) => {
    await withBackend(async (b) => {
        const s = await b.joinGame(transport, { connectionInfo });
        console.log(`已加入（${s.transport}）。MC 客户端连接 127.0.0.1:${s.localPort}`);
    });
});
program.parseAsync(process.argv).catch((e) => {
    console.error("错误:", e instanceof Error ? e.message : e);
    process.exit(1);
});
//# sourceMappingURL=main.js.map