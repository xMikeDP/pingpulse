require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./db');
const authRoutes = require('./routes/auth');
const monitorRoutes = require('./routes/monitors');
const { startWorker } = require('./worker/pinger');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'disconnected', message: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/monitors', monitorRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const stopWorker = startWorker();
  const server = app.listen(PORT, () => {
    console.log(`PingPulse backend listening on port ${PORT}`);
  });

  const shutdown = () => {
    stopWorker();
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { app, prisma };
