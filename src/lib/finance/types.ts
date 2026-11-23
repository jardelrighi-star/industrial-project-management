import type { SankhyaReportFields } from "./sankhya-report-fields";

/** All monetary amounts are BRL integer cents. Dates use YYYY-MM-DD. */
export type ProjectCode = string;
export type ExternalApprovalStatus = "pending" | "approved" | "rejected";

export interface OriginalBudgetCorrection {
  /** null identifies the first manual registration, never an inferred legacy amount. */
  previousAmount: number | null;
  newAmount: number;
  recordedAt: string;
  justification: string;
}

export interface ProjectBudget {
  projectCode: ProjectCode;
  originalApprovedAmount: number;
  /** Derived from originalApprovedAmount and externally approved adjustments. */
  updatedAmount: number;
  /** Optional for v1 compatibility. Append-only manual registration/correction history. */
  corrections?: OriginalBudgetCorrection[];
  /** Explicit reconciliation evidence; legacy cadastral values are never overwritten. */
  reconciliation?: {
    legacyAmount: number;
    previousOriginalAmount: number | null;
    decision: "keep_financial" | "use_legacy" | "approve_zero";
    confirmedAt: string;
  };
}

type AdjustmentBase = {
  id: string;
  projectCode: ProjectCode;
  amount: number;
  justification: string;
  date: string;
  externalApprovalReference: string | null;
  status: ExternalApprovalStatus;
};

export type BudgetAdjustment = AdjustmentBase & (
  | { type: "increase" | "reduction" }
  | {
      type: "transfer";
      /** projectCode is the source; a transfer exists only once in the ledger. */
      sourceProjectCode: ProjectCode;
      destinationProjectCode: ProjectCode;
    }
);

export interface Traceability {
  sourceSystem: string;
  /** Stable source identity, preserved across repeated imports. */
  sourceRecordId: string;
  recordedAt: string;
  externalReference: string | null;
}

export interface PurchaseRequisition {
  reportFields?: SankhyaReportFields;
  code: string;
  /** Contracting purpose from Sankhya; empty when not provided by the source. */
  objective: string;
  projectCode: ProjectCode;
  amount: number;
  approvalStatus: ExternalApprovalStatus;
  convertedOrderNumber: string | null;
  /** Optional provenance for imported SCs; approval comes from Confirmada. */
  sankhya?: { confirmed: boolean; sourceFile: string; sourceSheet: string; sourceRow: number };
  traceability: Traceability;
}

export interface PurchaseOrder {
  reportFields?: SankhyaReportFields;
  number: string;
  /** Contracting purpose from Sankhya; empty when unknown. */
  objective: string;
  /** Supplier identification as supplied by Sankhya; not a deduplication key. */
  supplier: string;
  projectCode: ProjectCode;
  /** null when a pending-delivery export supplies only the open commitment. */
  totalAmount: number | null;
  invoicedAmount: number | null;
  /** totalAmount - invoicedAmount, or the explicit Vlr Pend from a delivery export. */
  openBalance: number;
  requisitionCode: string | null;
  status: "open" | "partially_invoiced" | "fully_invoiced" | "cancelled" | "pending_delivery";
  sankhya?: {
    balanceField: "Vlr Pend";
    sourceFile: string;
    sourceSheet: string;
    internalOrderId?: string;
    items: { sourceRow: number; product: string; objective: string; openBalance: number; requisitionCode?: string }[];
  };
  traceability: Traceability;
}

export interface ActualCost {
  reportFields?: SankhyaReportFields;
  transactionId: string;
  /** Read-only flag used by a filtered portfolio to prevent ambiguous reviews. */
  reviewUnavailable?: true;
  /** Optional metadata keeps legacy costs compatible. */
  description?: string;
  assetDescription?: string;
  sankhya?: {
    internalNoteId: string;
    projectYear: string;
    codproj: string;
    adProjIhbl: string;
    companyCode: string;
    productCode: string;
    partnerCode: string;
    costCenterCode: string;
    operationCode: string;
    identification: string;
    sourceFile: string;
    sourceSheet: string;
    sourceRow: number;
  };
  /** Supplier identification as supplied by Sankhya; empty when unknown. */
  supplier: string;
  projectCode: ProjectCode;
  /** Fiscal document reference (NUMNOTA for Sankhya). documentEntryId disambiguates notes/items. */
  fiscalDocument: string;
  /** Stable line/allocation identity: permits legitimate lines of the same invoice. */
  documentEntryId: string;
  date: string;
  amount: number;
  traceability: Traceability;
}

export interface FinanceData {
  budgets: ProjectBudget[];
  adjustments: BudgetAdjustment[];
  requisitions: PurchaseRequisition[];
  orders: PurchaseOrder[];
  actualCosts: ActualCost[];
  actualCostReviews?: ActualCostReview[];
}

export interface ActualCostReview {
  identity: string;
  events: ActualCostReviewEvent[];
  requiresReview?: true;
}

export type ActualCostReviewAction = "recognized" | "rejected" | "analyst_validated" | "analyst_rejected";

export interface ActualCostReviewEvent {
  action: ActualCostReviewAction | "returned";
  at: string;
  actor: string;
  actorId?: string;
  note: string;
  cost: ActualCostReviewSnapshot;
}

export interface ActualCostReviewSnapshot {
  revision: string;
  projectCode: string;
  fiscalDocument: string;
  amount: number;
  description: string;
  supplier: string;
  internalNoteId?: string;
}

export interface ProjectFinancialSummary extends ProjectBudget {
  approvedUnconvertedRequisitions: number;
  uninvoicedOrderBalance: number;
  totalActual: number;
  /** Open requisitions + open orders; excludes actual costs. */
  totalCommitted: number;
  availableBalance: number;
  /** null when updated budget is zero or negative. */
  financialExecutionPercent: number | null;
}
