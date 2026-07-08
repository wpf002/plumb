import { redirect } from "next/navigation";
import { scoreColor } from "../ui";
import { apiGet, activeCompanyId } from "../server";

export default async function DigestPreview() {
  const companyId = activeCompanyId();
  if (!companyId) redirect("/login");

  const { digest } = await apiGet(`/companies/${companyId}/digest`);

  return (
    <main className="container" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1>Weekly Digest</h1>
          <p>What lands in your inbox every Monday. No login required.</p>
        </div>
      </div>

      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            background: "linear-gradient(180deg, var(--navy-800), var(--navy))",
            color: "#fff",
            padding: "22px 24px",
            borderBottom: "3px solid var(--orange)",
          }}
        >
          <div style={{ color: "#8ea3b8", fontSize: 12.5, fontWeight: 600 }}>
            {digest.companyName} · week of {digest.asOf}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <span
              className="num"
              style={{
                fontSize: 30,
                fontWeight: 800,
                color: scoreColor(digest.score),
              }}
            >
              {digest.score}
            </span>
            <span style={{ color: "#b9c6d4", fontSize: 14 }}>Business Health / 100</span>
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, margin: "12px 0 0" }}>{digest.headline}</p>
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
          <p style={{ color: "var(--faint)", fontSize: 12.5, marginTop: 18, marginBottom: 0 }}>
            Delivered by Plumb. Reply if a number looks off.
          </p>
        </div>
      </section>
    </main>
  );
}
