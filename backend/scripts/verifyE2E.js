/**
 * End-to-end smoke verification against a running PingPulse backend (http://localhost:4000).
 * Usage: node backend/scripts/verifyE2E.js
 */
const BASE_URL = process.env.API_URL || 'http://localhost:4000/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const email = `e2e-${Date.now()}@pingpulse.local`;
  const password = 'Password123!';

  console.log('1. Registering test user:', email);
  const reg = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (reg.status !== 201 || !reg.body.token) {
    throw new Error(`Register failed (${reg.status}): ${JSON.stringify(reg.body)}`);
  }
  const authHeader = { Authorization: `Bearer ${reg.body.token}` };

  console.log('2. Verifying SSRF guard rejects http://127.0.0.1:4000');
  const ssrf = await request('/monitors', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ name: 'Internal', url: 'http://127.0.0.1:4000/health' }),
  });
  if (ssrf.status !== 400) {
    throw new Error(`Expected 400 for SSRF URL, got ${ssrf.status}`);
  }

  console.log('3. Creating operational monitor and failing monitor');
  const okMon = await request('/monitors', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      name: 'Example OK',
      url: 'https://example.com',
      intervalSec: 15,
      expectedStatus: 200,
    }),
  });
  const failMon = await request('/monitors', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      name: 'Mock Failing 500',
      url: 'https://httpbin.org/status/500',
      intervalSec: 15,
      expectedStatus: 200,
    }),
  });
  if (okMon.status !== 201 || failMon.status !== 201) {
    throw new Error('Failed to create test monitors');
  }

  console.log('4. Waiting 18s for background worker tick...');
  await sleep(18_000);

  const telemetryFail = await request(`/monitors/${failMon.body.id}/telemetry?hours=24`, {
    headers: authHeader,
  });
  console.log('Failing monitor logs:', telemetryFail.body.logs?.length || 0);
  console.log('Failing monitor incidents:', telemetryFail.body.incidents?.length || 0);

  console.log('5. Toggling and cleaning up test monitors');
  await request(`/monitors/${okMon.body.id}/toggle`, { method: 'PATCH', headers: authHeader });
  await request(`/monitors/${okMon.body.id}`, { method: 'DELETE', headers: authHeader });
  await request(`/monitors/${failMon.body.id}`, { method: 'DELETE', headers: authHeader });

  console.log('E2E verification complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
