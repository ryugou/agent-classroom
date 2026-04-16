interface Props { toasts: { level: 'info' | 'warn' | 'error'; message: string; at: number }[]; }
export function Toasts({ toasts }: Props) {
  return (
    <div className="toasts">
      {toasts.map((t, i) => (
        <div key={`${t.at}-${i}`} className={`toast ${t.level}`}>{t.message}</div>
      ))}
    </div>
  );
}
