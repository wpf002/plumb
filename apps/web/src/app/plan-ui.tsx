"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const PLAN: Record<string, string> = { ESSENTIALS: "Essentials", PRO: "Pro", BUSINESS: "Business" };

/** Shown in place of a section the company's plan doesn't include. */
export function Locked({ info }: { info: { message?: string; plan?: string } }) {
  return (
    <section className="card locked">
      <span className="badge info">{PLAN[info.plan ?? ""] ?? "Upgrade"}</span>
      <div className="locked-title">{info.message ?? "Not on your plan."}</div>
      <Link href="/settings#plan" className="btn btn-ghost btn-xs">
        Change Plan
      </Link>
    </section>
  );
}

/** The last plan gate or limit the app ran into, until dismissed. */
export function PlanNotice() {
  const [info, setInfo] = useState<{ message: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setInfo((e as CustomEvent).detail);
    window.addEventListener("plan-required", on);
    return () => window.removeEventListener("plan-required", on);
  }, []);
  if (!info) return null;
  return (
    <div className="plan-notice" role="status">
      <span>{info.message}</span>
      <Link href="/settings#plan" onClick={() => setInfo(null)}>
        Change Plan
      </Link>
      <button onClick={() => setInfo(null)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
