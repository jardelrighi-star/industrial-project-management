import type { FinanceData } from "./types";

function fail(message: string): never {
  throw new Error(`Invalid financial data: ${message}`);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected object");
  return value as Record<string, unknown>;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) fail("expected nonempty trimmed text");
}
function optionalText(value: unknown) {
  if (value !== null) text(value);
}
function descriptiveText(value: unknown) {
  if (typeof value !== "string") fail("objective/supplier must be strings");
}
function money(value: unknown, signed = false) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (!signed && value < 0)) fail("expected safe integer cents");
}
function date(value: unknown) {
  text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail("invalid date");
}
function choice(value: unknown, options: string[]) {
  if (typeof value !== "string" || !options.includes(value)) fail("invalid status/type");
}
function trace(value: unknown) {
  const r = record(value);
  text(r.sourceSystem); text(r.sourceRecordId); text(r.recordedAt);
  if (!Number.isFinite(Date.parse(r.recordedAt))) fail("invalid recordedAt");
  optionalText(r.externalReference);
}

/** Runtime validation is required both for persisted JSON and future API inputs. */
export function validateFinanceData(value: unknown): asserts value is FinanceData {
  const data = record(value);
  if (data.actualCostReviews !== undefined) {
    if (!Array.isArray(data.actualCostReviews)) fail("invalid cost reviews");
    const identities = new Set<string>();
    for (const value of data.actualCostReviews) {
      const review = record(value);
      text(review.identity);
      if (identities.has(review.identity)) fail("duplicate cost review");
      identities.add(review.identity);
      if (review.requiresReview !== undefined && review.requiresReview !== true) fail("invalid cost review flag");
      if (!Array.isArray(review.events) || !review.events.length) fail("missing cost review history");
      for (const value of review.events) {
        const event = record(value);
        choice(event.action, ["recognized", "rejected", "returned", "analyst_validated", "analyst_rejected"]);
        text(event.actor); text(event.at);
        if (event.actorId !== undefined) text(event.actorId);
        if (!Number.isFinite(Date.parse(event.at))) fail("invalid cost review date");
        if (event.action === "recognized" || event.action === "analyst_rejected") descriptiveText(event.note);
        else text(event.note);
        const cost = record(event.cost);
        text(cost.revision); text(cost.projectCode); text(cost.fiscalDocument);
        money(cost.amount);
        descriptiveText(cost.description); descriptiveText(cost.supplier);
        if (cost.internalNoteId !== undefined) text(cost.internalNoteId);
      }
    }
  }
  for (const key of ["budgets", "adjustments", "requisitions", "orders", "actualCosts"]) {
    if (!Array.isArray(data[key])) fail(`missing collection ${key}`);
    for (const item of data[key]) {
      const r = record(item);
      text(r.projectCode);
      if (r.projectCode !== r.projectCode.toUpperCase()) fail("use canonical Sankhya project code");
      if (key === "budgets") {
        money(r.originalApprovedAmount); money(r.updatedAmount, true);
        if (r.corrections !== undefined) {
          if (!Array.isArray(r.corrections)) fail("budget corrections must be an array");
          for (const value of r.corrections) {
            const correction = record(value);
            if (correction.previousAmount !== null) money(correction.previousAmount);
            money(correction.newAmount); text(correction.justification); text(correction.recordedAt);
            if (!Number.isFinite(Date.parse(correction.recordedAt))) fail("invalid budget correction date");
            if (correction.previousAmount === correction.newAmount) fail("budget correction must change the value");
          }
        }
        if (r.reconciliation !== undefined) {
          const audit = record(r.reconciliation);
          money(audit.legacyAmount);
          if (audit.previousOriginalAmount !== null) money(audit.previousOriginalAmount);
          choice(audit.decision, ["keep_financial", "use_legacy", "approve_zero"]);
          text(audit.confirmedAt);
          if (!Number.isFinite(Date.parse(audit.confirmedAt))) fail("invalid reconciliation date");
        }
      } else if (key === "adjustments") {
        text(r.id); money(r.amount); text(r.justification); date(r.date);
        choice(r.type, ["increase", "reduction", "transfer"]);
        choice(r.status, ["pending", "approved", "rejected"]);
        optionalText(r.externalApprovalReference);
        if (r.status === "approved") text(r.externalApprovalReference);
        if (r.type === "transfer") {
          text(r.sourceProjectCode); text(r.destinationProjectCode);
          if (r.sourceProjectCode !== r.projectCode || r.destinationProjectCode === r.sourceProjectCode || r.destinationProjectCode !== r.destinationProjectCode.toUpperCase()) fail("invalid transfer endpoints");
        }
      } else {
        trace(r.traceability);
        if (r.reportFields !== undefined) {
          for (const values of Object.values(record(r.reportFields))) {
            if (!Array.isArray(values)) fail("invalid Sankhya report field");
            for (const value of values) text(value);
          }
        }
        if (key === "requisitions") {
          descriptiveText(r.objective);
          text(r.code); money(r.amount); optionalText(r.convertedOrderNumber);
          choice(r.approvalStatus, ["pending", "approved", "rejected"]);
          if (r.sankhya !== undefined) {
            const source = record(r.sankhya);
            if (typeof source.confirmed !== "boolean") fail("invalid SC confirmation");
            text(source.sourceFile); text(source.sourceSheet);
            if (!Number.isSafeInteger(source.sourceRow) || Number(source.sourceRow) < 4) fail("invalid SC source row");
            if (r.approvalStatus !== (source.confirmed ? "approved" : "pending")) fail("SC approval differs from confirmation");
          }
        } else if (key === "orders") {
          descriptiveText(r.objective); descriptiveText(r.supplier);
          text(r.number); optionalText(r.requisitionCode);
          money(r.openBalance);
          choice(r.status, ["open", "partially_invoiced", "fully_invoiced", "cancelled", "pending_delivery"]);
          if (r.sankhya !== undefined) {
            const source = record(r.sankhya);
            if (source.balanceField !== "Vlr Pend") fail("invalid order balance source");
            text(source.sourceFile); text(source.sourceSheet);
            if (source.internalOrderId !== undefined) text(source.internalOrderId);
            if (!Array.isArray(source.items) || !source.items.length) fail("missing order source items");
            let total = 0;
            for (const value of source.items) {
              const item = record(value);
              descriptiveText(item.product); descriptiveText(item.objective); money(item.openBalance);
              if (item.requisitionCode !== undefined) text(item.requisitionCode);
              if (!Number.isSafeInteger(item.sourceRow) || Number(item.sourceRow) < 4) fail("invalid order source row");
              total += Number(item.openBalance);
            }
            if (!Number.isSafeInteger(total) || total !== r.openBalance) fail("order items differ from open balance");
          }
          if (r.status === "pending_delivery") {
            if (r.totalAmount !== null || r.invoicedAmount !== null || r.sankhya === undefined) fail("pending-delivery orders require explicit source and unknown totals");
          } else {
            money(r.totalAmount); money(r.invoicedAmount);
            if (Number(r.invoicedAmount) > Number(r.totalAmount) || r.openBalance !== Number(r.totalAmount) - Number(r.invoicedAmount)) fail("inconsistent order balance");
          }
          if (r.status === "fully_invoiced" && r.openBalance !== 0) fail("fully invoiced order has open balance");
          if (r.status === "open" && r.invoicedAmount !== 0) fail("open order has invoices");
          if (r.status === "partially_invoiced" && !(Number(r.invoicedAmount) > 0 && Number(r.openBalance) > 0)) fail("invalid partial invoice");
        } else {
          descriptiveText(r.supplier);
          if (r.reviewUnavailable !== undefined && r.reviewUnavailable !== true) fail("invalid review availability");
          if (r.description !== undefined) descriptiveText(r.description);
          if (r.assetDescription !== undefined) descriptiveText(r.assetDescription);
          if (r.sankhya !== undefined) {
            const metadata = record(r.sankhya);
            for (const field of ["internalNoteId", "projectYear", "codproj", "adProjIhbl", "companyCode", "productCode", "partnerCode", "costCenterCode", "operationCode", "identification", "sourceFile", "sourceSheet"]) descriptiveText(metadata[field]);
            if (!Number.isSafeInteger(metadata.sourceRow) || Number(metadata.sourceRow) < 4) fail("invalid source row");
          }
          text(r.transactionId); text(r.fiscalDocument); text(r.documentEntryId);
          date(r.date); money(r.amount);
        }
      }
    }
  }
}

/** Non-mutating upgrade of legacy snapshots, before strict current-schema validation. */
export function parseFinanceData(value: unknown): FinanceData {
  const input = record(value);
  const upgrade = (collection: unknown, fields: string[]) => {
    if (!Array.isArray(collection)) fail("missing financial collection");
    return collection.map((item: unknown) => {
      const upgraded = { ...record(item) };
      for (const field of fields) {
        if (upgraded[field] === undefined) upgraded[field] = "";
      }
      return upgraded;
    });
  };
  const upgraded = {
    ...input,
    requisitions: upgrade(input.requisitions, ["objective"]),
    orders: upgrade(input.orders, ["objective", "supplier"]),
    actualCosts: upgrade(input.actualCosts, ["supplier"]),
  };
  validateFinanceData(upgraded);
  return upgraded;
}

/** Repeated identical records are idempotent; conflicting duplicates require reconciliation. */
export function uniqueRecords<T>(items: readonly T[], identities: (item: T) => string[]): T[] {
  const seen = new Map<string, string>();
  const result: T[] = [];
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return JSON.stringify(value.map(stable));
    if (value && typeof value === "object") return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
    return JSON.stringify(value);
  };
  for (const item of items) {
    const keys = identities(item);
    const serialized = stable(item);
    const duplicates = keys.filter((key) => seen.has(key));
    if (duplicates.some((key) => seen.get(key) !== serialized)) fail("conflicting duplicate; reconcile source records explicitly");
    if (!duplicates.length) result.push(item);
    for (const key of keys) seen.set(key, serialized);
  }
  return result;
}
