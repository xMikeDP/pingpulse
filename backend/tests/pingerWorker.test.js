const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyStatus,
  isMonitorDue,
  probeMonitor,
  recordProbeResult,
  runWorkerTick,
} = require('../src/worker/pinger');

test('classifyStatus returns OPERATIONAL, DEGRADED, or DOWN based on success and latency', () => {
  assert.equal(classifyStatus(true, 150), 'OPERATIONAL');
  assert.equal(classifyStatus(true, 2000), 'OPERATIONAL');
  assert.equal(classifyStatus(true, 2001), 'DEGRADED');
  assert.equal(classifyStatus(false, 100), 'DOWN');
  assert.equal(classifyStatus(false, 5000), 'DOWN');
});

test('isMonitorDue respects pause state and intervalSec', () => {
  const now = 1_000_000;
  assert.equal(isMonitorDue({ isPaused: true, lastCheckedAt: null, intervalSec: 60 }, now), false);
  assert.equal(isMonitorDue({ isPaused: false, lastCheckedAt: null, intervalSec: 60 }, now), true);
  assert.equal(
    isMonitorDue({ isPaused: false, lastCheckedAt: new Date(now - 59_000), intervalSec: 60 }, now),
    false
  );
  assert.equal(
    isMonitorDue({ isPaused: false, lastCheckedAt: new Date(now - 60_000), intervalSec: 60 }, now),
    true
  );
});

test('probeMonitor handles expected status, unexpected status, and timeouts', async () => {
  const monitor = {
    id: 'm1',
    url: 'https://example.com',
    method: 'GET',
    expectedStatus: 200,
  };
  const noopValidate = async () => true;

  const okRes = await probeMonitor(monitor, {
    validateUrlFn: noopValidate,
    fetchFn: async () => ({ status: 200 }),
  });
  assert.equal(okRes.isSuccess, true);
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.nextStatus, 'OPERATIONAL');

  const errRes = await probeMonitor(monitor, {
    validateUrlFn: noopValidate,
    fetchFn: async () => ({ status: 503 }),
  });
  assert.equal(errRes.isSuccess, false);
  assert.equal(errRes.statusCode, 503);
  assert.equal(errRes.nextStatus, 'DOWN');
  assert.equal(errRes.incidentReason, 'HTTP 503');

  const timeoutRes = await probeMonitor(monitor, {
    validateUrlFn: noopValidate,
    fetchFn: async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    },
  });
  assert.equal(timeoutRes.isSuccess, false);
  assert.equal(timeoutRes.statusCode, null);
  assert.equal(timeoutRes.nextStatus, 'DOWN');
  assert.equal(timeoutRes.incidentReason, 'Timeout (>10000ms)');
});

test('recordProbeResult opens an incident on DOWN and resolves it on recovery', async () => {
  const createdLogs = [];
  const updatedMonitors = [];
  const incidents = [];

  const mockDb = {
    pingLog: {
      create: (args) => ({ type: 'pingLog.create', args }),
    },
    monitor: {
      update: (args) => ({ type: 'monitor.update', args }),
    },
    incident: {
      findFirst: async ({ where }) =>
        incidents.find((inc) => inc.monitorId === where.monitorId && inc.resolvedAt === null) || null,
      create: (args) => ({ type: 'incident.create', args }),
      update: (args) => ({ type: 'incident.update', args }),
    },
    $transaction: async (ops) => {
      for (const op of ops) {
        if (op.type === 'pingLog.create') createdLogs.push(op.args.data);
        if (op.type === 'monitor.update') updatedMonitors.push(op.args.data);
        if (op.type === 'incident.create') {
          incidents.push({ id: `inc-${incidents.length + 1}`, ...op.args.data, resolvedAt: null });
        }
        if (op.type === 'incident.update') {
          const target = incidents.find((i) => i.id === op.args.where.id);
          if (target) target.resolvedAt = op.args.data.resolvedAt;
        }
      }
    },
  };

  const monitor = { id: 'mon-1' };
  const t1 = new Date('2026-11-24T12:00:00Z');
  const t2 = new Date('2026-11-24T12:01:00Z');
  const t3 = new Date('2026-11-24T12:02:00Z');

  // First failure opens an incident
  await recordProbeResult(
    monitor,
    { statusCode: 500, latencyMs: 120, isSuccess: false, nextStatus: 'DOWN', errorMessage: 'Expected HTTP 200, got 500', incidentReason: 'HTTP 500' },
    t1,
    mockDb
  );
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].resolvedAt, null);

  // Consecutive failure does not open a duplicate incident
  await recordProbeResult(
    monitor,
    { statusCode: 500, latencyMs: 110, isSuccess: false, nextStatus: 'DOWN', errorMessage: 'Expected HTTP 200, got 500', incidentReason: 'HTTP 500' },
    t2,
    mockDb
  );
  assert.equal(incidents.length, 1);

  // Recovery resolves the open incident
  await recordProbeResult(
    monitor,
    { statusCode: 200, latencyMs: 85, isSuccess: true, nextStatus: 'OPERATIONAL', errorMessage: null, incidentReason: null },
    t3,
    mockDb
  );
  assert.equal(incidents[0].resolvedAt, t3);
  assert.equal(createdLogs.length, 3);
  assert.deepEqual(
    updatedMonitors.map((u) => u.status),
    ['DOWN', 'DOWN', 'OPERATIONAL']
  );
});

test('runWorkerTick checks only due monitors concurrently', async () => {
  const checkedUrls = [];
  const now = Date.now();
  const mockDb = {
    monitor: {
      findMany: async () => [
        { id: 'due-1', url: 'https://a.example.com', method: 'GET', intervalSec: 60, expectedStatus: 200, isPaused: false, lastCheckedAt: null },
        { id: 'not-due', url: 'https://b.example.com', method: 'GET', intervalSec: 300, expectedStatus: 200, isPaused: false, lastCheckedAt: new Date(now - 10_000) },
      ],
      update: (args) => ({ type: 'monitor.update', args }),
    },
    pingLog: { create: (args) => ({ type: 'pingLog.create', args }) },
    incident: { findFirst: async () => null },
    $transaction: async () => {},
  };

  const summary = await runWorkerTick({
    db: mockDb,
    validateUrlFn: async () => true,
    fetchFn: async (url) => {
      checkedUrls.push(url);
      return { status: 200 };
    },
  });

  assert.equal(summary.checked, 1);
  assert.equal(summary.succeeded, 1);
  assert.deepEqual(checkedUrls, ['https://a.example.com']);
});
