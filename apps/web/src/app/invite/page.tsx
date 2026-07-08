"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "../ui";

function AcceptInvite() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [invite, setInvite] = useState<any>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No invitation token.");
      return;
    }
    apiFetch(`/auth/invite/${token}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).message))))
      .then(setInvite)
      .catch((e) => setError(e.message));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name || undefined, password: password || undefined }),
      });
      const j = await res.json();
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
        <h1 style={{ marginBottom: 4 }}>Join Plumb</h1>
      </div>
      <section className="card">
        {error && !invite && <p className="neg">{error}</p>}
        {invite && (
          <>
            <p style={{ marginTop: 0, color: "var(--muted)" }}>
              You&apos;ve been invited to <strong style={{ color: "var(--navy)" }}>{invite.companyName}</strong> as{" "}
              <strong>{invite.role}</strong> ({invite.email}).
            </p>
            {invite.needsPassword && (
              <>
                <label className="label">Your name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 14 }} />
                <label className="label">Choose a password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </>
            )}
            <button className="btn btn-primary" onClick={accept} disabled={busy} style={{ width: "100%", marginTop: 18 }}>
              {busy ? "…" : "Accept Invitation"}
            </button>
            {error && <p className="neg" style={{ marginBottom: 0, marginTop: 12 }}>{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<main className="container"><div className="card">Loading…</div></main>}>
      <AcceptInvite />
    </Suspense>
  );
}
