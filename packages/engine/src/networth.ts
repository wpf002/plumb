import type { Asset, Cents, Liability } from "@plumb/shared";
import { valueAssets, totalAssetValueCents, type AssetValue } from "./assets.js";
import { summarizeLiability, type LiabilitySummary } from "./liabilities.js";

export interface NetWorthResult {
  asOf: Date;
  cashCents: Cents;
  assetValueCents: Cents;
  /** cash + depreciated assets */
  totalAssetsCents: Cents;
  totalLiabilitiesCents: Cents;
  netWorthCents: Cents;
  monthlyDepreciationCents: Cents;
  assets: AssetValue[];
  liabilities: LiabilitySummary[];
  byAssetCategory: { category: Asset["category"]; valueCents: Cents }[];
  byLiabilityKind: { kind: Liability["kind"]; balanceCents: Cents }[];
}

export interface NetWorthInput {
  asOf: Date;
  cashCents: Cents;
  assets: Asset[];
  liabilities: Liability[];
  /** How far out to look when projecting payoff dates. */
  horizonEnd: Date;
}

/**
 * The balance-sheet view: what the business owns (cash + depreciated assets)
 * against what it owes. Deliberately plain — an owner should be able to check
 * every line by hand.
 */
export function computeNetWorth(input: NetWorthInput): NetWorthResult {
  const { asOf, cashCents, assets, liabilities, horizonEnd } = input;

  const assetValues = valueAssets(assets, asOf);
  const assetValueCents = totalAssetValueCents(assets, asOf);
  const active = liabilities.filter((l) => l.active);
  const liabilitySummaries = active.map((l) => summarizeLiability(l, asOf, horizonEnd));
  const totalLiabilitiesCents = active.reduce((s, l) => s + l.currentBalanceCents, 0);

  const byCategory = new Map<Asset["category"], Cents>();
  for (const a of assetValues) {
    byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + a.currentValueCents);
  }
  const byKind = new Map<Liability["kind"], Cents>();
  for (const l of active) {
    byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + l.currentBalanceCents);
  }

  const totalAssetsCents = cashCents + assetValueCents;

  return {
    asOf,
    cashCents,
    assetValueCents,
    totalAssetsCents,
    totalLiabilitiesCents,
    netWorthCents: totalAssetsCents - totalLiabilitiesCents,
    monthlyDepreciationCents: assetValues.reduce((s, a) => s + a.monthlyDepreciationCents, 0),
    assets: assetValues,
    liabilities: liabilitySummaries,
    byAssetCategory: [...byCategory.entries()].map(([category, valueCents]) => ({
      category,
      valueCents,
    })),
    byLiabilityKind: [...byKind.entries()].map(([kind, balanceCents]) => ({ kind, balanceCents })),
  };
}
