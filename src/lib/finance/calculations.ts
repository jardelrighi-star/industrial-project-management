import type { FinanceData, ProjectFinancialSummary, PurchaseOrder, Traceability } from "./types";
import { parseFinanceData, uniqueRecords } from "./validation";

const key = (...parts: string[]) => JSON.stringify(parts);
const sourceKey = (trace: Traceability) => key("source", trace.sourceSystem, trace.sourceRecordId);

export function purchaseOrderKey(order: PurchaseOrder) {
  const internalId = order.sankhya?.internalOrderId;
  return internalId ? key(order.projectCode, "internal", internalId) : key(order.projectCode, "number", order.number);
}

export function orderRequisitionCodes(order: PurchaseOrder): string[] {
  const codes = new Set<string>();
  if (order.requisitionCode) codes.add(order.requisitionCode);
  for (const item of order.sankhya?.items ?? []) if (item.requisitionCode) codes.add(item.requisitionCode);
  return [...codes];
}

export function emptyFinanceData(): FinanceData {
  return { budgets: [], adjustments: [], requisitions: [], orders: [], actualCosts: [] };
}

function sum(values: number[]): number {
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result)) throw new Error("Financial total exceeds safe integer cents");
  return result;
}

/** Canonicalizes identity and recomputes updated budgets, never trusting cached totals. */
export function normalizeFinanceData(value: unknown): FinanceData {
  const input = parseFinanceData(value);
  const budgets = uniqueRecords(input.budgets, (r) => [key(r.projectCode)]);
  const adjustments = uniqueRecords(input.adjustments, (r) => [key(r.id)]);
  const requisitions = uniqueRecords(input.requisitions, (r) => [key("sc", r.projectCode, r.code), sourceKey(r.traceability)]);
  const orders = uniqueRecords(input.orders, (r) => [purchaseOrderKey(r), sourceKey(r.traceability)]);
  const actualCosts = uniqueRecords(input.actualCosts, (r) => [key("transaction", r.transactionId), key("document", r.fiscalDocument, r.documentEntryId, r.projectCode), sourceKey(r.traceability)]);
  const knownProjects = new Set(budgets.map((b) => b.projectCode));
  // Actual costs may exist before budget registration; importing costs never invents budgets.
  for (const entry of [...adjustments, ...requisitions, ...orders]) {
    if (!knownProjects.has(entry.projectCode)) throw new Error(`Missing budget for project ${entry.projectCode}`);
  }
  for (const adjustment of adjustments) {
    if (adjustment.type === "transfer" && !knownProjects.has(adjustment.destinationProjectCode)) {
      throw new Error("Transfer destination must have a registered budget");
    }
  }
  return {
    budgets: budgets.map((budget) => ({
      ...budget,
      updatedAmount: sum([budget.originalApprovedAmount, ...adjustments.map((a) => {
        if (a.status !== "approved" || !a.externalApprovalReference) return 0;
        if (a.type === "transfer") {
          if (a.sourceProjectCode === budget.projectCode) return -a.amount;
          if (a.destinationProjectCode === budget.projectCode) return a.amount;
          return 0;
        }
        return a.projectCode === budget.projectCode ? (a.type === "increase" ? a.amount : -a.amount) : 0;
      })]),
    })),
    adjustments, requisitions, orders, actualCosts,
    ...(input.actualCostReviews === undefined ? {} : { actualCostReviews: input.actualCostReviews }),
  };
}

/** Pure calculation; no browser, storage, React or mutation dependencies. */
export function calculateActualCostTotal(projectCode: string, input: FinanceData): number {
  return sum(normalizeFinanceData(input).actualCosts.filter((c) => c.projectCode === projectCode).map((c) => c.amount));
}

function commitments(projectCodes: readonly string[], data: FinanceData) {
  const codes = new Set(projectCodes);
  const orders = data.orders.filter((o) => codes.has(o.projectCode));
  const converted = new Set(orders.flatMap((o) => orderRequisitionCodes(o).map((code) => key(o.projectCode, code))));
  const approvedUnconvertedRequisitions = sum(data.requisitions.filter((r) =>
    codes.has(r.projectCode) && r.approvalStatus === "approved" &&
    !r.convertedOrderNumber && !converted.has(key(r.projectCode, r.code))
  ).map((r) => r.amount));
  const uninvoicedOrderBalance = sum(orders.filter((o) => o.status !== "cancelled").map((o) => o.openBalance));
  return { approvedUnconvertedRequisitions, uninvoicedOrderBalance, totalCommitted: sum([approvedUnconvertedRequisitions, uninvoicedOrderBalance]) };
}

export function calculateCommittedBreakdown(projectCodes: readonly string[], input: FinanceData) {
  return commitments(projectCodes, normalizeFinanceData(input));
}

export function calculateCommittedTotal(projectCodes: readonly string[], input: FinanceData): number {
  return calculateCommittedBreakdown(projectCodes, input).totalCommitted;
}

export function calculateProjectFinancials(projectCode: string, input: FinanceData): ProjectFinancialSummary {
  const data = normalizeFinanceData(input);
  const budget = data.budgets.find((b) => b.projectCode === projectCode);
  if (!budget) throw new Error(`Financial budget not registered for project ${projectCode}`);
  const { approvedUnconvertedRequisitions, uninvoicedOrderBalance, totalCommitted } = commitments([projectCode], data);
  const totalActual = calculateActualCostTotal(projectCode, data);
  return {
    ...budget, approvedUnconvertedRequisitions, uninvoicedOrderBalance, totalActual, totalCommitted,
    availableBalance: sum([budget.updatedAmount, -totalCommitted, -totalActual]),
    financialExecutionPercent: budget.updatedAmount > 0 ? totalActual / budget.updatedAmount * 100 : null,
  };
}
