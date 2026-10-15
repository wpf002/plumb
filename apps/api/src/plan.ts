import { prisma } from "@plumb/db";
import { FEATURE_LABEL, FEATURE_PLAN, LIMITS, PLAN_LABEL, PLANS, allows, asPlan, featuresFor, type Feature, type Plan } from "@plumb/shared";

/**
 * Plan enforcement on the API. A route maps to a feature; a company whose plan
 * doesn't include it gets a 403 with code PLAN_REQUIRED that the web app turns
 * into a locked state. Feature flags only: no billing.
 */

const C = "^\\/companies\\/[^/]+";
const ROUTES: { re: RegExp; feature: Feature; methods?: string[] }[] = [
  { re: new RegExp(`${C}\\/forecast\\/(13-week|12-month|revenue|accuracy)$`), feature: "forecasts" },
  { re: new RegExp(`${C}\\/jobs\\/wip$`), feature: "wip" },
  { re: new RegExp(`${C}\\/jobs\\/change-orders$`), feature: "changeOrders" },
  { re: new RegExp(`${C}\\/jobs\\/retainage$`), feature: "retainage" },
  { re: new RegExp(`${C}\\/jobs\\/backlog$`), feature: "backlog" },
  { re: new RegExp(`${C}\\/jobs\\/pipeline$`), feature: "pipeline" },
  { re: new RegExp(`${C}\\/jobs\\/estimates$`), feature: "estimates" },
  { re: new RegExp(`${C}\\/operations\\/labor$`), feature: "labor" },
  { re: new RegExp(`${C}\\/operations\\/recurring$`), feature: "recurring" },
  { re: new RegExp(`${C}\\/operations\\/capacity$`), feature: "capacity" },
  { re: new RegExp(`${C}\\/operations\\/service-calls$`), feature: "serviceCalls" },
  { re: new RegExp(`${C}\\/operations\\/benchmarks$`), feature: "benchmarks" },
  { re: new RegExp(`${C}\\/capital\\/(purchase|repair-replace|hire|crew|defaults)$`), feature: "capital" },
  { re: new RegExp(`${C}\\/what-if(\\/options)?$`), feature: "scenarios" },
  { re: new RegExp(`${C}\\/brief$`), feature: "brief" },
  { re: new RegExp(`${C}\\/tax-package$`), feature: "taxPackage" },
  { re: new RegExp(`${C}\\/valuation$`), feature: "valuation" },
  { re: new RegExp(`${C}\\/(tools|api-keys|tool-calls)(\\/|$)`), feature: "api" },
  { re: new RegExp(`${C}\\/export(\\/|$)`), feature: "exports" },
  { re: new RegExp(`${C}\\/lender-package$`), feature: "lenderPackage" },
  { re: new RegExp(`${C}\\/dashboard-layout$`), feature: "customDashboards", methods: ["PUT"] },
];

export function featureForRoute(method: string, path: string): Feature | null {
  const r = ROUTES.find((x) => x.re.test(path) && (!x.methods || x.methods.includes(method)));
  return r?.feature ?? null;
}

export async function planOf(companyId: string): Promise<Plan> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { plan: true } });
  return asPlan(c?.plan);
}

export function planRequired(feature: Feature) {
  const needed = FEATURE_PLAN[feature];
  return { error: "Plan", code: "PLAN_REQUIRED", feature, plan: needed, message: `${FEATURE_LABEL[feature]} is on the ${PLAN_LABEL[needed]} plan.` };
}

export async function requireFeature(companyId: string, feature: Feature) {
  return allows(await planOf(companyId), feature) ? null : planRequired(feature);
}

const month = () => new Date().toISOString().slice(0, 7);

/** Count one Ask Denny question; null when allowed, an error body when over the plan's limit. */
export async function meterDenny(companyId: string) {
  const plan = await planOf(companyId);
  const limit = LIMITS[plan].dennyPerMonth;
  const period = month();
  const row = await prisma.usageCounter.upsert({
    where: { companyId_metric_period: { companyId, metric: "denny", period } },
    create: { companyId, metric: "denny", period, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (limit !== null && row.count > limit) {
    await prisma.usageCounter.update({ where: { id: row.id }, data: { count: { decrement: 1 } } });
    return { error: "Plan", code: "PLAN_LIMIT", feature: "denny", message: `${PLAN_LABEL[plan]} includes ${limit} Ask Denny questions a month.` };
  }
  return null;
}

/** Seats in use (members plus open invitations) against the plan's limit. */
export async function seatCheck(companyId: string) {
  const plan = await planOf(companyId);
  const limit = LIMITS[plan].seats;
  const [members, invites] = await Promise.all([
    prisma.membership.count({ where: { companyId } }),
    prisma.invitation.count({ where: { companyId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const used = members + invites;
  return { plan, limit, used, full: limit !== null && used >= limit };
}

export async function planSummary(companyId: string) {
  const plan = await planOf(companyId);
  const [denny, seats] = await Promise.all([
    prisma.usageCounter.findUnique({ where: { companyId_metric_period: { companyId, metric: "denny", period: month() } } }),
    seatCheck(companyId),
  ]);
  return {
    plan,
    plans: PLANS.map((p) => ({ key: p, label: PLAN_LABEL[p], limits: LIMITS[p] })),
    features: featuresFor(plan),
    catalog: (Object.keys(FEATURE_PLAN) as Feature[]).map((f) => ({ key: f, label: FEATURE_LABEL[f], plan: FEATURE_PLAN[f] })),
    limits: LIMITS[plan],
    usage: { denny: denny?.count ?? 0, seats: seats.used },
  };
}
