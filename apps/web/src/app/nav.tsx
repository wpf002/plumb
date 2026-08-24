"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, hasProjects } from "./ui";

type Company = {
  id: string;
  name: string;
  role: string;
  trade: string;
  employeeCount: number;
  revenueModel: string;
  setupCompletedAt: string | null;
};
type Me = { user: { email: string }; companies: Company[]; activeCompanyId: string | null };

// `show` gates a link on the active company's revenue model — a pure bid shop
// never sees service contracts, a pure service shop never sees bid coverage.
const links: { href: string; label: string; show?: (m: string) => boolean }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/balance-sheet", label: "Balance Sheet" },
  { href: "/bid", label: "Bid", show: hasProjects },
  { href: "/digest", label: "Digest" },
  { href: "/integrations", label: "Integrations" },
  { href: "/settings", label: "Settings" },
];

const PUBLIC = ["/login", "/invite", "/reset"];

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

  const active = me?.companies.find((c) => c.id === me.activeCompanyId);
  const onPublic = PUBLIC.some((p) => path.startsWith(p));

  // A company that hasn't finished the wizard has no capacity, targets, or
  // opening cash — every number downstream would be fiction. Send them there.
  useEffect(() => {
    if (!active || onPublic) return;
    if (!active.setupCompletedAt && path !== "/setup") router.replace("/setup");
  }, [active, onPublic, path, router]);

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

  const visible = links.filter((l) => !l.show || l.show(active?.revenueModel ?? "BOTH"));

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden>
            {/* Gauge ring — a reading on the business. Trade-neutral, and echoes the
                health score at the heart of the product. */}
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="6.4" stroke="#fff" strokeWidth="2.4" fill="none" />
              <circle cx="10" cy="10" r="1.6" fill="#fff" />
            </svg>
          </span>
          Plumb
        </Link>

        {me && !onPublic && path !== "/setup" &&
          visible.map((l) => {
            const isActive = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`navlink${isActive ? " active" : ""}`}>
                {l.label}
              </Link>
            );
          })}

        <span className="topbar-spacer" />

        {me && !onPublic && (
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
