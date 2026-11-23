const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validateTargetUrl } = require('../utils/ssrfGuard');

const router = express.Router();

router.use(requireAuth);

function computeUptimeStats(logs) {
  const total = logs.length;
  if (total === 0) {
    return { uptime24h: null, avgLatencyMs: null, totalChecks24h: 0 };
  }

  let successCount = 0;
  let latencySum = 0;
  for (const log of logs) {
    if (log.isSuccess) successCount += 1;
    latencySum += log.latencyMs;
  }

  return {
    uptime24h: Number(((successCount / total) * 100).toFixed(2)),
    avgLatencyMs: Math.round(latencySum / total),
    totalChecks24h: total,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const monitors = await prisma.monitor.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });

    if (monitors.length === 0) {
      return res.json([]);
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const logs = await prisma.pingLog.findMany({
      where: {
        monitorId: { in: monitors.map((m) => m.id) },
        checkedAt: { gte: since },
      },
      select: {
        monitorId: true,
        isSuccess: true,
        latencyMs: true,
      },
    });

    const logsByMonitor = new Map();
    for (const log of logs) {
      if (!logsByMonitor.has(log.monitorId)) {
        logsByMonitor.set(log.monitorId, []);
      }
      logsByMonitor.get(log.monitorId).push(log);
    }

    const enriched = monitors.map((monitor) => ({
      ...monitor,
      ...computeUptimeStats(logsByMonitor.get(monitor.id) || []),
    }));

    return res.json(enriched);
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, url, method = 'GET', intervalSec = 300, expectedStatus = 200 } = req.body || {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Monitor name is required' });
    }

    let parsedUrl;
    try {
      parsedUrl = await validateTargetUrl(url);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const normalizedMethod = String(method).toUpperCase();
    if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
      return res.status(400).json({ error: 'Method must be GET or HEAD' });
    }

    const parsedInterval = Number(intervalSec);
    if (!Number.isInteger(parsedInterval) || parsedInterval < 15 || parsedInterval > 86400) {
      return res.status(400).json({ error: 'intervalSec must be an integer between 15 and 86400' });
    }

    const parsedExpectedStatus = Number(expectedStatus);
    if (!Number.isInteger(parsedExpectedStatus) || parsedExpectedStatus < 100 || parsedExpectedStatus > 599) {
      return res.status(400).json({ error: 'expectedStatus must be an HTTP status code (100-599)' });
    }

    const monitor = await prisma.monitor.create({
      data: {
        userId: req.user.id,
        name: name.trim(),
        url: parsedUrl.toString(),
        method: normalizedMethod,
        intervalSec: parsedInterval,
        expectedStatus: parsedExpectedStatus,
      },
    });

    return res.status(201).json(monitor);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id/toggle', async (req, res, next) => {
  try {
    const existing = await prisma.monitor.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    const nextPaused = !existing.isPaused;
    const updated = await prisma.monitor.update({
      where: { id: existing.id },
      data: {
        isPaused: nextPaused,
        status: nextPaused ? 'PAUSED' : 'OPERATIONAL',
      },
    });

    return res.json(updated);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.monitor.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    await prisma.monitor.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/telemetry', async (req, res, next) => {
  try {
    const existing = await prisma.monitor.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    const rawHours = Number(req.query.hours ?? 24);
    const hours = Number.isFinite(rawHours) ? Math.min(Math.max(rawHours, 1), 168) : 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [logs, incidents] = await Promise.all([
      prisma.pingLog.findMany({
        where: { monitorId: existing.id, checkedAt: { gte: since } },
        orderBy: { checkedAt: 'asc' },
      }),
      prisma.incident.findMany({
        where: {
          monitorId: existing.id,
          OR: [{ startedAt: { gte: since } }, { resolvedAt: null }],
        },
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    return res.json({ logs, incidents });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.computeUptimeStats = computeUptimeStats;
