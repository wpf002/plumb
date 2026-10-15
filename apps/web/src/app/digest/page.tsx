import { redirect } from "next/navigation";
import { scoreColor, shortDate } from "../ui";
import { apiGet, activeCompanyId } from "../server";

export default async function DigestPreview() {
  const companyId = activeCompanyId();
  if (!companyId) redirect("/login");

  const { digest } = await apiGet(`/companies/${companyId}/digest`);

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Digest</h1>
        </div>
      </div>

      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            background: "linear-gradient(180deg, var(--ink-2), var(--ink))",
            color: "#fff",
            padding: "22px 24px",
            borderBottom: "3px solid var(--accent)",
          }}
        >
          <div style={{ color: "#8ea3b8", fontSize: 12, fontWeight: 500 }}>
            {digest.companyName} · week of {shortDate(digest.asOf)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <span
              className="num"
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: scoreColor(digest.score),
              }}
            >
              {digest.score}
            </span>
            <span style={{ color: "#b9c6d4", fontSize: 14 }}>Business Health / 100</span>
          </div>
          <p style={{ fontSize: 16, fontWeight: 500, margin: "12px 0 0" }}>{digest.headline}</p>
        </div>

        <div style={{ padding: "18px 24px 24px" }}>
          {digest.items.map((item: any, i: number) => (
            <div key={i} className={`alert ${item.severity}`}>
              <div>
                <div className="alert-title">{item.title}</div>
                {item.detail !== item.title && <div className="alert-detail">{item.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
