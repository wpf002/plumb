import { type Cents, addDays } from "@plumb/shared";

// Retainage: the slice of each progress billing a client withholds until the job
// finishes. It's earned cash you can't touch yet — a real drag on near-term
// liquidity. This reports how much is held and when it should release. Pure;
// asOf is injected. Deterministic.

export interface RetainageInput {
  projectId: string;
  projectName: string;
  retainagePct: number;
  billedToDateCents: Cents;
  /** Contractual end date; release is projected from here + net terms. */
  endDate: Date;
  netDays: number;
}

export interface RetainageRow {
  projectId: string;
  projectName: string;
  retainagePct: number;
  /** Cash the client is holding back = billed-to-date * retainage %. */
  retainageHeldCents: Cents;
  /** Projected release: contractual end + payment terms. */
  projectedReleaseDate: string; // YYYY-MM-DD
  /** True once the projected release date is on/after asOf's horizon end. */
  releasesWithinHorizon: boolean;
}

export interface RetainageReport {
  rows: RetainageRow[];
  totalHeldCents: Cents;
  /** Retainage projected to release within `horizonDays` of asOf. */
  releasingSoonCents: Cents;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeRetainage(
  projects: RetainageInput[],
  asOf: Date,
  horizonDays = 90
): RetainageReport {
  const horizonEnd = addDays(asOf, horizonDays);
  const rows: RetainageRow[] = projects.map((p) => {
    const held = Math.round((p.billedToDateCents * p.retainagePct) / 100);
    const release = addDays(p.endDate, p.netDays);
    return {
      projectId: p.projectId,
      projectName: p.projectName,
      retainagePct: p.retainagePct,
      retainageHeldCents: held,
      projectedReleaseDate: isoDay(release),
      releasesWithinHorizon: release <= horizonEnd,
    };
  });

  const totalHeldCents = rows.reduce((a, r) => a + r.retainageHeldCents, 0);
  const releasingSoonCents = rows
    .filter((r) => r.releasesWithinHorizon)
    .reduce((a, r) => a + r.retainageHeldCents, 0);

  return { rows, totalHeldCents, releasingSoonCents };
}
