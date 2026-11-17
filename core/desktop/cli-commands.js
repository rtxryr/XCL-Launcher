"use strict";
/**
 * 后端命令行：与前端内置终端共享同一套命令语义。
 *
 * 前端终端（渲染进程）把整行命令原样经 `cli:exec` 通道发到这里解析执行，
 * 后端只返回「可直接打印的行」（`CliLine[]`），不关心颜色/字体；
 * 由前端按 `level` 决定前景色。这样：
 *   - 命令语义只有一份（本文件），前端不做二次解析，避免行为漂移；
 *   - 交互式确认（如删除）由前端负责，后端只认 `--yes`；
 *   - `exec()` 永不抛异常，任何失败都转成 `err` 行，终端不会白屏。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CliCommands = void 0;
exports.parseCommandLine = parseCommandLine;
exports.formatTable = formatTable;
exports.resolveServer = resolveServer;
exports.humanDuration = humanDuration;
// ---------------------------------------------------------------------------
// 行构造小工具
// ---------------------------------------------------------------------------
function line(level, text) {
    return { text, level };
}
const info = (text) => line("info", text);
const warn = (text) => line("warn", text);
const err = (text) => line("err", text);
const ok = (text) => line("ok", text);
const dim = (text) => line("dim", text);
function rawMessage(e) {
    if (e instanceof Error)
        return e.message;
    if (typeof e === "string")
        return e;
    return String(e);
}
// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------
/** 把一个字符折算成终端显示宽度（CJK/全角按 2 计）。 */
function charWidth(ch) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6)) {
        return 2;
    }
    return 1;
}
/** 字符串的终端显示宽度。 */
function visualWidth(text) {
    let width = 0;
    for (const ch of text)
        width += charWidth(ch);
    return width;
}
/**
 * 把一行切成 token：支持双引号 / 单引号包裹（引号内的空格不切分），
 * 引号本身不进入结果；`""` 会产生一个空 token。
 */
function tokenize(text) {
    const out = [];
    let cur = "";
    let quote = null;
    let started = false;
    for (const ch of text) {
        if (quote) {
            if (ch === quote)
                quote = null;
            else
                cur += ch;
            started = true;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            started = true;
            continue;
        }
        if (ch === " " || ch === "\t") {
            if (started) {
                out.push(cur);
                cur = "";
                started = false;
            }
            continue;
        }
        cur += ch;
        started = true;
    }
    if (started)
        out.push(cur);
    return out;
}
/** 解析一行命令：支持 --key value / --flag / 引号包裹参数。空行返回 name:"" */
function parseCommandLine(line_) {
    const tokens = tokenize(line_);
    if (tokens.length === 0)
        return { name: "", args: [], flags: {} };
    const name = tokens[0].toLowerCase();
    const args = [];
    const flags = {};
    for (let i = 1; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token.startsWith("--") && token.length > 2) {
            const key = token.slice(2);
            const next = tokens[i + 1];
            if (next !== undefined && !next.startsWith("--")) {
                flags[key] = next;
                i += 1;
            }
            else {
                flags[key] = true;
            }
            continue;
        }
        args.push(token);
    }
    return { name, args, flags };
}
/** 把表格对齐成等宽文本（列宽按内容最大宽度，2 空格分隔），返回字符串数组 */
function formatTable(rows, headers) {
    const all = headers ? [headers, ...rows] : rows;
    if (all.length === 0)
        return [];
    const cols = all.reduce((max, r) => Math.max(max, r.length), 0);
    if (cols === 0)
        return all.map(() => "");
    const widths = [];
    for (let c = 0; c < cols; c += 1)
        widths.push(0);
    for (const row of all) {
        for (let c = 0; c < cols; c += 1) {
            const cell = row[c] ?? "";
            widths[c] = Math.max(widths[c], visualWidth(cell));
        }
    }
    return all.map((row) => {
        const cells = [];
        for (let c = 0; c < cols; c += 1) {
            const cell = row[c] ?? "";
            if (c === cols - 1) {
                cells.push(cell); // 末列不补空格，避免行尾空白
                continue;
            }
            const pad = widths[c] - visualWidth(cell);
            cells.push(cell + " ".repeat(pad > 0 ? pad : 0));
        }
        return cells.join("  ").replace(/\s+$/, "");
    });
}
/** 按 id → 名称精确 → 名称前缀唯一 匹配服务器，返回 { hit } 或 { candidates } */
function resolveServer(list, token) {
    const key = token.trim().toLowerCase();
    if (key === "")
        return null;
    const byId = list.find((s) => s.id.toLowerCase() === key);
    if (byId)
        return { hit: byId };
    const exact = list.filter((s) => s.name.toLowerCase() === key);
    if (exact.length === 1)
        return { hit: exact[0] };
    if (exact.length > 1)
        return { candidates: exact };
    const prefixed = list.filter((s) => s.name.toLowerCase().startsWith(key));
    if (prefixed.length === 1)
        return { hit: prefixed[0] };
    if (prefixed.length > 1)
        return { candidates: prefixed };
    return null;
}
/** 相对时间：ms → "1m20s" / "2h3m" / "12s" */
function humanDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0)
        return "0s";
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60)
        return `${totalSec}s`;
    const totalMin = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (totalMin < 60)
        return sec === 0 ? `${totalMin}m` : `${totalMin}m${sec}s`;
    const totalHour = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    if (totalHour < 24)
        return min === 0 ? `${totalHour}h` : `${totalHour}h${min}m`;
    const day = Math.floor(totalHour / 24);
    const hour = totalHour % 24;
    return hour === 0 ? `${day}d` : `${day}d${hour}h`;
}
// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
/** 支持一键开服的版本清单（与 launcher 侧对齐，按新→旧排序）。 */
const KNOWN_VERSIONS = [
    "1.21.4",
    "1.21.1",
    "1.20.6",
    "1.20.1",
    "1.19.4",
    "1.18.2",
    "1.16.5",
    "1.12.2",
    "1.8.9",
];
const HELP_ROWS = [
    ["help", "显示命令表"],
    ["ls / list", "列出所有服务器与状态"],
    ["status [id或名称]", "查看运行状态（pid / 运行时长）"],
    ["create <版本> [--port N] [--mem MB] [--name 名称] [--motd 文本]", "创建并安装服务器"],
    ["start <id或名称>", "启动服务器"],
    ["stop <id或名称>", "停止服务器"],
    ["restart <id或名称>", "重启服务器"],
    ["rm <id或名称> --yes", "删除服务器（必须显式 --yes）"],
    ["say [--id id] <文本>", "向运行中的服务器广播聊天"],
    ["cmd <id> <命令>", "向服务器控制台下发命令"],
    ["ver / versions", "查看支持的版本清单"],
];
const USAGE_HINT = "输入 help 查看全部命令";
// ---------------------------------------------------------------------------
// CliCommands
// ---------------------------------------------------------------------------
class CliCommands {
    backend;
    log;
    constructor(ctx) {
        this.backend = ctx.backend;
        this.log = ctx.log;
    }
    /** 执行一行命令，永不抛异常，错误转成 err 行 */
    async exec(commandLine) {
        try {
            const cmd = parseCommandLine(commandLine);
            if (cmd.name === "")
                return { lines: [] };
            this.log?.debug(`终端命令：${commandLine.trim()}`);
            switch (cmd.name) {
                case "help":
                case "?":
                    return this.help();
                case "ls":
                case "list":
                    return this.list();
                case "status":
                    return this.status(cmd);
                case "create":
                    return await this.create(cmd);
                case "start":
                    return await this.start(cmd);
                case "stop":
                    return await this.stop(cmd);
                case "restart":
                    return await this.restart(cmd);
                case "rm":
                case "remove":
                case "delete":
                    return await this.remove(cmd);
                case "say":
                    return this.say(cmd);
                case "cmd":
                    return this.consoleCommand(cmd);
                case "ver":
                case "version":
                case "versions":
                    return this.versions();
                default:
                    return { lines: [err(`未知命令：${cmd.name}（${USAGE_HINT}）`)] };
            }
        }
        catch (e) {
            const msg = rawMessage(e).trim() || "未知错误";
            this.log?.warn(`终端命令失败：${msg}`);
            return { lines: [{ text: `err ${msg}`, level: "err" }], mutated: false };
        }
    }
    // -------------------------------------------------------------------------
    // 查询类
    // -------------------------------------------------------------------------
    help() {
        const rows = HELP_ROWS.map(([name, desc]) => [name, desc]);
        return {
            lines: [
                dim("X Craft Launcher 终端命令："),
                ...formatTable(rows).map((t) => dim(t)),
                dim(`提示：<id或名称> 支持 id / 名称精确 / 名称前缀唯一匹配，名称含空格请加引号；${USAGE_HINT}`),
            ],
        };
    }
    list() {
        const entries = this.entries();
        if (entries.length === 0) {
            return { lines: [info("还没有服务器，使用 create <版本> 创建一个")] };
        }
        const statuses = this.statuses();
        const byId = new Map(statuses.map((s) => [s.id, s]));
        const rows = entries.map((e) => {
            const st = byId.get(e.id);
            return [e.name, e.versionId, `:${e.port}`, st?.state ?? "stopped"];
        });
        const running = statuses.filter((s) => s.state === "running").length;
        return {
            lines: [
                ...formatTable(rows, ["名称", "版本", "端口", "状态"]).map((t) => info(t)),
                dim(`共 ${entries.length} 台，${running} running`),
            ],
        };
    }
    status(cmd) {
        const token = cmd.args[0];
        if (!token) {
            const statuses = this.statuses();
            if (statuses.length === 0)
                return { lines: [info("还没有服务器")] };
            const byId = new Map(this.entries().map((e) => [e.id, e]));
            const rows = statuses.map((s) => {
                const entry = byId.get(s.id);
                return [
                    entry?.name ?? s.id,
                    entry?.versionId ?? "-",
                    `:${s.port}`,
                    s.state,
                    s.pid === undefined ? "-" : String(s.pid),
                    this.uptimeOf(s),
                ];
            });
            const running = statuses.filter((s) => s.state === "running").length;
            return {
                lines: [
                    ...formatTable(rows, ["名称", "版本", "端口", "状态", "pid", "运行时长"]).map((t) => info(t)),
                    dim(`共 ${statuses.length} 台，${running} running`),
                ],
            };
        }
        const entry = this.requireServer(token);
        const st = this.statusOf(entry.id);
        const head = ok(`${entry.name}（${entry.id}）v${entry.versionId} :${entry.port} ${st?.state ?? "stopped"}`);
        const lines = [head];
        if (st?.pid !== undefined)
            lines.push(info(`pid ${st.pid}`));
        lines.push(info(`已运行 ${this.uptimeOf(st)}`));
        if (st?.message)
            lines.push(warn(st.message));
        return { lines };
    }
    versions() {
        const grid = [];
        for (let i = 0; i < KNOWN_VERSIONS.length; i += 3) {
            grid.push(KNOWN_VERSIONS.slice(i, i + 3).map((v) => v));
        }
        return {
            lines: [
                info("支持一键开服的版本："),
                ...formatTable(grid).map((t) => dim(t)),
                dim("用法：create <版本> [--port N] [--mem MB] [--name 名称] [--motd 文本]"),
                dim('示例：create 1.20.6 --port 25566 --mem 2048 --name "我的服"'),
            ],
        };
    }
    // -------------------------------------------------------------------------
    // 变更类
    // -------------------------------------------------------------------------
    async create(cmd) {
        const spec = this.buildSpec(cmd);
        const entry = await this.backend.createServer(spec);
        const lines = [
            ok(`已创建 ${entry.name}（${entry.id}）`),
            info(`版本 ${entry.versionId}　端口 :${entry.port}`),
        ];
        if (spec.maxMemoryMB !== undefined)
            lines.push(info(`内存 ${spec.maxMemoryMB} MB`));
        if (spec.motd !== undefined)
            lines.push(dim(`motd ${spec.motd}`));
        lines.push(dim(`启动它：start ${entry.id}`));
        return { lines, mutated: true };
    }
    async start(cmd) {
        const entry = this.requireServer(this.requireArg(cmd, "start <id或名称>"));
        const st = await this.backend.startServer(entry.id);
        return {
            lines: [ok(`已启动 ${entry.name} :${st.port}`), dim(`状态 ${st.state}`)],
            mutated: true,
        };
    }
    async stop(cmd) {
        const entry = this.requireServer(this.requireArg(cmd, "stop <id或名称>"));
        const res = await this.backend.stopServer(entry.id);
        const lines = [ok(`已停止 ${entry.name}`)];
        if (res.forced)
            lines.push(warn("进程未在超时内退出，已强制结束"));
        return { lines, mutated: true };
    }
    async restart(cmd) {
        const entry = this.requireServer(this.requireArg(cmd, "restart <id或名称>"));
        const lines = [];
        try {
            await this.backend.stopServer(entry.id);
            lines.push(ok(`已停止 ${entry.name}`));
        }
        catch (e) {
            // 重启场景下停止失败不阻断：可能本来就没在运行
            lines.push(warn(`停止时出错（已忽略）：${rawMessage(e)}`));
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 800);
        });
        const st = await this.backend.startServer(entry.id);
        lines.push(ok(`已重新启动 ${entry.name} :${st.port}`));
        return { lines, mutated: true };
    }
    async remove(cmd) {
        const token = this.requireArg(cmd, "rm <id或名称> --yes");
        const confirmed = cmd.flags["yes"] === true || cmd.flags["yes"] === "true";
        if (!confirmed) {
            // 后端不做交互式确认：先要求前端二次确认，再带 --yes 重发
            const matched = resolveServer(this.entries(), token);
            const label = matched !== null && "hit" in matched ? `${matched.hit.name}（${matched.hit.id}）` : token;
            return {
                lines: [
                    warn(`将删除 ${label} 及其目录，确认删除请加 --yes`),
                    dim("删除不可恢复；请先 stop 再删除"),
                ],
                mutated: false,
            };
        }
        const entry = this.requireServer(token);
        this.log?.warn(`终端删除服务器：${entry.id}`);
        await this.backend.removeServer(entry.id);
        return { lines: [ok(`已删除 ${entry.name}（${entry.id}）`)], mutated: true };
    }
    say(cmd) {
        const text = cmd.args.join(" ").trim();
        if (text === "")
            throw new Error("用法：say [--id id] <文本>");
        const idFlag = cmd.flags["id"];
        let target;
        if (typeof idFlag === "string" && idFlag.trim() !== "") {
            const entry = this.requireServer(idFlag);
            const st = this.statusOf(entry.id);
            if (st?.state !== "running") {
                throw new Error(`${entry.name} 未在运行（${st?.state ?? "stopped"}）`);
            }
            target = entry;
        }
        else {
            const running = this.statuses().filter((s) => s.state === "running");
            if (running.length === 0)
                throw new Error("没有运行中的服务器，请先 start");
            if (running.length > 1) {
                const entries = this.entries();
                const names = running
                    .map((s) => entries.find((e) => e.id === s.id)?.name ?? s.id)
                    .join("、");
                throw new Error(`有多个运行中的服务器（${names}），请用 say --id <id> <文本>`);
            }
            const only = running[0];
            const entry = this.entries().find((e) => e.id === only.id);
            target = entry ?? { id: only.id, name: only.id };
        }
        this.backend.serverCommand(target.id, `say ${text}`);
        return { lines: [ok(`已发送到 ${target.name}：say ${text}`)] };
    }
    consoleCommand(cmd) {
        const idToken = cmd.args[0];
        const rest = cmd.args.slice(1).join(" ").trim();
        if (!idToken || rest === "")
            throw new Error("用法：cmd <id> <任意控制台命令>");
        const entry = this.requireServer(idToken);
        this.backend.serverCommand(entry.id, rest);
        return { lines: [ok(`已发送到 ${entry.name}：${rest}`)] };
    }
    // -------------------------------------------------------------------------
    // 内部工具
    // -------------------------------------------------------------------------
    entries() {
        return this.backend.listServers();
    }
    statuses() {
        const raw = this.backend.serverStatus();
        return Array.isArray(raw) ? raw : [raw];
    }
    statusOf(id) {
        return this.statuses().find((s) => s.id === id);
    }
    uptimeOf(st) {
        if (!st || st.state !== "running" || st.startedAt === undefined)
            return "-";
        return humanDuration(Date.now() - st.startedAt);
    }
    requireArg(cmd, usage) {
        const token = cmd.args[0];
        if (!token)
            throw new Error(`用法：${usage}`);
        return token;
    }
    /** id / 名称精确 / 名称前缀唯一 → 条目；否则抛错（由 exec 转成 err 行）。 */
    requireServer(token) {
        const entries = this.entries();
        const matched = resolveServer(entries, token);
        if (matched === null)
            throw new Error(`未找到服务器：${token}`);
        if ("candidates" in matched) {
            const names = matched.candidates.map((c) => `${c.name}(${c.id})`).join("、");
            throw new Error(`「${token}」匹配到多个服务器：${names}，请用 id 精确指定`);
        }
        return matched.hit;
    }
    strFlag(flags, key) {
        const v = flags[key];
        if (typeof v !== "string")
            return undefined;
        const trimmed = v.trim();
        return trimmed === "" ? undefined : trimmed;
    }
    intFlag(flags, key, min, max) {
        const v = flags[key];
        if (v === undefined)
            return undefined;
        if (typeof v !== "string")
            throw new Error(`--${key} 需要一个数值`);
        const n = Number(v);
        if (!Number.isFinite(n) || !Number.isInteger(n))
            throw new Error(`--${key} 必须是整数`);
        if (n < min || n > max)
            throw new Error(`--${key} 超出范围 ${min}-${max}`);
        return n;
    }
    /** 校验并组装 ServerSpec。 */
    buildSpec(cmd) {
        const version = cmd.args[0];
        if (!version) {
            throw new Error('用法：create <版本> [--port N] [--mem MB] [--name 名称] [--motd 文本]');
        }
        if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
            throw new Error(`版本号格式不正确：${version}（示例 1.20.6 / 1.21，ver 查看清单）`);
        }
        const spec = {
            name: this.strFlag(cmd.flags, "name") ?? `MC-${version}`,
            versionId: version,
        };
        const port = this.intFlag(cmd.flags, "port", 1, 65535);
        if (port !== undefined)
            spec.port = port;
        const mem = this.intFlag(cmd.flags, "mem", 512, 32768);
        if (mem !== undefined)
            spec.maxMemoryMB = mem;
        const motd = this.strFlag(cmd.flags, "motd");
        if (motd !== undefined)
            spec.motd = motd;
        return spec;
    }
}
exports.CliCommands = CliCommands;
//# sourceMappingURL=cli-commands.js.map