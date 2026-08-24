export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4300";

export const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export const usdExact = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Active company id from the (non-httpOnly) session cookie. Client-side only. */
export function getCompanyId(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)plumb_company=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/** fetch to the API that always sends the session cookie. */
export function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${API}${path}`, { ...init, credentials: "include" });
}

/** Palette values needed in JS (SVG ring, inline bar fills). Mirrors globals.css. */
export const C = {
  navy: "#0e2a47",
  green: "#157a5a",
  amber: "#b45309",
  red: "#b42318",
  orange: "#ea580c",
  line: "#dde3e9",
};

/** Score → color bucket for the health ring and component bars. */
export function scoreColor(score: number): string {
  if (score >= 80) return C.green;
  if (score >= 60) return C.amber;
  return C.red;
}

/** Business profile vocabulary. Mirrors the Trade / RevenueModel enums in the DB. */
export const TRADES = [
  "ELECTRICAL",
  "HVAC",
  "PLUMBING",
  "ROOFING",
  "MASONRY",
  "DRYWALL",
  "CONCRETE",
  "MECHANICAL",
  "LANDSCAPING",
  "GENERAL",
  "OTHER",
] as const;

export type Trade = (typeof TRADES)[number];

export const TRADE_LABELS: Record<Trade, string> = {
  ELECTRICAL: "Electrical",
  HVAC: "HVAC",
  PLUMBING: "Plumbing",
  ROOFING: "Roofing",
  MASONRY: "Masonry",
  DRYWALL: "Drywall",
  CONCRETE: "Concrete",
  MECHANICAL: "Mechanical",
  LANDSCAPING: "Landscaping",
  GENERAL: "General contracting",
  OTHER: "Other trade",
};

export const REVENUE_MODELS = ["PROJECT", "RECURRING", "BOTH"] as const;

export type RevenueModel = (typeof REVENUE_MODELS)[number];

export const REVENUE_MODEL_COPY: Record<RevenueModel, { title: string; sub: string }> = {
  PROJECT: { title: "Bid work", sub: "Jobs you win by bid, with a start and an end." },
  RECURRING: { title: "Recurring service", sub: "Contracts that bill on a schedule." },
  BOTH: { title: "Both", sub: "Bid jobs plus recurring service agreements." },
};

/** Does this company's revenue model turn on project-based modules? */
export const hasProjects = (m?: string) => m !== "RECURRING";
/** …and recurring-revenue modules (service contracts)? */
export const hasServices = (m?: string) => m === "RECURRING" || m === "BOTH";

/** Balance-sheet vocabulary. Mirrors AssetCategory / LiabilityKind / Frequency. */
export const ASSET_CATEGORIES = [
  "VEHICLE",
  "EQUIPMENT",
  "REAL_ESTATE",
  "TECHNOLOGY",
  "OTHER",
] as const;

export const ASSET_CATEGORY_LABELS: Record<string, string> = {
  VEHICLE: "Vehicle",
  EQUIPMENT: "Equipment / machinery",
  REAL_ESTATE: "Real estate / building",
  TECHNOLOGY: "Technology",
  OTHER: "Other",
};

export const LIABILITY_KINDS = [
  "CREDIT_CARD",
  "LINE_OF_CREDIT",
  "TERM_LOAN",
  "SBA_LOAN",
  "MORTGAGE",
  "EQUIPMENT_LEASE",
  "BUILDING_LEASE",
  "OTHER",
] as const;

export const LIABILITY_KIND_LABELS: Record<string, string> = {
  CREDIT_CARD: "Credit card",
  LINE_OF_CREDIT: "Line of credit",
  TERM_LOAN: "Bank loan",
  SBA_LOAN: "SBA loan",
  MORTGAGE: "Mortgage",
  EQUIPMENT_LEASE: "Equipment lease",
  BUILDING_LEASE: "Building lease",
  OTHER: "Other",
};

export const FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;

export const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annually",
};

/** YYYY-MM-DD for <input type="date">, from an ISO string or Date. */
export const dateInput = (v: string | Date | null | undefined) =>
  v ? new Date(v).toISOString().slice(0, 10) : "";

/**
 * Short human date for tables. Rendered in UTC on purpose: dates are stored at
 * UTC midnight, and formatting them in a western timezone would show the day
 * before.
 */
export const shortDate = (v: string | Date | null | undefined) =>
  v
    ? new Date(v).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

/** Dollars typed by a human → integer cents. */
export const centsFrom = (v: string) => Math.round((Number(v) || 0) * 100);
