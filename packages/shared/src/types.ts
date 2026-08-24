import type { Cents } from "./money.js";

export type Trade =
  | "ELECTRICAL"
  | "HVAC"
  | "PLUMBING"
  | "ROOFING"
  | "MASONRY"
  | "DRYWALL"
  | "CONCRETE"
  | "MECHANICAL"
  | "LANDSCAPING"
  | "GENERAL"
  | "OTHER";
/** Which revenue models a company runs. Gates which modules are active. */
export type RevenueModel = "PROJECT" | "RECURRING" | "BOTH";
export type ClientType = "OWNER_DIRECT" | "GC";
export type AssetCategory =
  | "VEHICLE"
  | "EQUIPMENT"
  | "REAL_ESTATE"
  | "TECHNOLOGY"
  | "OTHER";
export type LiabilityKind =
  | "CREDIT_CARD"
  | "LINE_OF_CREDIT"
  | "TERM_LOAN"
  | "SBA_LOAN"
  | "MORTGAGE"
  | "EQUIPMENT_LEASE"
  | "BUILDING_LEASE"
  | "OTHER";
/** Payment cadence shared by liabilities, recurring overhead, and services. */
export type Frequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";
export type ProjectStatus = "BIDDING" | "AWARDED" | "ACTIVE" | "CLOSED";
export type BillingType =
  | "FIXED_PRICE"
  | "COST_PLUS"
  | "TIME_AND_MATERIAL"
  | "AIA";
export type CostCategory =
  | "LABOR"
  | "MATERIAL"
  | "EQUIPMENT"
  | "TRAVEL"
  | "SUBCONTRACT"
  | "OTHER";
export type CashDirection = "IN" | "OUT";
export type CashCategory =
  | "PROGRESS_BILLING"
  | "RETAINAGE_RELEASE"
  | "PAYROLL"
  | "VENDOR_BILL"
  | "OVERHEAD"
  | "TAX"
  | "LOAN"
  | "INSURANCE";
export type CashStatus = "EXPECTED" | "RECEIVED" | "PAID" | "LATE";
export type ChangeOrderStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface Project {
  id: string;
  name: string;
  client: string;
  clientType: ClientType;
  status: ProjectStatus;
  contractValueCents: Cents;
  /** Total estimated cost at time of bid (labor + material + everything). */
  originalBidCostCents: Cents;
  /** Cents billed to the client so far (drives WIP over/under billing). */
  billedToDateCents: Cents;
  billingType: BillingType;
  netDays: number;
  targetMarginPct: number;
  retainagePct: number;
  startDate: Date;
  endDate: Date;
  /** 0..1 physical/earned completion. Optional; falls back to cost ratio. */
  percentComplete?: number;
}

/** Budgeted cost per category (optionally per phase). Drives overrun analysis. */
export interface BudgetLine {
  category: CostCategory;
  budgetedCostCents: Cents;
  budgetedHours?: number;
  phaseId?: string;
}

export interface CostEntry {
  id: string;
  projectId: string;
  category: CostCategory;
  amountCents: Cents;
  incurredDate: Date;
}

export interface ChangeOrder {
  id: string;
  projectId: string;
  contractDeltaCents: Cents;
  costDeltaCents: Cents;
  status: ChangeOrderStatus;
  date: Date;
}

export interface CashEvent {
  id: string;
  projectId: string | null;
  direction: CashDirection;
  amountCents: Cents; // always positive; direction carries the sign
  category: CashCategory;
  expectedDate: Date;
  actualDate: Date | null;
  status: CashStatus;
}

/** Remaining committed labor hours per month for an active project. */
export interface LaborCommitment {
  projectId: string;
  month: string; // YYYY-MM
  hours: number;
}

export interface Capacity {
  /** Billable labor hours the crew can deliver in a month at full utilization. */
  monthlyLaborHours: number;
}

/** What the business owns. Depreciated, not just logged at sunk cost. */
export interface Asset {
  id: string;
  name: string;
  category: AssetCategory;
  purchaseDate: Date;
  purchaseCostCents: Cents;
  /** Owner-entered value; anchors depreciation from `valueAsOf`. */
  currentValueCents?: Cents;
  valueAsOf?: Date;
  /** Straight-line life. Omitted => the value holds flat at its anchor. */
  usefulLifeMonths?: number;
  salvageValueCents: Cents;
  disposedAt?: Date;
}

/** What the business owes, with the payment obligation that feeds cash flow. */
export interface Liability {
  id: string;
  name: string;
  kind: LiabilityKind;
  currentBalanceCents: Cents;
  creditLimitCents?: Cents;
  interestRatePct: number;
  paymentAmountCents: Cents;
  paymentFrequency: Frequency;
  nextPaymentDate?: Date;
  payoffDate?: Date;
  /** Lease expiry. Payments stop here even if a balance remains. */
  endDate?: Date;
  assetId?: string;
  active: boolean;
}

/** Payments per year for each cadence. The one place this mapping lives. */
export const PERIODS_PER_YEAR: Record<Frequency, number> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  MONTHLY: 12,
  QUARTERLY: 4,
  ANNUAL: 1,
};

/** Advance a date by one period of `frequency` (UTC-safe). */
export function addPeriod(date: Date, frequency: Frequency): Date {
  const d = new Date(date.getTime());
  switch (frequency) {
    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "BIWEEKLY":
      d.setUTCDate(d.getUTCDate() + 14);
      break;
    case "MONTHLY":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "QUARTERLY":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "ANNUAL":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d;
}

/** Normalize any cadence to a monthly-equivalent amount, for "what's my nut". */
export function monthlyEquivalentCents(amountCents: Cents, frequency: Frequency): Cents {
  return Math.round((amountCents * PERIODS_PER_YEAR[frequency]) / 12);
}

/** Whole months between two dates, floored at 0. */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth()) -
    (to.getUTCDate() < from.getUTCDate() ? 1 : 0);
  return Math.max(0, months);
}

/**
 * A recurring running cost that isn't debt — insurance, software, fuel, rent.
 * Expanded into projected outflows by `engine/schedule`.
 */
export interface RecurringExpense {
  id: string;
  name: string;
  category: CashCategory;
  amountCents: Cents;
  frequency: Frequency;
  startDate: Date;
  endDate?: Date;
  active: boolean;
}

export type MilestoneTrigger = "DATE" | "PERCENT_COMPLETE" | "PHASE_COMPLETE";
export type MilestoneStatus = "PLANNED" | "READY" | "BILLED" | "PAID";

/**
 * A contract-defined billing point. Replaces inferring when a project turns
 * into cash with the schedule the contract actually specifies.
 */
export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  sequence: number;
  trigger: MilestoneTrigger;
  triggerValue?: number;
  phaseId?: string;
  expectedDate: Date;
  originalExpectedDate: Date;
  amountCents: Cents;
  retainagePct: number;
  status: MilestoneStatus;
  billedAt?: Date;
  paidAt?: Date;
}
