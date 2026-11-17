/**
 * 直连（Direct）联机：按 IP:port 直接 TCP 连到宿主游戏端口。
 * 无发现、无服务器——纯客户端连出。常配合端口映射（nat.ts）让外网可直连。
 */
import { HostHandle, HostOptions, JoinOptions, Transport, Tunnel } from "./transport";
export declare class DirectTransport implements Transport {
    readonly id = "direct";
    readonly name = "\u76F4\u8FDE";
    readonly remoteServer: undefined;
    host(opts: HostOptions): Promise<HostHandle>;
    join(opts: JoinOptions): Promise<Tunnel>;
}
/**
 * 极简隧道（Relay/WebRTC 兜底用）：内存对，测试与本地演示用。
 * 生产用 WebRTC/Relay；这里只作抽象的最小可跑实现。
 */
export declare function loopbackTunnelPair(): [Tunnel, Tunnel];
//# sourceMappingURL=direct.d.ts.map