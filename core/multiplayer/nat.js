"use strict";
/**
 * 端口映射：UPnP IGD + NAT-PMP。
 * 目的：宿主「开房间」后，把本机游戏端口映射到公网，外网可直连。
 * 只与本地网关/路由器通信，不涉及任何常驻服务器。
 *
 * UPnP：SSDP 发现 → 取设备描述 → SOAP AddPortMapping。
 * NAT-PMP：UDP 发网关:5351 的映射请求。
 * 两者返回公网地址/端口，失败则回退「内网直连 + 中继」。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNatPmpRequest = buildNatPmpRequest;
exports.parseNatPmpResponse = parseNatPmpResponse;
exports.mapNatPmp = mapNatPmp;
exports.buildSsdpSearch = buildSsdpSearch;
exports.discoverUPnP = discoverUPnP;
exports.addPortMappingUPnP = addPortMappingUPnP;
exports.localIPv4 = localIPv4;
exports.openPort = openPort;
const dgram_1 = require("dgram");
const os_1 = require("os");
const errors_1 = require("../core/errors");
const http_1 = require("../net/http");
// ---------- NAT-PMP ----------
/** 构造 NAT-PMP 映射请求报文（opcode=2 TCP / 1 UDP）。 */
function buildNatPmpRequest(protocol, internalPort, suggestedPublicPort = 0, lifetimeSeconds = 3600) {
    const buf = Buffer.alloc(12);
    buf.writeUInt8(0, 0); // version
    buf.writeUInt8(protocol === "TCP" ? 2 : 1, 1); // opcode
    buf.writeUInt16BE(0, 2); // reserved
    buf.writeUInt16BE(internalPort, 4);
    buf.writeUInt16BE(suggestedPublicPort, 6);
    buf.writeUInt32BE(lifetimeSeconds, 8);
    return buf;
}
/** 解析 NAT-PMP 响应。 */
function parseNatPmpResponse(buf) {
    if (buf.length < 16)
        return null;
    const result = buf.readUInt16BE(2);
    if (result !== 0)
        return null;
    return { publicPort: buf.readUInt16BE(10), lifetime: buf.readUInt32BE(12) };
}
/** 发送 NAT-PMP 映射请求。 */
async function mapNatPmp(gateway, protocol, internalPort) {
    const req = buildNatPmpRequest(protocol, internalPort);
    return new Promise((resolve, reject) => {
        const sock = (0, dgram_1.createSocket)("udp4");
        const timer = setTimeout(() => {
            sock.close();
            reject(new errors_1.FusionError("MULTIPLAYER", "NAT-PMP 网关无响应"));
        }, 3000);
        sock.on("message", (msg) => {
            clearTimeout(timer);
            sock.close();
            const r = parseNatPmpResponse(msg);
            if (!r)
                return reject(new errors_1.FusionError("MULTIPLAYER", "NAT-PMP 响应无效"));
            resolve({
                publicPort: r.publicPort,
                protocol,
                method: "natpmp",
                leaseSeconds: r.lifetime,
            });
        });
        sock.on("error", (e) => {
            clearTimeout(timer);
            reject(new errors_1.FusionError("MULTIPLAYER", "NAT-PMP 发送失败", { cause: e }));
        });
        sock.send(req, 5351, gateway);
    });
}
// ---------- UPnP IGD ----------
const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
/** SSDP M-SEARCH 发现消息。 */
function buildSsdpSearch() {
    return [
        "M-SEARCH * HTTP/1.1",
        `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        "MX: 2",
        "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1",
        "",
        "",
    ].join("\r\n");
}
/** 发现 UPnP 网关（SSDP）。 */
function discoverUPnP(timeoutMs = 2500) {
    return new Promise((resolve) => {
        const sock = (0, dgram_1.createSocket)("udp4");
        let resolved = false;
        const finish = (dev) => {
            if (resolved)
                return;
            resolved = true;
            try {
                sock.close();
            }
            catch {
                /* noop */
            }
            resolve(dev);
        };
        sock.on("error", () => finish(null));
        sock.on("message", async (msg, rinfo) => {
            const text = msg.toString("utf-8");
            const location = /LOCATION:\s*(.+)/i.exec(text)?.[1]?.trim();
            if (!location)
                return;
            try {
                const dev = await fetchUpnpService(location, rinfo.address);
                finish(dev);
            }
            catch {
                /* 尝试下一个 */
            }
        });
        sock.bind(() => {
            try {
                sock.addMembership(SSDP_ADDR);
            }
            catch {
                /* 无组播权限也可单播 */
            }
            sock.send(buildSsdpSearch(), SSDP_PORT, SSDP_ADDR);
        });
        setTimeout(() => finish(null), timeoutMs);
    });
}
/** 拉设备描述 XML，解析出 WANIPConnection 的 controlURL。 */
async function fetchUpnpService(location, ip) {
    const res = await (0, http_1.httpRequest)(location, { timeoutMs: 4000 });
    const xml = await res.text();
    // 找 WANIPConnection 或 WANPPPConnection 服务
    const svcType = /urn:schemas-upnp-org:service:(WANIPConnection|WANPPPConnection):1/.exec(xml)?.[0] ??
        "urn:schemas-upnp-org:service:WANIPConnection:1";
    const controlUrl = /<controlURL>([^<]+)<\/controlURL>/i.exec(xml)?.[1];
    if (!controlUrl)
        return null;
    // 拼绝对 URL
    const base = new URL(location);
    const abs = new URL(controlUrl, base).toString();
    return { location, serviceType: svcType, controlUrl: abs };
}
function soapEnvelope(serviceType, action, args) {
    const body = args.map(([k, v]) => `<${k}>${v}</${k}>`).join("");
    return (`<?xml version="1.0"?>` +
        `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
        `<s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body>` +
        `</s:Envelope>`);
}
/** UPnP AddPortMapping。 */
async function addPortMappingUPnP(dev, protocol, externalPort, internalPort, internalClient, description = "FusionMC", leaseSeconds = 3600) {
    const xml = soapEnvelope(dev.serviceType, "AddPortMapping", [
        ["NewRemoteHost", ""],
        ["NewExternalPort", String(externalPort)],
        ["NewProtocol", protocol],
        ["NewInternalPort", String(internalPort)],
        ["NewInternalClient", internalClient],
        ["NewEnabled", "1"],
        ["NewPortMappingDescription", description],
        ["NewLeaseDuration", String(leaseSeconds)],
    ]);
    const res = await fetch(dev.controlUrl, {
        method: "POST",
        headers: {
            "content-type": 'text/xml; charset="utf-8"',
            soapaction: `"${dev.serviceType}#AddPortMapping"`,
        },
        body: xml,
        signal: AbortSignal.timeout(5000),
    }).catch((e) => {
        throw new errors_1.FusionError("MULTIPLAYER", "UPnP AddPortMapping 请求失败", { cause: e });
    });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new errors_1.FusionError("MULTIPLAYER", `UPnP 映射失败 HTTP ${res.status}: ${t.slice(0, 120)}`);
    }
    // 尝试取公网 IP
    let publicIp;
    try {
        const ipXml = soapEnvelope(dev.serviceType, "GetExternalIPAddress", []);
        const ipRes = await fetch(dev.controlUrl, {
            method: "POST",
            headers: {
                "content-type": 'text/xml; charset="utf-8"',
                soapaction: `"${dev.serviceType}#GetExternalIPAddress"`,
            },
            body: ipXml,
            signal: AbortSignal.timeout(4000),
        });
        const ipText = await ipRes.text();
        publicIp = /<NewExternalIPAddress>([^<]+)<\/NewExternalIPAddress>/.exec(ipText)?.[1];
    }
    catch {
        /* 可选 */
    }
    return {
        publicIp,
        publicPort: externalPort,
        protocol,
        method: "upnp",
        leaseSeconds,
    };
}
/** 本机内网 IP（用于 UPnP InternalClient）。 */
function localIPv4() {
    const nets = (0, os_1.networkInterfaces)();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] ?? []) {
            if (net.family === "IPv4" && !net.internal)
                return net.address;
        }
    }
    return "127.0.0.1";
}
/**
 * 一步映射：先试 UPnP，失败回退 NAT-PMP。
 * 用于宿主开房间后对外暴露游戏端口。
 */
async function openPort(protocol, port, gateway) {
    try {
        const dev = await discoverUPnP();
        if (dev) {
            return await addPortMappingUPnP(dev, protocol, port, port, localIPv4());
        }
    }
    catch {
        /* fallthrough */
    }
    if (gateway) {
        try {
            return await mapNatPmp(gateway, protocol, port);
        }
        catch {
            /* fallthrough */
        }
    }
    return null;
}
//# sourceMappingURL=nat.js.map