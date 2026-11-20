import type { FinanceData } from "../finance/types";
import { LocalStorageFinanceRepository } from "../finance/repository";
import { FINANCE_KEY } from "../coordinated-storage";
import type { ActualCostReviewTarget } from "../finance/actual-cost-review";
import type { ActualCostReviewAction } from "../finance/types";
import { loadProcurementPlan } from "../projects/procurement-plan";
import { memoryStorage, type WorkspacePayload } from "./state";
import { onlinePost, readOnlineStorage } from "./client";

export async function loadOnlineProcurement() {
  return loadProcurementPlan(await readOnlineStorage());
}

export async function changeOnlineProcurement(projectCode: string, operation: "addType" | "create" | "update" | "delete", fields: Record<string, unknown>) {
  const result = await onlinePost<{ payload: WorkspacePayload; type?: string }>("/api/workspace", { ...fields, projectCode, action: "procurement", operation });
  return { plan: loadProcurementPlan(memoryStorage(result.payload)), type: result.type };
}

export async function recordOnlineCostReviews(targets: readonly ActualCostReviewTarget[], decision: ActualCostReviewAction, note: string): Promise<FinanceData> {
  const { payload } = await onlinePost<{ payload: WorkspacePayload }>("/api/workspace", { action: "review", targets, decision, note });
  if (typeof payload[FINANCE_KEY] !== "string") throw new Error("O servidor não retornou a atualização financeira.");
  return new LocalStorageFinanceRepository(() => memoryStorage(payload)).load();
}
