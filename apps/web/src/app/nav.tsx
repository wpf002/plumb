"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "./ui";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/bid", label: "Bid Decision" },
  { href: "/digest", label: "Weekly Digest" },
  { href: "/integrations", label: "Integrations" },
  { href: "/settings", label: "Settings" },
];

type Me = { user: { email: string }; companies: { id: string; name: string }[]; activeCompanyId: string | null };

export function Topbar() {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    apiFetch("/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, [path]);

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    setMe(null);
    router.push("/login");
    router.refresh();
  }

  async function switchCompany(companyId: string) {
    await apiFetch("/auth/active-company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
    router.refresh();
  }

  const onLogin = path === "/login";
  const active = me?.companies.find((c) => c.id === me.activeCompanyId);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden>
            {/* Plumb bob: a weight on a string that finds true vertical — the trade
                tool behind the name, and the promise (a true read on the business). */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5V4.5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M4.5 5h7l-3.5 9.5L4.5 5Z" fill="#fff" />
            </svg>
          </span>
          Plumb
        </Link>

        {me && !onLogin &&
          links.map((l) => {
            const isActive = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`navlink${isActive ? " active" : ""}`}>
                {l.label}
              </Link>
            );
          })}

        <span className="topbar-spacer" />

        {me && !onLogin && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {me.companies.length > 1 ? (
              <select
                value={me.activeCompanyId ?? ""}
                onChange={(e) => switchCompany(e.target.value)}
                style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8, padding: "6px 8px", fontSize: 13 }}
              >
                {me.companies.map((c) => (
                  <option key={c.id} value={c.id} style={{ color: "#111" }}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="topbar-tag">{active?.name ?? ""}</span>
            )}
            <button onClick={logout} className="navlink" style={{ background: "none", border: "none", cursor: "pointer" }}>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
