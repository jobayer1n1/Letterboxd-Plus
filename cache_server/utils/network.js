const os = require("os");

function isPrivateIp(ip) {
  if (ip.endsWith(".1")) return false; // skip gateway/hotspot host IPs
  return (
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal && isPrivateIp(iface.address)) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

module.exports = { getLocalIp };

