/**
 * 端口映射：UPnP IGD + NAT-PMP。
 * 目的：宿主「开房间」后，把本机游戏端口映射到公网，外网可直连。
 * 只与本地网关/路由器通信，不涉及任何常驻服务器。
 *
 * UPnP：SSDP 发现 → 取设备描述 → SOAP AddPortMapping。
 * NAT-PMP：UDP 发网关:5351 的映射请求。
 * 两者返回公网地址/端口，失败则回退「内网直连 + 中继」。
 */
export interface MappingResult {
    /** 公网 IP（UPnP 获取；NAT-PMP 可能未知） */
    publicIp?: string;
    /** 映射到的公网端口 */
    publicPort: number;
    /** 协议 */
    protocol: "TCP" | "UDP";
    /** 使用的方式 */
    method: "upnp" | "natpmp";
    /** 生命周期（秒），0=永久 */
    leaseSeconds: number;
}
/** 构造 NAT-PMP 映射请求报文（opcode=2 TCP / 1 UDP）。 */
export declare function buildNatPmpRequest(protocol: "TCP" | "UDP", internalPort: number, suggestedPublicPort?: number, lifetimeSeconds?: number): Buffer;
/** 解析 NAT-PMP 响应。 */
export declare function parseNatPmpResponse(buf: Buffer): {
    publicPort: number;
    lifetime: number;
} | null;
/** 发送 NAT-PMP 映射请求。 */
export declare function mapNatPmp(gateway: string, protocol: "TCP" | "UDP", internalPort: number): Promise<MappingResult>;
/** SSDP M-SEARCH 发现消息。 */
export declare function buildSsdpSearch(): string;
export interface UPnPDevice {
    location: string;
    serviceType: string;
    controlUrl: string;
    externalIpUrl?: string;
}
/** 发现 UPnP 网关（SSDP）。 */
export declare function discoverUPnP(timeoutMs?: number): Promise<UPnPDevice | null>;
/** UPnP AddPortMapping。 */
export declare function addPortMappingUPnP(dev: UPnPDevice, protocol: "TCP" | "UDP", externalPort: number, internalPort: number, internalClient: string, description?: string, leaseSeconds?: number): Promise<MappingResult>;
/** 本机内网 IP（用于 UPnP InternalClient）。 */
export declare function localIPv4(): string;
/**
 * 一步映射：先试 UPnP，失败回退 NAT-PMP。
 * 用于宿主开房间后对外暴露游戏端口。
 */
export declare function openPort(protocol: "TCP" | "UDP", port: number, gateway?: string): Promise<MappingResult | null>;
//# sourceMappingURL=nat.d.ts.map