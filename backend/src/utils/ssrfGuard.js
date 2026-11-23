const dns = require('node:dns').promises;
const net = require('node:net');

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }

  const [a, b] = parts;

  // 0.0.0.0/8 (unspecified), 10.0.0.0/8 (private), 127.0.0.0/8 (loopback)
  if (a === 0 || a === 10 || a === 127) return true;
  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (private)
  if (a === 192 && b === 168) return true;
  // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved/broadcast)
  if (a >= 224) return true;

  return false;
}

function parseIPv6Groups(ip) {
  const clean = ip.split('%')[0].toLowerCase();
  const halves = clean.split('::');
  if (halves.length > 2) return null;

  const expandPart = (part) => {
    if (!part) return [];
    const tokens = part.split(':');
    const groups = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.includes('.')) {
        // Embedded IPv4 in last position (e.g., ::ffff:127.0.0.1)
        if (i !== tokens.length - 1 || net.isIPv4(token) === false) return null;
        const octets = token.split('.').map(Number);
        groups.push((octets[0] << 8) | octets[1]);
        groups.push((octets[2] << 8) | octets[3]);
      } else {
        const val = parseInt(token, 16);
        if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
        groups.push(val);
      }
    }
    return groups;
  };

  const left = expandPart(halves[0]);
  if (!left) return null;

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }

  const right = expandPart(halves[1]);
  if (!right) return null;

  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;

  return [...left, ...new Array(missing).fill(0), ...right];
}

function isPrivateIPv6(ip) {
  const groups = parseIPv6Groups(ip);
  if (!groups) return true;

  const allZeroExceptLast = groups.slice(0, 7).every((g) => g === 0);
  // :: (unspecified) and ::1 (loopback)
  if (allZeroExceptLast && (groups[7] === 0 || groups[7] === 1)) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96)
  const isV4Mapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;
  if (isV4Mapped) {
    const ipv4 = [
      (groups[6] >> 8) & 0xff,
      groups[6] & 0xff,
      (groups[7] >> 8) & 0xff,
      groups[7] & 0xff,
    ].join('.');
    return isPrivateIPv4(ipv4);
  }

  // fc00::/7 (Unique Local Addresses)
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 (Link-Local)
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  // ff00::/8 (Multicast)
  if ((groups[0] & 0xff00) === 0xff00) return true;

  return false;
}

function isPrivateIp(ip) {
  const ipVersion = net.isIP(ip);
  if (ipVersion === 4) return isPrivateIPv4(ip);
  if (ipVersion === 6) return isPrivateIPv6(ip);
  return true;
}

async function validateTargetUrl(inputUrl, lookupFn = (host) => dns.lookup(host, { all: true })) {
  if (typeof inputUrl !== 'string' || !inputUrl.trim()) {
    throw new Error('URL is required');
  }

  let parsed;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) {
    throw new Error('URL must include a valid hostname');
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Target hostname is restricted (localhost)');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('Target IP address is in a restricted or private range');
    }
    return parsed;
  }

  let records;
  try {
    records = await lookupFn(hostname);
  } catch {
    throw new Error('Unable to resolve target hostname');
  }

  const addresses = Array.isArray(records) ? records : [records];
  if (addresses.length === 0) {
    throw new Error('Unable to resolve target hostname');
  }

  for (const record of addresses) {
    const addr = typeof record === 'string' ? record : record.address;
    if (!addr || isPrivateIp(addr)) {
      throw new Error('Target URL resolves to a restricted or internal IP address');
    }
  }

  return parsed;
}

module.exports = {
  isPrivateIp,
  isPrivateIPv4,
  isPrivateIPv6,
  validateTargetUrl,
};
