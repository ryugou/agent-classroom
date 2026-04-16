interface Props { toasts: { level: 'info' | 'warn' | 'error'; message: string; at: number }[]; }
export function Toasts({ toasts }: Props) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.at} className={`toast ${t.level}`}>{t.message}</div>
      ))}
    </div>
  );
}
