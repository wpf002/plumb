"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, C } from "../ui";

function Reset() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [validEmail, setValidEmail] = useState<string | null>(null);
  const [sent, setSent] = useState<{ link?: string } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch(`/auth/reset/${token}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).message))))
      .then((d) => setValidEmail(d.email))
      .catch((e) => setError(e.message));
  }, [token]);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/auth/request-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      setSent({ link: j.resetUrl });
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      setDone(true);
      setTimeout(() => router.push("/login"), 1200);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <div style={{ textAlign: "center", margin: "20px 0 24px" }}>
        <h1 style={{ marginBottom: 4 }}>Reset your password</h1>
      </div>
      <section className="card">
        {token ? (
          done ? (
            <p className="pos" style={{ margin: 0 }}>Password updated. Taking you to sign in…</p>
          ) : error && !validEmail ? (
            <p className="neg" style={{ margin: 0 }}>{error}</p>
          ) : (
            <>
              {validEmail && <p style={{ marginTop: 0, color: "var(--muted)" }}>Set a new password for {validEmail}.</p>}
              <label className="label">New password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reset()} />
              <button className="btn btn-primary" onClick={reset} disabled={busy || !password} style={{ width: "100%", marginTop: 18 }}>
                {busy ? "…" : "Set new password"}
              </button>
              {error && <p className="neg" style={{ marginBottom: 0, marginTop: 12 }}>{error}</p>}
            </>
          )
        ) : sent ? (
          <>
            <p style={{ marginTop: 0 }}>If that email is registered, a reset link is on its way.</p>
            {sent.link && (
              <div className="alert good">
                <span className="alert-dot" style={{ color: C.green }}>●</span>
                <div style={{ width: "100%" }}>
                  <div className="alert-title">No email provider configured</div>
                  <div className="alert-detail">Use this link to reset:</div>
                  <code style={{ fontSize: 12, wordBreak: "break-all" }}>{sent.link}</code>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && request()} />
            <button className="btn btn-primary" onClick={request} disabled={busy || !email} style={{ width: "100%", marginTop: 18 }}>
              {busy ? "…" : "Send reset link"}
            </button>
            {error && <p className="neg" style={{ marginBottom: 0, marginTop: 12 }}>{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<main className="container"><div className="card">Loading…</div></main>}>
      <Reset />
    </Suspense>
  );
}
