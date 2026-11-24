const prisma = require('../db');
const { validateTargetUrl } = require('../utils/ssrfGuard');

const TICK_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEGRADED_LATENCY_MS = 2_000;

function classifyStatus(isSuccess, latencyMs) {
  if (!isSuccess) return 'DOWN';
  if (latencyMs > DEGRADED_LATENCY_MS) return 'DEGRADED';
  return 'OPERATIONAL';
}

function isMonitorDue(monitor, nowMs = Date.now()) {
  if (monitor.isPaused) return false;
  if (!monitor.lastCheckedAt) return true;
  const lastCheckedMs = new Date(monitor.lastCheckedAt).getTime();
  return nowMs - lastCheckedMs >= monitor.intervalSec * 1000;
}

async function probeMonitor(monitor, { fetchFn = fetch, validateUrlFn = validateTargetUrl } = {}) {
  const start = performance.now();

  try {
    await validateUrlFn(monitor.url);

    const response = await fetchFn(monitor.url, {
      method: monitor.method || 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });

    const latencyMs = Math.round(performance.now() - start);
    const statusCode = response.status;
    const isSuccess = statusCode === monitor.expectedStatus;
    const nextStatus = classifyStatus(isSuccess, latencyMs);

    return {
      statusCode,
      latencyMs,
      isSuccess,
      nextStatus,
      errorMessage: isSuccess ? null : `Expected HTTP ${monitor.expectedStatus}, got ${statusCode}`,
      incidentReason: isSuccess ? null : `HTTP ${statusCode}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const message = isTimeout
      ? `Timeout (>${REQUEST_TIMEOUT_MS}ms)`
      : err?.cause?.message || err?.message || 'Network Error';

    return {
      statusCode: null,
      latencyMs,
      isSuccess: false,
      nextStatus: 'DOWN',
      errorMessage: message,
      incidentReason: message,
    };
  }
}

async function recordProbeResult(monitor, result, now = new Date(), db = prisma) {
  const ops = [
    db.pingLog.create({
      data: {
        monitorId: monitor.id,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
        isSuccess: result.isSuccess,
        errorMessage: result.errorMessage,
        checkedAt: now,
      },
    }),
    db.monitor.update({
      where: { id: monitor.id },
      data: {
        status: result.nextStatus,
        lastCheckedAt: now,
      },
    }),
  ];

  const openIncident = await db.incident.findFirst({
    where: { monitorId: monitor.id, resolvedAt: null },
    orderBy: { startedAt: 'desc' },
  });

  if (result.nextStatus === 'DOWN') {
    if (!openIncident) {
      ops.push(
        db.incident.create({
          data: {
            monitorId: monitor.id,
            reason: result.incidentReason || result.errorMessage || 'Endpoint Down',
            startedAt: now,
          },
        })
      );
    }
  } else if (openIncident) {
    ops.push(
      db.incident.update({
        where: { id: openIncident.id },
        data: { resolvedAt: now },
      })
    );
  }

  await db.$transaction(ops);
}

async function runWorkerTick(options = {}) {
  const db = options.db || prisma;
  const now = new Date();
  const nowMs = now.getTime();

  const activeMonitors = await db.monitor.findMany({
    where: { isPaused: false },
  });

  const dueMonitors = activeMonitors.filter((m) => isMonitorDue(m, nowMs));
  if (dueMonitors.length === 0) {
    return { checked: 0 };
  }

  const probeResults = await Promise.allSettled(
    dueMonitors.map(async (monitor) => {
      const result = await probeMonitor(monitor, options);
      await recordProbeResult(monitor, result, now, db);
      return { monitorId: monitor.id, status: result.nextStatus };
    })
  );

  const succeeded = probeResults.filter((r) => r.status === 'fulfilled').length;
  const failed = probeResults.length - succeeded;
  if (failed > 0) {
    console.error(`Worker tick completed with ${failed} persistence error(s)`);
  }

  return { checked: dueMonitors.length, succeeded, failed };
}

function startWorker(intervalMs = TICK_INTERVAL_MS) {
  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await runWorkerTick();
    } catch (err) {
      console.error('Background ping worker tick failed:', err);
    } finally {
      isRunning = false;
    }
  };

  // Run an initial tick shortly after startup, then on the fixed interval
  const initialTimer = setTimeout(tick, 1000);
  const intervalTimer = setInterval(tick, intervalMs);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}

module.exports = {
  TICK_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  DEGRADED_LATENCY_MS,
  classifyStatus,
  isMonitorDue,
  probeMonitor,
  recordProbeResult,
  runWorkerTick,
  startWorker,
};
