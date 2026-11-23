import { FINANCE_KEY, PROJECT_KEY } from "../coordinated-storage";
import { actualCostReviewIdentity, indexActualCostReviews, reconcileActualCostReviews, recordActualCostReviews, type ActualCostReviewTarget } from "../finance/actual-cost-review";
import { emptyFinanceData } from "../finance/calculations";
import { LocalStorageFinanceRepository } from "../finance/repository";
import { loadScOrderForecasts, saveScOrderForecast, SC_ORDER_FORECAST_KEY, scsAwaitingOrders } from "../finance/sc-order-forecast";
import { loadScContracts, saveScContract, SC_CONTRACT_KEY } from "../finance/sc-contract";
import { compactFinanceStorage } from "../finance/storage-codec";
import type { ActualCostReview, BudgetAdjustment } from "../finance/types";
import { LocalStoragePortfolioModelRepository, PORTFOLIO_MODELS_KEY } from "../projects/portfolio-model-repository";
import { addPlannedPurchase, addProcurementType, deletePlannedPurchase, loadProcurementPlan, PROCUREMENT_PLAN_KEY, updatePlannedPurchase } from "../projects/procurement-plan";
import { LocalStorageProjectRepository } from "../projects/repository";
import { OnlineError, type Member } from "./server";
import { canScheduleContracts, canScheduleOrders, memoryStorage, type WorkspacePayload, type WorkspaceState } from "./state";

const editableKeys = new Set([PROJECT_KEY, FINANCE_KEY, PORTFOLIO_MODELS_KEY]);
const allKeys = [PROJECT_KEY, FINANCE_KEY, PORTFOLIO_MODELS_KEY, PROCUREMENT_PLAN_KEY, SC_ORDER_FORECAST_KEY, SC_CONTRACT_KEY];

export function hasProjectAccess(member: Member, projectCode: string) {
  return member.role === "admin" || member.projectCodes.includes(projectCode);
}

function financeStorage(finance: Awaited<ReturnType<LocalStorageFinanceRepository["load"]>>) {
  return compactFinanceStorage(JSON.stringify({ version: 1, data: finance }));
}

function scopedAdjustment(adjustment: BudgetAdjustment, allowed: (projectCode: string) => boolean): BudgetAdjustment[] {
  if (adjustment.type !== "transfer") return allowed(adjustment.projectCode) ? [adjustment] : [];
  const { sourceProjectCode, destinationProjectCode, ...fields } = adjustment;
  const source = allowed(sourceProjectCode), destination = allowed(destinationProjectCode);
  if (source && destination) return [adjustment];
  if (!source && !destination) return [];
  // Project views retain their transfer impact without exposing the other project's code.
  return [{ ...fields, type: source ? "reduction" : "increase", projectCode: source ? sourceProjectCode : destinationProjectCode }];
}

function reviewAllowed(member: Member, review: ActualCostReview | undefined) {
  return !review || review.events.every((event) => hasProjectAccess(member, event.cost.projectCode));
}

export async function scopeWorkspace(member: Member, state: WorkspaceState): Promise<WorkspaceState> {
  const payload = Object.fromEntries(allKeys.filter((key) => Object.hasOwn(state.payload, key)).map((key) => [key, state.payload[key]]));
  if (member.role === "admin") return { ...state, payload };
  const storage = memoryStorage(payload);
  const [projects, finance] = await Promise.all([
    new LocalStorageProjectRepository(() => storage).load(),
    new LocalStorageFinanceRepository(() => storage).load(),
  ]);
  const allowed = (code: string) => hasProjectAccess(member, code);
  const reviewIndex = indexActualCostReviews(finance);
  const actualCosts = finance.actualCosts.filter((row) => allowed(row.projectCode)).map((row) => {
    const identity = actualCostReviewIdentity(row);
    const selected = reviewIndex.identityByCost.get(row);
    const crossesProjects = identity && reviewIndex.costs.get(identity)?.some((cost) => !allowed(cost.projectCode));
    const hiddenHistory = selected && !reviewAllowed(member, reviewIndex.reviews.get(selected));
    return crossesProjects || hiddenHistory ? { ...row, reviewUnavailable: true as const } : row;
  });
  const procurement = loadProcurementPlan(storage);
  return { version: state.version, payload: {
    [PROJECT_KEY]: JSON.stringify((projects ?? []).filter((row) => allowed(row.code))),
    [FINANCE_KEY]: financeStorage({
      budgets: finance.budgets.filter((row) => allowed(row.projectCode)),
      adjustments: finance.adjustments.flatMap((row) => scopedAdjustment(row, allowed)),
      requisitions: finance.requisitions.filter((row) => allowed(row.projectCode)),
      orders: finance.orders.filter((row) => allowed(row.projectCode)),
      actualCosts,
      actualCostReviews: finance.actualCostReviews?.filter((review) =>
        reviewAllowed(member, review) && (reviewIndex.costs.get(review.identity) ?? []).every((row) => allowed(row.projectCode))),
    }),
    [PROCUREMENT_PLAN_KEY]: JSON.stringify({ ...procurement, purchases: procurement.purchases.filter((row) => allowed(row.projectCode)) }),
    [SC_ORDER_FORECAST_KEY]: JSON.stringify(loadScOrderForecasts(storage).filter((row) => allowed(row.projectCode))),
    [SC_CONTRACT_KEY]: JSON.stringify(loadScContracts(storage).filter((row) => allowed(row.projectCode))),
  } };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OnlineError(400, "Dados inválidos.");
  return value as Record<string, unknown>;
}

function string(value: unknown, max = 4000): string {
  if (typeof value !== "string" || value.length > max) throw new OnlineError(400, "Campo inválido.");
  return value;
}

export function resetWorkspaceData(member: Member, state: WorkspaceState, version: unknown): WorkspacePayload {
  if (member.role !== "admin") throw new OnlineError(403, "Apenas administradores podem limpar os dados da carteira.");
  if (version !== state.version) throw new OnlineError(409, "A carteira mudou. Confira os dados e inicie a limpeza novamente.");
  const procurement = loadProcurementPlan(memoryStorage(state.payload));
  return {
    ...state.payload,
    [PROJECT_KEY]: JSON.stringify([]),
    [FINANCE_KEY]: financeStorage(emptyFinanceData()),
    [PROCUREMENT_PLAN_KEY]: JSON.stringify({ types: procurement.types, purchases: [] }),
    [SC_ORDER_FORECAST_KEY]: JSON.stringify([]),
    [SC_CONTRACT_KEY]: JSON.stringify([]),
  };
}

export async function replaceWorkspace(member: Member, state: WorkspaceState, input: Record<string, unknown>) {
  if (member.role !== "admin") throw new OnlineError(403, "Apenas administradores podem alterar a carteira ou importar dados.");
  if (input.version !== state.version) throw new OnlineError(409, "A base foi atualizada por outro usuário. Gere uma nova prévia.");
  const changes = record(input.changes);
  const entries = Object.entries(changes);
  if (!entries.length) throw new OnlineError(400, "Nenhuma coleção para atualizar.");
  const payload = { ...state.payload };
  for (const [key, value] of entries) {
    if (!editableKeys.has(key) || typeof value !== "string") throw new OnlineError(400, "Coleção inválida para esta operação.");
    payload[key] = value;
  }
  const storage = memoryStorage(payload);
  await new LocalStorageProjectRepository(() => storage).load();
  await new LocalStoragePortfolioModelRepository(() => storage).load();
  const nextFinance = await new LocalStorageFinanceRepository(() => storage).load();
  if (Object.hasOwn(changes, FINANCE_KEY)) {
    const previous = await new LocalStorageFinanceRepository(() => memoryStorage(state.payload)).load();
    // Review authorship and events may be changed only by the dedicated review operation.
    nextFinance.actualCostReviews = previous.actualCostReviews;
    payload[FINANCE_KEY] = financeStorage(reconcileActualCostReviews(nextFinance));
  }
  return payload;
}

export async function changeProcurement(member: Member, payload: WorkspacePayload, input: Record<string, unknown>) {
  if (member.role !== "admin" && member.role !== "manager") throw new OnlineError(403, "Sua conta tem acesso de consulta ao plano de aquisições.");
  const storage = memoryStorage(payload);
  const projectCode = string(input.projectCode, 150);
  if (!hasProjectAccess(member, projectCode)) throw new OnlineError(403, "Sua conta não tem acesso a este projeto.");
  const projects = await new LocalStorageProjectRepository(() => storage).load();
  if (!projects?.some((project) => project.code === projectCode)) throw new OnlineError(404, "Projeto não encontrado.");
  if (input.operation === "addType") {
    const { type } = await addProcurementType(string(input.name, 200), storage);
    return { type };
  }
  if (input.operation === "delete") {
    await deletePlannedPurchase(projectCode, string(input.id, 150), storage);
    return {};
  }
  if (input.operation !== "create" && input.operation !== "update") throw new OnlineError(400, "Operação de aquisição inválida.");
  const fields = record(input.draft);
  const draft = {
    title: string(fields.title, 120), description: string(fields.description, 20000), type: string(fields.type, 200),
    estimatedAmount: string(fields.estimatedAmount, 100),
    scNumber: fields.scNumber === undefined ? undefined : string(fields.scNumber, 200),
    scOpeningForecast: fields.scOpeningForecast === undefined ? undefined : string(fields.scOpeningForecast, 10),
    orderNumber: fields.orderNumber === undefined ? undefined : string(fields.orderNumber, 200),
  };
  if (input.operation === "create") await addPlannedPurchase(projectCode, draft, storage);
  else await updatePlannedPurchase(projectCode, string(input.id, 150), draft, storage);
  return {};
}

export async function changeScOrderForecast(member: Member, payload: WorkspacePayload, input: Record<string, unknown>) {
  if (!canScheduleOrders(member.role)) throw new OnlineError(403, "Apenas Compras e administradores podem informar a previsão do pedido.");
  const projectCode = string(input.projectCode, 150);
  if (!hasProjectAccess(member, projectCode)) throw new OnlineError(403, "Sua conta não tem acesso a este projeto.");
  const scNumber = string(input.scNumber, 200);
  const storage = memoryStorage(payload);
  const projects = await new LocalStorageProjectRepository(() => storage).load();
  if (!projects?.some((project) => project.code === projectCode)) throw new OnlineError(404, "Projeto não encontrado.");
  const finance = await new LocalStorageFinanceRepository(() => storage).load();
  if (!scsAwaitingOrders(finance).some((sc) => sc.projectCode === projectCode && sc.code === scNumber)) {
    throw new OnlineError(409, "A SC não está mais na lista de solicitações sem pedido.");
  }
  await saveScOrderForecast({
    projectCode, scNumber,
    forecastDate: string(input.forecastDate, 10),
    expectedDate: input.expectedDate === null ? null : string(input.expectedDate, 10),
  }, storage);
}

export async function changeScContract(member: Member, payload: WorkspacePayload, input: Record<string, unknown>) {
  const operation = input.operation;
  if (operation !== "requirement" && operation !== "completion") throw new OnlineError(400, "Operação de contrato inválida.");
  if (operation === "requirement" ? !canScheduleOrders(member.role) : !canScheduleContracts(member.role)) {
    throw new OnlineError(403, "Sua função não permite alterar este campo do contrato.");
  }
  const projectCode = string(input.projectCode, 150);
  if (!hasProjectAccess(member, projectCode)) throw new OnlineError(403, "Sua conta não tem acesso a este projeto.");
  const scNumber = string(input.scNumber, 200);
  const storage = memoryStorage(payload);
  const projects = await new LocalStorageProjectRepository(() => storage).load();
  if (!projects?.some((project) => project.code === projectCode)) throw new OnlineError(404, "Projeto não encontrado.");
  if (operation === "requirement") {
    const finance = await new LocalStorageFinanceRepository(() => storage).load();
    if (!scsAwaitingOrders(finance).some((sc) => sc.projectCode === projectCode && sc.code === scNumber)) {
      throw new OnlineError(409, "A SC não está mais na lista de solicitações sem pedido.");
    }
    if (typeof input.required !== "boolean" || (input.expectedRequired !== null && typeof input.expectedRequired !== "boolean")) {
      throw new OnlineError(400, "Selecione Sim ou Não para a necessidade de contrato.");
    }
    await saveScContract({ operation, projectCode, scNumber, required: input.required, expectedRequired: input.expectedRequired }, storage);
  } else {
    await saveScContract({
      operation, projectCode, scNumber, completionDate: string(input.completionDate, 10),
      expectedDate: input.expectedDate === null ? null : string(input.expectedDate, 10),
    }, storage);
  }
}

export async function changeReviews(member: Member, payload: WorkspacePayload, input: Record<string, unknown>) {
  const action = input.decision;
  const managerAction = action === "recognized" || action === "rejected";
  const analystAction = action === "analyst_validated" || action === "analyst_rejected";
  if (!managerAction && !analystAction) throw new OnlineError(400, "Decisão inválida.");
  if (member.role !== "admin" && (managerAction ? member.role !== "manager" : member.role !== "analyst")) {
    throw new OnlineError(403, "Sua função não permite registrar esta decisão.");
  }
  if (!Array.isArray(input.targets) || !input.targets.length) throw new OnlineError(400, "Selecione pelo menos um lançamento.");
  const targets: ActualCostReviewTarget[] = input.targets.map((value) => {
    const target = record(value);
    const expectedEvents = target.expectedEvents;
    if (typeof expectedEvents !== "number" || !Number.isSafeInteger(expectedEvents) || expectedEvents < 0) throw new OnlineError(400, "Histórico inválido.");
    return {
      identity: string(target.identity, 16000), expectedEvents,
      expectedRevision: target.expectedRevision === null ? null : string(target.expectedRevision, 16000),
    };
  });
  const storage = memoryStorage(payload);
  const repository = new LocalStorageFinanceRepository(() => storage);
  const finance = await repository.load();
  const index = indexActualCostReviews(finance);
  for (const target of targets) {
    const costs = index.costs.get(target.identity) ?? [];
    const review = index.reviews.get(target.identity);
    if ((!review && !costs.length) || !reviewAllowed(member, review) || costs.some((cost) => !hasProjectAccess(member, cost.projectCode))) {
      throw new OnlineError(403, "Sua conta não tem acesso ao lançamento selecionado.");
    }
    if (!review && costs.length === 1 && index.identityByCost.get(costs[0]) !== target.identity) {
      throw new OnlineError(409, "A identificação do lançamento mudou. Atualize a tela.");
    }
  }
  await recordActualCostReviews(repository, targets, { action, actor: member.email, actorId: member.userId, note: string(input.note, 2000) });
}
