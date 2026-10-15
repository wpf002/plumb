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

// Seven sections. A section with several pages shows them as sub-tabs.
// `show` gates a section on the company's revenue model.
type Section = { label: string; href: string; pages?: { href: string; label: string }[]; show?: (m: string) => boolean };
const SECTIONS: Section[] = [
  { label: "Dashboard", href: "/" },
  { label: "Cash", href: "/cash", pages: [{ href: "/cash", label: "Forecast" }, { href: "/recurring", label: "Fixed Costs" }] },
  { label: "Financials", href: "/statements", pages: [{ href: "/statements", label: "Statements" }, { href: "/working-capital", label: "Working Capital" }, { href: "/balance-sheet", label: "Assets & Debt" }] },
  { label: "Jobs", href: "/projects", pages: [{ href: "/projects", label: "Jobs" }, { href: "/bid", label: "New Bid" }], show: hasProjects },
  { label: "Operations", href: "/operations" },
  { label: "Planning", href: "/plan" },
  { label: "Settings", href: "/settings", pages: [{ href: "/settings", label: "Company" }, { href: "/integrations", label: "Integrations" }, { href: "/digest", label: "Digest" }] },
];

const owns = (s: Section, path: string) => (s.href === "/" ? path === "/" : [s.href, ...(s.pages ?? []).map((p) => p.href)].some((h) => path === h || path.startsWith(`${h}/`)));

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

  const visible = SECTIONS.filter((l) => !l.show || l.show(active?.revenueModel ?? "BOTH"));
  const current = visible.find((s) => owns(s, path));
  const showNav = me && !onPublic && path !== "/setup";

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden>
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="6.4" stroke="#fff" strokeWidth="2.4" fill="none" />
              <circle cx="10" cy="10" r="1.6" fill="#fff" />
            </svg>
          </span>
          DNRD
        </Link>

        <nav className="topnav">
          {showNav &&
            visible.map((l) => (
              <Link key={l.href} href={l.href} className={`navlink${l === current ? " active" : ""}`}>
                {l.label}
              </Link>
            ))}
        </nav>

        {showNav && <MobileMenu sections={visible} current={current} />}
        {me && !onPublic && <AccountMenu me={me} active={active} onSwitch={switchCompany} onLogout={logout} />}
      </div>
      {showNav && current?.pages && (
        <div className="subnav">
          <div className="subnav-inner">
            {current.pages.map((p) => (
              <Link key={p.href} href={p.href} className={`sublink${path === p.href || path.startsWith(`${p.href}/`) ? " active" : ""}`}>
                {p.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

function AccountMenu({ me, active, onSwitch, onLogout }: { me: Me; active?: Company; onSwitch: (id: string) => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="account">
      <button className="account-button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="account-name">{active?.name ?? me.user.email}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          {me.companies.length > 1 && (
            <>
              <div className="account-label">Companies</div>
              {me.companies.map((c) => (
                <button key={c.id} role="menuitem" className={`account-item${c.id === me.activeCompanyId ? " current" : ""}`} onClick={() => { setOpen(false); onSwitch(c.id); }}>
                  {c.name}
                </button>
              ))}
              <Link href="/portfolio" className="account-item" role="menuitem">
                Portfolio
              </Link>
              <div className="account-divider" />
            </>
          )}
          <div className="account-label">{me.user.email}</div>
          <button role="menuitem" className="account-item" onClick={onLogout}>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

/** Under 760px the section links collapse into one menu. */
function MobileMenu({ sections, current }: { sections: Section[]; current?: Section }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="mobile-menu">
      <button className="account-button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {current?.label ?? "Menu"}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="account-menu" role="menu" style={{ left: 0, right: "auto" }}>
          {sections.map((s) => (
            <Link key={s.href} href={s.href} role="menuitem" className={`account-item${s === current ? " current" : ""}`}>
              {s.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
