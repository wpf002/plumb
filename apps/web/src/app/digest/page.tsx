import { API, COMPANY, colors, card } from "../ui";

async function get(path: string) {
  const res = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const sev: Record<string, { color: string; mark: string }> = {
  critical: { color: colors.bad, mark: "●" },
  warning: { color: colors.warn, mark: "●" },
  good: { color: colors.good, mark: "●" },
};

export default async function DigestPreview() {
  if (!COMPANY) {
    return (
      <main style={{ padding: 40 }}>
        <p>
          Set <code>NEXT_PUBLIC_COMPANY_ID</code> and reload.
        </p>
      </main>
    );
  }

  const { digest } = await get(`/companies/${COMPANY}/digest`);

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Weekly digest</h1>
      <p style={{ color: colors.muted, marginTop: 0 }}>
        What lands in the owner&apos;s inbox every Monday — no login required.
      </p>

      <section style={card}>
        <div style={{ color: colors.muted, fontSize: 13 }}>
          {digest.companyName} · week of {digest.asOf} · health {digest.score}/100
        </div>
        <p style={{ fontSize: 17, fontWeight: 600, margin: "10px 0 20px" }}>
          {digest.headline}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {digest.items.map((item: any, i: number) => (
            <div key={i} style={{ display: "flex", gap: 10 }}>
              <span style={{ color: sev[item.severity].color, fontSize: 12, marginTop: 4 }}>
                {sev[item.severity].mark}
              </span>
              <div>
                <div style={{ fontWeight: 600, color: sev[item.severity].color }}>
                  {item.title}
                </div>
                {item.detail !== item.title && (
                  <div style={{ color: colors.muted, fontSize: 14, marginTop: 2 }}>
                    {item.detail}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
