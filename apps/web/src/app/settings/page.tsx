"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId, usd, C } from "../ui";

const sourceLabel: Record<string, string> = {
  MANUAL: "Entered manually",
  PLAID: "Bank feed (Plaid)",
  PLAID_SANDBOX: "Bank feed (demo)",
};

export default function Settings() {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(true);
  const [myUserId, setMyUserId] = useState("");
  const [team, setTeam] = useState<any>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function loadTeam() {
    const res = await apiFetch(`/companies/${getCompanyId()}/team`, { cache: "no-store" });
    if (res.ok) setTeam(await res.json());
  }

  async function invite() {
    setBusy("invite");
    setError(null);
    setInviteLink(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/team/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      setInviteEmail("");
      setInviteLink(j.acceptUrl);
      await loadTeam();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(membershipId: string) {
    setBusy("remove");
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/team/${membershipId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Failed (${res.status})`);
      }
      await loadTeam();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function load() {
    const meRes = await apiFetch("/auth/me");
    if (meRes.ok) {
      const me = await meRes.json();
      const active = me.companies.find((c: any) => c.id === me.activeCompanyId);
      setIsOwner(active?.role === "OWNER");
      setMyUserId(me.user.id);
    }
    await loadTeam();
    const res = await apiFetch(`/companies/${getCompanyId()}/settings`, { cache: "no-store" });
    if (!res.ok) {
      setError(`Load failed (${res.status})`);
      return;
    }
    const json = await res.json();
    setData(json);
    setForm({
      monthlyLaborHours: String(json.company.monthlyLaborHours),
      cashSafetyThreshold: String(Math.round(json.company.cashSafetyThresholdCents / 100)),
      portfolioTargetMarginPct: String(json.company.portfolioTargetMarginPct),
      defaultRetainagePct: String(json.company.defaultRetainagePct),
    });
  }

  useEffect(() => {
    if (getCompanyId()) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post(path: string, body: any, label: string) {
    setBusy(label);
    setMsg(null);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}${path}`, {
        method: body._method ?? "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body.payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `Failed (${res.status})`);
      setMsg(body.success);
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return (
      <main className="container">
        <div className="card">
          <p className="neg">{error}</p>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="container">
        <div className="card">Loading…</div>
      </main>
    );
  }

  const oc = data.openingCash;

  return (
    <main className="container" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Set up the numbers Plumb plans against — takes a couple of minutes.</p>
        </div>
      </div>

      {!isOwner && (
        <div className="alert warning" style={{ marginBottom: 20 }}>
          <span className="alert-dot" style={{ color: C.amber }}>●</span>
          <div className="alert-title">View only — company settings can only be changed by an owner.</div>
        </div>
      )}
      {(msg || error) && (
        <div className={`alert ${error ? "critical" : "good"}`} style={{ marginBottom: 20 }}>
          <span className="alert-dot" style={{ color: error ? C.red : C.green }}>
            ●
          </span>
          <div className="alert-title">{error ?? msg}</div>
        </div>
      )}

      {/* Opening cash */}
      <section className="card">
        <div className="card-title">Opening cash</div>
        <p style={{ marginTop: -6, marginBottom: 16, color: "var(--muted)", fontSize: 13.5 }}>
          The starting bank balance every cash forecast builds from.
        </p>
        <div className="stats" style={{ marginBottom: 18 }}>
          <div className="stat">
            <div className="stat-label">Current</div>
            <div className="stat-value num">{oc ? usd(oc.balanceCents) : "—"}</div>
            <div className="stat-sub">
              {oc ? `${sourceLabel[oc.source] ?? oc.source} · ${String(oc.asOf).slice(0, 10)}` : "not set"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="label">Set manually ($)</label>
            <input
              className="input num"
              style={{ maxWidth: 200 }}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 250000"
            />
          </div>
          <button
            className="btn btn-ghost"
            disabled={busy !== null || !manual || !isOwner}
            onClick={() =>
              post(
                "/opening-cash",
                { payload: { balanceCents: Math.round((Number(manual) || 0) * 100) }, success: "Opening cash updated." },
                "manual"
              )
            }
          >
            {busy === "manual" ? "Saving…" : "Save balance"}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy !== null || !isOwner}
            onClick={() =>
              post("/opening-cash/plaid", { payload: {}, success: "Bank connected — opening cash pulled from your account." }, "plaid")
            }
          >
            {busy === "plaid" ? "Connecting…" : "🏦 Connect bank (demo)"}
          </button>
        </div>
      </section>

      {/* Business settings */}
      <section className="card">
        <div className="card-title">Business settings</div>
        <div className="field-grid">
          <div>
            <label className="label">Crew capacity (labor hrs / month)</label>
            <input
              className="input num"
              value={form.monthlyLaborHours ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, monthlyLaborHours: e.target.value }))}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="label">Cash safety threshold ($)</label>
            <input
              className="input num"
              value={form.cashSafetyThreshold ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, cashSafetyThreshold: e.target.value }))}
              inputMode="decimal"
            />
          </div>
          <div>
            <label className="label">Portfolio target margin (%)</label>
            <input
              className="input num"
              value={form.portfolioTargetMarginPct ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, portfolioTargetMarginPct: e.target.value }))}
              inputMode="decimal"
            />
          </div>
          <div>
            <label className="label">Default retainage (%)</label>
            <input
              className="input num"
              value={form.defaultRetainagePct ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, defaultRetainagePct: e.target.value }))}
              inputMode="decimal"
            />
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <button
            className="btn btn-primary"
            disabled={busy !== null || !isOwner}
            onClick={() =>
              post(
                "/settings",
                {
                  _method: "PUT",
                  payload: {
                    monthlyLaborHours: Math.round(Number(form.monthlyLaborHours) || 0),
                    cashSafetyThresholdCents: Math.round((Number(form.cashSafetyThreshold) || 0) * 100),
                    portfolioTargetMarginPct: Number(form.portfolioTargetMarginPct) || 0,
                    defaultRetainagePct: Number(form.defaultRetainagePct) || 0,
                  },
                  success: "Business settings saved.",
                },
                "settings"
              )
            }
          >
            {busy === "settings" ? "Saving…" : "Save settings"}
          </button>
        </div>
      </section>

      {/* Team */}
      <section className="card">
        <div className="card-title">Team</div>
        {team && (
          <table className="table" style={{ marginBottom: team.invites.length || isOwner ? 18 : 0 }}>
            <tbody>
              {team.members.map((m: any) => (
                <tr key={m.membershipId}>
                  <td className="cell-name">
                    {m.name ?? m.email}
                    {m.userId === myUserId && <span style={{ color: "var(--faint)", fontWeight: 400 }}> (you)</span>}
                  </td>
                  <td style={{ color: "var(--muted)" }}>{m.email}</td>
                  <td><span className={`badge ${m.role === "OWNER" ? "info" : "neutral"}`}>{m.role}</span></td>
                  <td className="num">
                    {isOwner && m.userId !== myUserId && (
                      <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} disabled={busy !== null} onClick={() => removeMember(m.membershipId)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {team.invites.map((i: any, idx: number) => (
                <tr key={`inv-${idx}`}>
                  <td className="cell-name" style={{ color: "var(--muted)" }}>{i.email}</td>
                  <td style={{ color: "var(--faint)" }}>invited</td>
                  <td><span className="badge warn">Pending {i.role}</span></td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {isOwner ? (
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="label">Invite by email</label>
                <input className="input" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.com" type="email" />
              </div>
              <div>
                <label className="label">Role</label>
                <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ minWidth: 120 }}>
                  <option value="MEMBER">Member</option>
                  <option value="OWNER">Owner</option>
                </select>
              </div>
              <button className="btn btn-primary" disabled={busy !== null || !inviteEmail} onClick={invite}>
                {busy === "invite" ? "Inviting…" : "Send invite"}
              </button>
            </div>
            {inviteLink && (
              <div className="alert good" style={{ marginTop: 14 }}>
                <span className="alert-dot" style={{ color: C.green }}>●</span>
                <div style={{ width: "100%" }}>
                  <div className="alert-title">Invitation created</div>
                  <div className="alert-detail">No email provider configured — share this link so they can join:</div>
                  <code style={{ fontSize: 12, wordBreak: "break-all" }}>{inviteLink}</code>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p style={{ color: "var(--faint)", fontSize: 13.5, margin: 0 }}>Only owners can invite or remove teammates.</p>
        )}
      </section>
    </main>
  );
}
