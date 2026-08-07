const dgram = require("dgram");
const os = require("os");

const DISCOVERY_PROTOCOL = "lucky-relay-discovery";
const DISCOVERY_VERSION = 1;
const DISCOVERY_PORT = 42101;
const MAX_PACKET_BYTES = 512;

function activeIpv4Interfaces(source = os.networkInterfaces()) {
  const results = [];
  for (const [name, entries] of Object.entries(source || {})) {
    for (const entry of entries || []) {
      const address = entry.address;
      if (entry.family !== "IPv4" || entry.internal || !address || !entry.netmask) continue;
      const octets = address.split(".").map(Number);
      const mask = entry.netmask.split(".").map(Number);
      if (octets.length !== 4 || mask.length !== 4 || octets.some(Number.isNaN) || mask.some(Number.isNaN)) continue;
      const network = octets.map((value, index) => value & mask[index]);
      const broadcast = octets.map((value, index) => (value & mask[index]) | (255 ^ mask[index]));
      results.push({ name, address, netmask: entry.netmask, network: network.join("."), broadcast: broadcast.join(".") });
    }
  }
  return results;
}

function validateAnnouncement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.protocol !== DISCOVERY_PROTOCOL || value.protocolVersion !== DISCOVERY_VERSION || value.type !== "announce") return null;
  const deviceId = String(value.deviceId || "");
  const ip = String(value.ip || "");
  const apiPort = Number(value.apiPort);
  if (!/^LRC-[A-Z0-9-]{4,24}$/.test(deviceId) || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return null;
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) return null;
  return {
    deviceId, previousDeviceId: value.previousDeviceId ? String(value.previousDeviceId) : null,
    identityMigrationVersion: Number(value.identityMigrationVersion || 0),
    deviceName: String(value.deviceName || "").slice(0, 80), ipAddress: ip, port: apiPort,
    firmwareVersion: String(value.firmwareVersion || "").slice(0, 32),
    apiVersion: String(value.apiVersion || ""), hardwareStandard: String(value.hardwareStandard || "").slice(0, 32),
    relayCount: Number(value.relayCount)
  };
}

class UdpDiscoveryAdapter {
  constructor({ socketFactory = type => dgram.createSocket(type), interfaces = activeIpv4Interfaces, clock = globalThis } = {}) {
    Object.assign(this, { socketFactory, interfaces, clock });
  }
  discover({ timeoutMs = 1500, signal } = {}) {
    return new Promise(resolve => {
      let done = false;
      const sockets = [], found = [], finish = () => {
        if (done) return;
        done = true;
        while (sockets.length) try { sockets.pop().close(); } catch {}
        resolve(found);
      };
      const timer = this.clock.setTimeout(finish, timeoutMs);
      const stop = () => { this.clock.clearTimeout(timer); finish(); };
      if (signal?.aborted) return stop();
      signal?.addEventListener("abort", stop, { once: true });
      const payload = Buffer.from(JSON.stringify({ protocol: DISCOVERY_PROTOCOL, protocolVersion: DISCOVERY_VERSION, type: "discover" }));
      for (const network of this.interfaces()) {
        const socket = this.socketFactory("udp4");
        sockets.push(socket);
        socket.on("message", message => {
          if (message.length > MAX_PACKET_BYTES) return;
          try {
            const result = validateAnnouncement(JSON.parse(message.toString("utf8")));
            if (result && found.length < 64) found.push(result);
          } catch {}
        });
        socket.on("error", () => {});
        socket.bind(0, network.address, () => {
          try { socket.setBroadcast(true); socket.send(payload, DISCOVERY_PORT, network.broadcast); } catch {}
        });
      }
      if (!sockets.length) stop();
    });
  }
}

function encodeDnsName(name) {
  const parts = [];
  for (const label of name.split(".")) {
    const value = Buffer.from(label);
    parts.push(Buffer.from([value.length]), value);
  }
  return Buffer.concat([...parts, Buffer.from([0])]);
}

function readDnsName(buffer, start, visited = new Set()) {
  let offset = start, consumed = 0;
  const labels = [];
  while (offset < buffer.length) {
    const length = buffer[offset];
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= buffer.length) throw Error("dns pointer");
      const pointer = ((length & 0x3f) << 8) | buffer[offset + 1];
      if (visited.has(pointer)) throw Error("dns loop");
      visited.add(pointer);
      labels.push(readDnsName(buffer, pointer, visited).name);
      consumed += 2;
      return { name: labels.filter(Boolean).join("."), bytes: consumed };
    }
    consumed += 1;
    offset += 1;
    if (length === 0) return { name: labels.join("."), bytes: consumed };
    if (length > 63 || offset + length > buffer.length) throw Error("dns label");
    labels.push(buffer.subarray(offset, offset + length).toString("utf8"));
    offset += length;
    consumed += length;
  }
  throw Error("dns name");
}

function parseMdnsAddresses(buffer) {
  if (buffer.length < 12) return [];
  const questionCount = buffer.readUInt16BE(4);
  const recordCount = buffer.readUInt16BE(6) + buffer.readUInt16BE(8) + buffer.readUInt16BE(10);
  let offset = 12;
  for (let index = 0; index < questionCount; index += 1) {
    const name = readDnsName(buffer, offset); offset += name.bytes + 4;
  }
  const addresses = new Set();
  for (let index = 0; index < recordCount && offset < buffer.length; index += 1) {
    const name = readDnsName(buffer, offset); offset += name.bytes;
    if (offset + 10 > buffer.length) break;
    const type = buffer.readUInt16BE(offset); const dataLength = buffer.readUInt16BE(offset + 8); offset += 10;
    if (offset + dataLength > buffer.length) break;
    if (type === 1 && dataLength === 4) addresses.add([...buffer.subarray(offset, offset + 4)].join("."));
    offset += dataLength;
  }
  return [...addresses].map(ipAddress => ({ ipAddress, port: 80 }));
}

class MdnsDiscoveryAdapter {
  constructor({ socketFactory = options => dgram.createSocket(options), interfaces = activeIpv4Interfaces, clock = globalThis } = {}) {
    Object.assign(this, { socketFactory, interfaces, clock });
  }
  discover({ timeoutMs = 1500, signal } = {}) {
    return new Promise(resolve => {
      const sockets = [];
      const found = new Map();
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        while (sockets.length) try { sockets.pop().close(); } catch {}
        resolve([...found.values()]);
      };
      const timer = this.clock.setTimeout(finish, timeoutMs);
      const stop = () => { this.clock.clearTimeout(timer); finish(); };
      if (signal?.aborted) return stop();
      signal?.addEventListener("abort", stop, { once: true });
      const qname = encodeDnsName("_lucky-relay._tcp.local");
      const query = Buffer.alloc(12 + qname.length + 4);
      query.writeUInt16BE(1, 4); qname.copy(query, 12);
      query.writeUInt16BE(12, 12 + qname.length); query.writeUInt16BE(1, 14 + qname.length);
      for (const network of this.interfaces()) {
        const socket = this.socketFactory({ type: "udp4", reuseAddr: true });
        sockets.push(socket);
        socket.on("error", () => {});
        socket.on("message", message => {
          if (message.length > 4096) return;
          try { for (const item of parseMdnsAddresses(message)) found.set(item.ipAddress, item); } catch {}
        });
        socket.bind(0, network.address, () => {
          try {
            socket.setMulticastInterface?.(network.address);
            socket.send(query, 5353, "224.0.0.251");
          } catch {}
        });
      }
      if (!sockets.length) stop();
    });
  }
}

module.exports = {
  DISCOVERY_PROTOCOL, DISCOVERY_VERSION, DISCOVERY_PORT, MAX_PACKET_BYTES,
  activeIpv4Interfaces, validateAnnouncement, UdpDiscoveryAdapter, MdnsDiscoveryAdapter,
  parseMdnsAddresses
};
