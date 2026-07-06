import type { Cents } from "./money.js";

export type ClientType = "OWNER_DIRECT" | "GC";
export type ProjectStatus = "BIDDING" | "AWARDED" | "ACTIVE" | "CLOSED";
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
  targetMarginPct: number;
  retainagePct: number;
  startDate: Date;
  endDate: Date;
  /** 0..1 physical/earned completion. Optional; falls back to cost ratio. */
  percentComplete?: number;
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
