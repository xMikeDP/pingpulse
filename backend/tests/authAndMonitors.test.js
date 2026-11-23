const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-for-unit-tests';

const { validateTargetUrl, isPrivateIp } = require('../src/utils/ssrfGuard');
const { requireAuth } = require('../src/middleware/auth');
const { computeUptimeStats } = require('../src/routes/monitors');

test('isPrivateIp blocks private, loopback, link-local, and IPv4-mapped IPv6 ranges', () => {
  const blocked = [
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.10',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ];

  for (const ip of blocked) {
    assert.equal(isPrivateIp(ip), true, `Expected ${ip} to be blocked`);
  }

  const allowed = ['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'];
  for (const ip of allowed) {
    assert.equal(isPrivateIp(ip), false, `Expected ${ip} to be allowed`);
  }
});

test('validateTargetUrl rejects non-http protocols, localhost, and private DNS resolutions', async () => {
  await assert.rejects(() => validateTargetUrl('ftp://example.com'), /Only HTTP and HTTPS/);
  await assert.rejects(() => validateTargetUrl('http://localhost:4000'), /localhost/);
  await assert.rejects(() => validateTargetUrl('http://127.0.0.1:8080/health'), /restricted or private/);
  await assert.rejects(() => validateTargetUrl('http://[::1]:3000'), /restricted or private/);

  await assert.rejects(
    () => validateTargetUrl('https://internal.corp', async () => [{ address: '10.20.30.40', family: 4 }]),
    /restricted or internal IP/
  );

  const parsed = await validateTargetUrl('https://example.com/status', async () => [
    { address: '93.184.216.34', family: 4 },
  ]);
  assert.equal(parsed.hostname, 'example.com');
});

test('requireAuth rejects missing/invalid tokens and attaches req.user for valid tokens', () => {
  const makeRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.body = data;
      return res;
    };
    return res;
  };

  const res1 = makeRes();
  let nextCalled = false;
  requireAuth({ headers: {} }, res1, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res1.statusCode, 401);

  const token = jwt.sign({ sub: 'user-123', email: 'dev@example.com' }, process.env.JWT_SECRET);
  const req2 = { headers: { authorization: `Bearer ${token}` } };
  const res2 = makeRes();
  let next2 = false;
  requireAuth(req2, res2, () => {
    next2 = true;
  });
  assert.equal(next2, true);
  assert.deepEqual(req2.user, { id: 'user-123', email: 'dev@example.com' });
});

test('computeUptimeStats calculates 24h uptime percentage and average latency', () => {
  assert.deepEqual(computeUptimeStats([]), {
    uptime24h: null,
    avgLatencyMs: null,
    totalChecks24h: 0,
  });

  const stats = computeUptimeStats([
    { isSuccess: true, latencyMs: 100 },
    { isSuccess: true, latencyMs: 200 },
    { isSuccess: false, latencyMs: 300 },
    { isSuccess: true, latencyMs: 200 },
  ]);

  assert.deepEqual(stats, {
    uptime24h: 75,
    avgLatencyMs: 200,
    totalChecks24h: 4,
  });
});
