"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, C } from "../ui";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("owner@foley.test");
  const [password, setPassword] = useState("plumb1234");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [trade, setTrade] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, name: name || undefined, companyName, trade: trade || undefined };
      const res = await apiFetch(`/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
      router.push("/");
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <div style={{ textAlign: "center", margin: "20px 0 24px" }}>
        <h1 style={{ marginBottom: 4 }}>{mode === "login" ? "Sign in to Plumb" : "Create your account"}</h1>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
          {mode === "login" ? "Financial command center for subcontractors." : "Start with your company and one login."}
        </p>
      </div>

      <section className="card">
        {mode === "register" && (
          <>
            <label className="label">Your name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 14 }} />
            <label className="label">Company name</label>
            <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={{ marginBottom: 14 }} placeholder="Acme Electric" />
            <label className="label">Trade</label>
            <input className="input" value={trade} onChange={(e) => setTrade(e.target.value)} style={{ marginBottom: 14 }} placeholder="ELECTRICAL" />
          </>
        )}
        <label className="label">Email</label>
        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginBottom: 14 }} type="email" />
        <label className="label">Password</label>
        <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" onKeyDown={(e) => e.key === "Enter" && submit()} />

        <button className="btn btn-primary" onClick={submit} disabled={busy} style={{ width: "100%", marginTop: 20 }}>
          {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        {error && <p className="neg" style={{ marginBottom: 0, marginTop: 12 }}>{error}</p>}

        <p style={{ textAlign: "center", marginTop: 18, marginBottom: 0, fontSize: 13.5, color: "var(--muted)" }}>
          {mode === "login" ? "New to Plumb? " : "Already have an account? "}
          <button
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
            style={{ background: "none", border: "none", color: C.orange, fontWeight: 600, cursor: "pointer", fontSize: 13.5 }}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
    </main>
  );
}
