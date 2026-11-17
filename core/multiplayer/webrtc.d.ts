/**
 * WebRTC P2P 联机（虚拟局域网）。
 *
 * 两台机器 NAT 后也能直连：经【远程信令服务器】交换 SDP/ICE，
 * 打洞后用 DataChannel 传游戏流量，再 GameBridge 桥到本机游戏端口。
 *
 * 信令服务器是【远程端点】（signalingUrl 可配置），本机不驻留。
 * 依赖可选包 node-datachannel（原生）；未安装时给出清晰提示。
 * 取长补短：对应 XMCL 的 node-datachannel P2P、BakaXL 的虚拟局域网。
 */
import { Tunnel, Transport, HostHandle, HostOptions, JoinOptions } from "./transport";
/** 信令消息（经远程 WebSocket 交换）。 */
export interface SignalMessage {
    type: "host" | "join" | "offer" | "answer" | "ice" | "ready" | "error";
    room?: string;
    payload?: unknown;
}
export interface WebRtcOptions {
    /** 远程信令服务器地址（ws:// 或 wss://）—— 非本机 */
    signalingUrl: string;
    /** 房间号（由 host 生成、分享给客体） */
    room?: string;
    /** STUN/TURN（打洞辅助），默认用公共 STUN */
    iceServers?: Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
    }>;
}
export declare class WebRtcTransport implements Transport {
    private opts;
    readonly id = "webrtc";
    readonly name = "P2P\uFF08WebRTC\uFF09";
    readonly remoteServer: string;
    constructor(opts: WebRtcOptions);
    /** 经远程信令收发（WebSocket）。 */
    private connectSignaling;
    host(opts: HostOptions): Promise<HostHandle>;
    join(opts: JoinOptions): Promise<Tunnel>;
}
//# sourceMappingURL=webrtc.d.ts.map