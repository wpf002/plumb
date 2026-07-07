"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/bid", label: "Bid decision" },
  { href: "/digest", label: "Weekly digest" },
];

export function Topbar() {
  const path = usePathname();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden>
            {/* plumb bob — a trade tool, and the logic: true / accurate */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1v3M3 4h10l-5 7-5-7Z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx="8" cy="13.5" r="1.5" fill="#fff" />
            </svg>
          </span>
          Plumb
        </Link>
        {links.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`navlink${active ? " active" : ""}`}>
              {l.label}
            </Link>
          );
        })}
        <span className="topbar-spacer" />
        <span className="topbar-tag">Foley Electric · demo</span>
      </div>
    </header>
  );
}
