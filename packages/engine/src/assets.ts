import type { Asset, Cents } from "@plumb/shared";
import { monthsBetween } from "@plumb/shared";

export interface AssetValue {
  assetId: string;
  name: string;
  category: Asset["category"];
  purchaseCostCents: Cents;
  /** Value at `asOf` after depreciation (or the owner's anchor). */
  currentValueCents: Cents;
  /** purchaseCost - currentValue. What the asset has given up so far. */
  depreciationToDateCents: Cents;
  monthlyDepreciationCents: Cents;
  /** True when the value came straight from the owner rather than the formula. */
  ownerAnchored: boolean;
}

/**
 * Straight-line depreciation per month. Zero when no useful life is set — the
 * owner then either enters a value manually or the asset holds at cost.
 */
export function monthlyDepreciationCents(asset: Asset): Cents {
  if (!asset.usefulLifeMonths || asset.usefulLifeMonths <= 0) return 0;
  const depreciable = asset.purchaseCostCents - asset.salvageValueCents;
  if (depreciable <= 0) return 0;
  return Math.round(depreciable / asset.usefulLifeMonths);
}

/**
 * Value of an asset at `asOf`.
 *
 * The owner's manual number always wins: if `currentValueCents` is set it
 * becomes the anchor as of `valueAsOf`, and straight-line decline continues
 * from there only when a useful life is known. Without a manual value we
 * depreciate from the purchase date. Never falls below salvage.
 *
 * This is decision support, not tax basis — no MACRS, no half-year convention.
 */
export function depreciatedValueCents(asset: Asset, asOf: Date): Cents {
  if (asset.disposedAt && asOf >= asset.disposedAt) return 0;

  const monthly = monthlyDepreciationCents(asset);
  const floor = asset.salvageValueCents;

  const anchored = asset.currentValueCents !== undefined;
  const anchorValue = anchored ? (asset.currentValueCents as Cents) : asset.purchaseCostCents;
  const anchorDate = anchored ? asset.valueAsOf ?? asset.purchaseDate : asset.purchaseDate;

  if (monthly === 0) return Math.max(floor, anchorValue);

  const months = monthsBetween(anchorDate, asOf);
  return Math.max(floor, anchorValue - monthly * months);
}

export function valueAssets(assets: Asset[], asOf: Date): AssetValue[] {
  return assets.map((a) => {
    const currentValueCents = depreciatedValueCents(a, asOf);
    return {
      assetId: a.id,
      name: a.name,
      category: a.category,
      purchaseCostCents: a.purchaseCostCents,
      currentValueCents,
      depreciationToDateCents: a.purchaseCostCents - currentValueCents,
      monthlyDepreciationCents: monthlyDepreciationCents(a),
      ownerAnchored: a.currentValueCents !== undefined,
    };
  });
}

export function totalAssetValueCents(assets: Asset[], asOf: Date): Cents {
  return assets.reduce((sum, a) => sum + depreciatedValueCents(a, asOf), 0);
}
