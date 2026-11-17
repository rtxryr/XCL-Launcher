/**
 * 联机传输抽象层 —— 整合「所有联机方式」的统一接口。
 *
 * 设计要点（呼应「服务器不要设在本机」）：
 *  - 每种联机方式都是一个 Transport，负责在「两台机器」间建一条双向字节通道（Tunnel）。
 *  - 需要协调的「信令 / 中继 / 房间」服务器一律是【远程端点】（可配置 URL），
 *    本机不驻留任何常驻服务；LAN/直连/端口映射是点对点，更无服务器。
 *  - GameBridge 把 Tunnel 与本机 Minecraft 游戏端口做 TCP 桥接（虚拟局域网语义）。
 */
import { EventEmitter } from "events";
import { Socket } from "net";
import { FusionError } from "../core/errors";
/** 双向字节通道（可来自 TCP / WebRTC DataChannel / 中继）。 */
export interface Tunnel extends EventEmitter {
    write(chunk: Buffer): void;
    close(): void;
    /** 对端标识信息 */
    info: PeerInfo;
}
export interface PeerInfo {
    id: string;
    name: string;
    addr: string;
    /** 建链方式：lan / direct / webrtc / relay */
    via: string;
}
/** 作为主机：开房间，接受对端 Tunnel。 */
export interface HostHandle {
    /** 可分享给客体的连接信息（IP:port / 房间码 / offer 描述） */
    connectionInfo: string;
    /** 每当有客体建链 */
    onTunnel(cb: (t: Tunnel) => void): void;
    close(): void;
}
export interface HostOptions {
    /** 展示名 */
    name?: string;
    /** 本机游戏端口（MC 开放到 LAN 的端口），用于桥接 */
    gamePort: number;
    /** 房间口令/令牌（可选） */
    token?: string;
}
export interface JoinOptions {
    /** 主机分享的连接信息 */
    connectionInfo: string;
    name?: string;
    token?: string;
}
/** 联机传输接口。 */
export interface Transport {
    readonly id: string;
    readonly name: string;
    /** 依赖的远程服务器（信令/中继）；点对点为 undefined */
    readonly remoteServer?: string;
    host(opts: HostOptions): Promise<HostHandle>;
    join(opts: JoinOptions): Promise<Tunnel>;
}
/**
 * 把 Tunnel 与本机 TCP 做双向桥接。
 * host 侧：Tunnel <-> 127.0.0.1:gamePort
 * join 侧：本地监听端口 <-> Tunnel（MC 客户端连本地端口）
 */
export declare class GameBridge {
    private server;
    /** host：把 Tunnel 桥到本机游戏端口。 */
    bridgeTunnelToGame(tunnel: Tunnel, gamePort: number): Socket;
    /** join：在本地开一个端口，把进来的 TCP 桥到 Tunnel（MC 客户端连它）。 */
    bridgeLocalPortToTunnel(tunnel: Tunnel, localPort?: number): Promise<number>;
    close(): void;
}
/** 简单的内存/Socket Tunnel 适配（TCP 场景）。 */
export declare class TcpTunnel extends EventEmitter implements Tunnel {
    private sock;
    info: PeerInfo;
    constructor(sock: Socket, info: PeerInfo);
    write(chunk: Buffer): void;
    close(): void;
}
export declare function transportError(msg: string, cause?: unknown): FusionError;
//# sourceMappingURL=transport.d.ts.map