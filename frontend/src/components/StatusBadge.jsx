const STATUS_STYLES = {
  OPERATIONAL: {
    label: 'Operational',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  DEGRADED: {
    label: 'Degraded',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  DOWN: {
    label: 'Down',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    dot: 'bg-rose-400',
  },
  PAUSED: {
    label: 'Paused',
    badge: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    dot: 'bg-slate-400',
  },
};

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.PAUSED;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
