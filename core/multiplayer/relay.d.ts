/**
 * 中继（Relay）联机 —— P2P 打洞失败时的兜底。
 * 经【远程中继服务器】转发两台机器的游戏流量（对应 BakaXL Network / 联机盒子思路）。
 *
 * 中继服务器是【远程端点】（relayUrl 可配置），本机不驻留。
 * 协议：WebSocket 连远程中继 → JSON 握手（host/join 房间）→ 双向转发二进制帧。
 */
import { Tunnel, Transport, HostHandle, HostOptions, JoinOptions } from "./transport";
export interface RelayMessage {
    type: "host" | "join" | "accept" | "ready" | "error";
    room?: string;
    message?: string;
}
/** 长度前缀帧编解码（TCP 中继 / 测试用）。 */
export declare function encodeFrame(payload: Buffer): Buffer;
/** 从字节流里解出完整帧；返回帧与剩余字节。 */
export declare function decodeFrames(buffer: Buffer): {
    frames: Buffer[];
    rest: Buffer;
};
export interface RelayOptions {
    /** 远程中继服务器地址（ws:// 或 wss://）—— 非本机 */
    relayUrl: string;
    /** 令牌（中继服务可能要求鉴权） */
    token?: string;
}
export declare class RelayTransport implements Transport {
    private opts;
    readonly id = "relay";
    readonly name = "\u4E2D\u7EE7";
    readonly remoteServer: string;
    constructor(opts: RelayOptions);
    private connect;
    private sendJson;
    host(opts: HostOptions): Promise<HostHandle>;
    join(opts: JoinOptions): Promise<Tunnel>;
}
//# sourceMappingURL=relay.d.ts.map