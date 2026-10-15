/** A labeled figure in a .stats row, with an optional plain-language reading. */
export function Stat({ label, value, tone, reading }: { label: string; value: string; tone?: "pos" | "neg"; reading?: { label: string; tone: string } | null }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ` ${tone}` : ""}`}>{value}</div>
      {reading && <div className={`stat-reading tone-${reading.tone}`}>{reading.label}</div>}
    </div>
  );
}
