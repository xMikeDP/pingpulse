import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Plus,
  RefreshCw,
  Pause,
  Play,
  Trash2,
  LogOut,
  X,
  AlertTriangle,
  Globe,
} from 'lucide-react';
import client from '../api/client';
import StatusBadge from '../components/StatusBadge';
import LatencyChart from '../components/LatencyChart';

const INITIAL_FORM = {
  name: '',
  url: '',
  method: 'GET',
  intervalSec: 60,
  expectedStatus: 200,
};

export default function Dashboard({ user, onLogout }) {
  const [monitors, setMonitors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [telemetry, setTelemetry] = useState({ logs: [], incidents: [] });
  const [loading, setLoading] = useState(true);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchMonitors = useCallback(async () => {
    try {
      const { data } = await client.get('/monitors');
      setMonitors(data);
      setSelectedId((prev) => {
        if (prev && data.some((m) => m.id === prev)) return prev;
        return data.length > 0 ? data[0].id : null;
      });
    } catch (err) {
      console.error('Failed to fetch monitors:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTelemetry = useCallback(async (monitorId) => {
    if (!monitorId) {
      setTelemetry({ logs: [], incidents: [] });
      return;
    }
    setTelemetryLoading(true);
    try {
      const { data } = await client.get(`/monitors/${monitorId}/telemetry?hours=24`);
      setTelemetry(data);
    } catch (err) {
      console.error('Failed to fetch telemetry:', err);
    } finally {
      setTelemetryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonitors();
    const timer = setInterval(fetchMonitors, 30_000);
    return () => clearInterval(timer);
  }, [fetchMonitors]);

  useEffect(() => {
    fetchTelemetry(selectedId);
    if (!selectedId) return undefined;
    const timer = setInterval(() => fetchTelemetry(selectedId), 30_000);
    return () => clearInterval(timer);
  }, [selectedId, fetchTelemetry]);

  const handleAddMonitor = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const { data } = await client.post('/monitors', {
        ...form,
        intervalSec: Number(form.intervalSec),
        expectedStatus: Number(form.expectedStatus),
      });
      setShowAddModal(false);
      setForm(INITIAL_FORM);
      await fetchMonitors();
      setSelectedId(data.id);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not create monitor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (e, monitorId) => {
    e.stopPropagation();
    try {
      await client.patch(`/monitors/${monitorId}/toggle`);
      await fetchMonitors();
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  const handleDelete = async (e, monitorId) => {
    e.stopPropagation();
    try {
      await client.delete(`/monitors/${monitorId}`);
      await fetchMonitors();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const selectedMonitor = monitors.find((m) => m.id === selectedId) || null;
  const counts = {
    total: monitors.length,
    operational: monitors.filter((m) => m.status === 'OPERATIONAL').length,
    degraded: monitors.filter((m) => m.status === 'DEGRADED').length,
    down: monitors.filter((m) => m.status === 'DOWN').length,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">PingPulse</h1>
              <p className="text-xs text-slate-400">{user?.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                fetchMonitors();
                if (selectedId) fetchTelemetry(selectedId);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => {
                setFormError('');
                setShowAddModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <Plus className="h-4 w-4" />
              Add Monitor
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard label="Total Monitors" value={counts.total} accent="text-white" />
          <SummaryCard label="Operational" value={counts.operational} accent="text-emerald-400" />
          <SummaryCard label="Degraded" value={counts.degraded} accent="text-amber-400" />
          <SummaryCard label="Down" value={counts.down} accent="text-rose-400" />
        </section>

        <section className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Monitored Endpoints
            </h2>

            {loading ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-400">
                Loading monitors...
              </div>
            ) : monitors.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
                <Globe className="mx-auto mb-2 h-8 w-8 text-slate-500" />
                <p className="text-sm font-medium text-slate-300">No monitors yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  Add an HTTP/HTTPS endpoint to start tracking uptime and latency.
                </p>
              </div>
            ) : (
              monitors.map((monitor) => {
                const isSelected = monitor.id === selectedId;
                return (
                  <div
                    key={monitor.id}
                    onClick={() => setSelectedId(monitor.id)}
                    className={`cursor-pointer rounded-xl border p-4 transition ${
                      isSelected
                        ? 'border-sky-500/60 bg-slate-900 shadow-lg shadow-sky-950/20'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-white">
                            {monitor.name}
                          </h3>
                          <StatusBadge status={monitor.status} />
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-400">{monitor.url}</p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          title={monitor.isPaused ? 'Resume monitor' : 'Pause monitor'}
                          onClick={(e) => handleToggle(e, monitor.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                        >
                          {monitor.isPaused ? (
                            <Play className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <Pause className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          title="Delete monitor"
                          onClick={(e) => handleDelete(e, monitor.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-3 text-xs">
                      <div>
                        <span className="text-slate-500">24h Uptime</span>
                        <p className="font-medium text-slate-200">
                          {monitor.uptime24h !== null && monitor.uptime24h !== undefined
                            ? `${monitor.uptime24h}%`
                            : '—'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Avg Latency</span>
                        <p className="font-medium text-slate-200">
                          {monitor.avgLatencyMs !== null && monitor.avgLatencyMs !== undefined
                            ? `${monitor.avgLatencyMs} ms`
                            : '—'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Interval</span>
                        <p className="font-medium text-slate-200">{monitor.intervalSec}s</p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-6 lg:col-span-7">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    {selectedMonitor
                      ? `${selectedMonitor.name} — 24h Response Latency`
                      : '24h Response Latency'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {selectedMonitor
                      ? `Expected HTTP ${selectedMonitor.expectedStatus} via ${selectedMonitor.method}`
                      : 'Select a monitor to inspect response latency'}
                  </p>
                </div>
                {telemetryLoading && <span className="text-xs text-slate-400">Updating...</span>}
              </div>

              <LatencyChart logs={telemetry.logs} />
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-white">Incident Log (Last 24h)</h2>
              </div>

              {telemetry.incidents.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  No incidents recorded for this monitor in the last 24 hours.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 text-slate-400">
                      <tr>
                        <th className="pb-2 font-medium">Reason</th>
                        <th className="pb-2 font-medium">Started</th>
                        <th className="pb-2 font-medium">Resolved</th>
                        <th className="pb-2 font-medium">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {telemetry.incidents.map((incident) => (
                        <tr key={incident.id}>
                          <td className="py-2.5 font-medium text-rose-300">{incident.reason}</td>
                          <td className="py-2.5 text-slate-300">
                            {new Date(incident.startedAt).toLocaleString()}
                          </td>
                          <td className="py-2.5 text-slate-300">
                            {incident.resolvedAt
                              ? new Date(incident.resolvedAt).toLocaleString()
                              : '—'}
                          </td>
                          <td className="py-2.5">
                            {incident.resolvedAt ? (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
                                Resolved
                              </span>
                            ) : (
                              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-300">
                                Ongoing
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Add Monitored Endpoint</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddMonitor} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Production API"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">Target URL</label>
                <input
                  type="url"
                  required
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://httpbin.org/status/200"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">Method</label>
                  <select
                    value={form.method}
                    onChange={(e) => setForm({ ...form, method: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="GET">GET</option>
                    <option value="HEAD">HEAD</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">Interval</label>
                  <select
                    value={form.intervalSec}
                    onChange={(e) => setForm({ ...form, intervalSec: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value={15}>15s</option>
                    <option value={60}>1 min</option>
                    <option value={300}>5 min</option>
                    <option value={900}>15 min</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">Status</label>
                  <input
                    type="number"
                    min={100}
                    max={599}
                    required
                    value={form.expectedStatus}
                    onChange={(e) => setForm({ ...form, expectedStatus: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              {formError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                >
                  {submitting ? 'Adding...' : 'Create Monitor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}
