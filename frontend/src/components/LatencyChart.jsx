import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LatencyChart({ logs = [] }) {
  if (logs.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/50 text-sm text-slate-400">
        No ping telemetry recorded in the last 24 hours yet.
      </div>
    );
  }

  const data = logs.map((log) => ({
    time: formatTime(log.checkedAt),
    fullTime: new Date(log.checkedAt).toLocaleString(),
    latencyMs: log.latencyMs,
    statusCode: log.statusCode ?? 'ERR',
    isSuccess: log.isSuccess,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} />
          <YAxis
            stroke="#94a3b8"
            fontSize={12}
            tickLine={false}
            unit=" ms"
            width={65}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0f172a',
              borderColor: '#334155',
              borderRadius: '0.5rem',
              color: '#f1f5f9',
              fontSize: '0.75rem',
            }}
            formatter={(value) => [`${value} ms`, 'Latency']}
            labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullTime || ''}
          />
          <Line
            type="monotone"
            dataKey="latencyMs"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={{ r: 2.5, fill: '#38bdf8' }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
