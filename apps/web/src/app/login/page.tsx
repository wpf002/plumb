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
        <h1 style={{ marginBottom: 4 }}>{mode === "login" ? "Sign In to DNRD" : "Create Your Account"}</h1>
      </div>

      <section className="card">
        {mode === "register" && (
          <>
            <label className="label">Your Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 12 }} />
            <label className="label">Company Name</label>
            <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={{ marginBottom: 12 }} placeholder="Acme Electric" />
            <label className="label">Trade</label>
            <input className="input" value={trade} onChange={(e) => setTrade(e.target.value)} style={{ marginBottom: 12 }} placeholder="ELECTRICAL" />
          </>
        )}
        <label className="label">Email</label>
        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginBottom: 12 }} type="email" />
        <label className="label">Password</label>
        <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" onKeyDown={(e) => e.key === "Enter" && submit()} />

        <button className="btn btn-primary" onClick={submit} disabled={busy} style={{ width: "100%", marginTop: 16 }}>
          {busy ? "…" : mode === "login" ? "Sign In" : "Create Account"}
        </button>
        {error && <p className="neg" style={{ marginBottom: 0, marginTop: 12 }}>{error}</p>}
        {mode === "login" && (
          <p style={{ textAlign: "center", marginTop: 12, marginBottom: 0 }}>
            <a href="/reset" style={{ color: "var(--text-muted)", fontSize: 14, textDecoration: "none" }}>
              Forgot password?
            </a>
          </p>
        )}

        <p style={{ textAlign: "center", marginTop: 16, marginBottom: 0, fontSize: 14, color: "var(--text-muted)" }}>
          {mode === "login" ? "New to DNRD? " : "Already have an account? "}
          <button
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
            style={{ background: "none", border: "none", color: C.accent, fontWeight: 500, cursor: "pointer", fontSize: 14 }}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
    </main>
  );
}
