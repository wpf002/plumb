/**
 * The adapter contract every outside system implements. An adapter turns a
 * source's API into a CanonicalBatch of DNRD objects; applyBatch writes the
 * batch the same way for every source, keyed by `${source}:${id}` so syncs are
 * idempotent.
 */

export type SourceCategory =
  | "accounting"
  | "banking"
  | "payments"
  | "payroll"
  | "time"
  | "field_service"
  | "construction"
  | "estimating"
  | "fleet"
  | "crm";

export interface CanonicalBatch {
  customers?: { externalId: string; name: string; segment?: string | null }[];
  vendors?: { externalId: string; name: string; category?: string | null }[];
  invoices?: {
    externalId: string;
    customerExternalId?: string | null;
    customerName?: string | null;
    jobExternalId?: string | null;
    issueDate: Date;
    dueDate?: Date | null;
    amountCents: number;
    paidDate?: Date | null;
  }[];
  bills?: { externalId: string; vendorExternalId?: string | null; vendorName?: string | null; billDate: Date; dueDate?: Date | null; amountCents: number; paidDate?: Date | null; category?: string | null }[];
  payments?: { invoiceExternalId: string; date: Date; amountCents: number }[];
  accounts?: { externalId: string; name: string; type: "checking" | "savings" | "credit" | "loan" | "processor"; mask?: string | null; balanceCents: number; asOf: Date }[];
  transactions?: {
    externalId: string;
    accountExternalId?: string | null;
    date: Date;
    amountCents: number;
    description: string;
    merchant?: string | null;
    category?: string | null;
    kind?: "CHARGE" | "REFUND" | "FEE" | "PAYOUT" | "TRANSFER" | null;
    pending?: boolean;
  }[];
  payroll?: { employeeExternalId: string; employeeName: string; position?: string | null; period: string; grossPayCents: number; regularHours?: number; overtimeHours?: number }[];
  jobs?: {
    externalId: string;
    name: string;
    customerExternalId?: string | null;
    customerName?: string | null;
    status: "BIDDING" | "AWARDED" | "ACTIVE" | "CLOSED";
    contractCents: number;
    estimatedCostCents?: number | null;
    startDate?: Date | null;
    endDate?: Date | null;
    category?: string | null;
    percentComplete?: number | null;
  }[];
  timeEntries?: { employeeExternalId: string; employeeName: string; jobExternalId?: string | null; date: Date; hours: number; overtimeHours?: number; costCents?: number | null }[];
  opportunities?: { externalId: string; description: string; customerName?: string | null; valueCents: number; probabilityPct: number; expectedStart?: Date | null; expectedClose?: Date | null; status: "OPEN" | "WON" | "LOST"; lostReason?: string | null }[];
  vehicles?: { externalId: string; name: string; odometerMiles?: number | null; engineHours?: number | null; utilizationPct?: number | null; fuelCostAnnualCents?: number | null; maintenanceCostAnnualCents?: number | null; downtimeDaysAnnual?: number | null }[];
}

export interface AdapterContext {
  companyId: string;
  since?: Date;
  /** Decrypted per-company credentials, when the company connected its own account. */
  credentials?: Record<string, string> | null;
  /** Sources this company has connected (OAuth or stored credentials). */
  connected?: Set<string>;
}

export interface SourceAdapter {
  key: string;
  name: string;
  category: SourceCategory;
  /** Roadmap phase that ships it: 1 (D15), 2 (D16), 3 (D17). */
  phase: 1 | 2 | 3;
  /** Environment variables that enable the live path for a single-tenant install. */
  env: string[];
  /** Objects this source fills. */
  provides: (keyof CanonicalBatch)[];
  /** True when credentials exist for this company or the install. */
  live(ctx: AdapterContext): boolean;
  /** Read from the real API. Only called when live. */
  fetch(ctx: AdapterContext): Promise<CanonicalBatch>;
  /** Representative data for a preview when the source isn't connected. Never written. */
  sample(ctx: AdapterContext): CanonicalBatch;
}
