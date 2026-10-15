/**
 * Plan entitlements: which features each tier includes and its usage limits.
 * Feature flags only. Nothing here collects payment.
 */

export type Plan = "ESSENTIALS" | "PRO" | "BUSINESS";
export const PLANS: Plan[] = ["ESSENTIALS", "PRO", "BUSINESS"];
export const PLAN_LABEL: Record<Plan, string> = { ESSENTIALS: "Essentials", PRO: "Pro", BUSINESS: "Business" };

/** The lowest plan that includes each feature. Anything not listed is in every plan. */
export const FEATURE_PLAN = {
  // Pro
  forecasts: "PRO",
  backlog: "PRO",
  pipeline: "PRO",
  wip: "PRO",
  changeOrders: "PRO",
  retainage: "PRO",
  estimates: "PRO",
  labor: "PRO",
  recurring: "PRO",
  capacity: "PRO",
  serviceCalls: "PRO",
  capital: "PRO",
  scenarios: "PRO",
  brief: "PRO",
  taxPackage: "PRO",
  premiumIntegrations: "PRO",
  // Business
  groups: "BUSINESS",
  advancedRoles: "BUSINESS",
  customDashboards: "BUSINESS",
  valuation: "BUSINESS",
  api: "BUSINESS",
  exports: "BUSINESS",
  benchmarks: "BUSINESS",
  lenderPackage: "BUSINESS",
} as const satisfies Record<string, Plan>;

export type Feature = keyof typeof FEATURE_PLAN;

export const FEATURE_LABEL: Record<Feature, string> = {
  forecasts: "Cash and revenue forecasts",
  backlog: "Backlog",
  pipeline: "Pipeline",
  wip: "WIP",
  changeOrders: "Change orders",
  retainage: "Retainage",
  estimates: "Estimate vs actual",
  labor: "Crews and labor",
  recurring: "Recurring revenue",
  capacity: "Capacity",
  serviceCalls: "Service calls",
  capital: "Equipment, hiring, and crew decisions",
  scenarios: "Scenarios",
  brief: "Weekly brief",
  taxPackage: "Tax package",
  premiumIntegrations: "Field service, construction, payroll, and CRM integrations",
  groups: "Multi-company reporting",
  advancedRoles: "Accountant and viewer access",
  customDashboards: "Custom dashboards",
  valuation: "Valuation and exit readiness",
  api: "API and AI connectors",
  exports: "Data warehouse exports",
  benchmarks: "Benchmarks",
  lenderPackage: "Lender package",
};

export const LIMITS: Record<Plan, { seats: number | null; dennyPerMonth: number | null }> = {
  ESSENTIALS: { seats: 3, dennyPerMonth: 25 },
  PRO: { seats: 10, dennyPerMonth: 250 },
  BUSINESS: { seats: null, dennyPerMonth: null },
};

const RANK: Record<Plan, number> = { ESSENTIALS: 0, PRO: 1, BUSINESS: 2 };

export const asPlan = (p: string | null | undefined): Plan => (p === "ESSENTIALS" || p === "PRO" || p === "BUSINESS" ? p : "BUSINESS");

export function allows(plan: Plan, feature: Feature): boolean {
  return RANK[plan] >= RANK[FEATURE_PLAN[feature]];
}

export function featuresFor(plan: Plan): Feature[] {
  return (Object.keys(FEATURE_PLAN) as Feature[]).filter((f) => allows(plan, f));
}
