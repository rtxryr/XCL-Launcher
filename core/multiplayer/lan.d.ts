/**
 * 局域网（LAN）联机。
 *
 * 两件事：
 *  1. 发现：监听 Minecraft「开放到 LAN」的 UDP 广播（默认 4445），
 *     解析 [MOTD]…[/MOTD][AD]端口[/AD]，得到同网段可加入的世界。
 *  2. 连接：本质是直连 TCP 到游戏端口（MC 客户端连宿主机）。
 *
 * 全程点对点，无任何常驻服务器。UDP socket 用完即关。
 */
import { HostHandle, HostOptions, JoinOptions, Transport, Tunnel } from "./transport";
export interface LanGame {
    /** 宿主机地址（广播包来源 IP） */
    addr: string;
    /** 游戏端口 */
    port: number;
    /** 世界名 / MOTD */
    motd: string;
    /** 便于直连的 ip:port */
    endpoint: string;
}
/** 解析 MC LAN 广播载荷。 */
export declare function parseLanMotd(payload: string): {
    motd: string;
    port: number;
} | null;
/** 生成一条 MC LAN 广播载荷（供「开放到 LAN」广播用）。 */
export declare function buildLanMotd(motd: string, port: number): string;
/** 局域网内发现开放到 LAN 的世界。 */
export declare function discoverLanGames(timeoutMs?: number): Promise<LanGame[]>;
/** 广播一条「开放到 LAN」通告（宿主用）。 */
export declare function broadcastLan(motd: string, gamePort: number, times?: number): void;
/** 本机局域网 IP（用于拼直连地址）。 */
export declare function localLanAddress(): string;
/**
 * LAN 传输：发现 + 直连。
 * host 侧不开常驻服务——MC「开放到 LAN」本身就是游戏在监听；
 * 这里仅负责通告与返回可分享的直连地址。
 */
export declare class LanTransport implements Transport {
    readonly id = "lan";
    readonly name = "\u5C40\u57DF\u7F51";
    readonly remoteServer: undefined;
    host(opts: HostOptions): Promise<HostHandle>;
    join(opts: JoinOptions): Promise<Tunnel>;
}
/** 供 direct/lan 共用的 TCP 直连。 */
export declare function connectTcp(host: string, port: number, via: string, name?: string): Promise<Tunnel>;
export declare function splitEndpoint(ep: string): [string, string];
//# sourceMappingURL=lan.d.ts.map