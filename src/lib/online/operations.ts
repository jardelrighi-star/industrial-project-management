import type { FinanceData } from "../finance/types";
import { LocalStorageFinanceRepository } from "../finance/repository";
import { loadScOrderForecasts, saveScOrderForecast } from "../finance/sc-order-forecast";
import { loadScContracts, type ScContractChange } from "../finance/sc-contract";
import { FINANCE_KEY } from "../coordinated-storage";
import type { ActualCostReviewTarget } from "../finance/actual-cost-review";
import type { ActualCostReviewAction } from "../finance/types";
import { loadProcurementPlan } from "../projects/procurement-plan";
import { memoryStorage, type WorkspacePayload } from "./state";
import { onlinePost } from "./client";

export async function saveOnlineScOrderForecast(request: Parameters<typeof saveScOrderForecast>[0]) {
  const { payload } = await onlinePost<{ payload: WorkspacePayload }>("/api/workspace", { ...request, action: "scOrderForecast" });
  return loadScOrderForecasts(memoryStorage(payload));
}

export async function saveOnlineScContract(request: ScContractChange) {
  const { payload } = await onlinePost<{ payload: WorkspacePayload }>("/api/workspace", { ...request, action: "scContract" });
  return loadScContracts(memoryStorage(payload));
}

export async function changeOnlineProcurement(projectCode: string, operation: "addType" | "create" | "update" | "delete" | "reconstruct", fields: Record<string, unknown>) {
  const result = await onlinePost<{ payload: WorkspacePayload; type?: string }>("/api/workspace", { ...fields, projectCode, action: "procurement", operation });
  return { plan: loadProcurementPlan(memoryStorage(result.payload)), type: result.type };
}

export async function recordOnlineCostReviews(targets: readonly ActualCostReviewTarget[], decision: ActualCostReviewAction, note: string): Promise<FinanceData> {
  const { payload } = await onlinePost<{ payload: WorkspacePayload }>("/api/workspace", { action: "review", targets, decision, note });
  if (typeof payload[FINANCE_KEY] !== "string") throw new Error("O servidor não retornou a atualização financeira.");
  return new LocalStorageFinanceRepository(() => memoryStorage(payload)).load();
}
