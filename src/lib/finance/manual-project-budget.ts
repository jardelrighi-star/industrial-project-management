import type { FinanceData } from "./types";
import type { Project } from "../projects/types";
import { prepareProject, validateProjects } from "../projects/validation";
import { normalizeFinanceData } from "./calculations";
import { parseBrlCents } from "./import-values";
import { LocalStorageProjectRepository } from "../projects/repository";
import { LocalStorageFinanceRepository } from "./repository";
import { withStorageWriteLock } from "../storage-write-lock";
import { compactFinanceStorage } from "./storage-codec";
import { commitCoordinatedStorage, recoverCoordinatedStorage, hasPendingStorageRecovery, readCoordinatedValue, PROJECT_KEY, FINANCE_KEY, type StoragePort } from "../coordinated-storage";
import { mutateOnlineStorage, readOnlineStorage } from "../online/client";
import { onlineMode } from "../online/state";

const browserStorage = () => window.localStorage;

export type ManualProjectSnapshot = { projects: Project[]; finance: FinanceData };
export type ManualBudgetRequest = { amount: string; correctionRequested: boolean; justification: string };
export type ManualProjectPlan = {
  baseline: ManualProjectSnapshot; form: Project; editingCode: string | null; request: ManualBudgetRequest;
  project: Project; projects: Project[]; finance: FinanceData;
  budgetChange: { before: number | null; after: number; justification: string } | null;
};

export function budgetInputValue(cents: number): string {
  const value = BigInt(cents);
  return `${value / BigInt(100)},${String(value % BigInt(100)).padStart(2, "0")}`;
}

/** Pure plan: no legacy fallback, no writes, no invented earlier history. */
export function planManualProjectSave(baseline: ManualProjectSnapshot, form: Project, editingCode: string | null, request: ManualBudgetRequest, recordedAt: string): ManualProjectPlan {
  validateProjects(baseline.projects);
  const finance = normalizeFinanceData(baseline.finance);
  const previous = baseline.projects.find((p) => p.code === editingCode);
  const project = prepareProject({ ...previous, ...form }, baseline.projects, editingCode);
  if (editingCode === null && [...finance.budgets, ...finance.adjustments, ...finance.requisitions, ...finance.orders, ...finance.actualCosts].some((entry) => entry.projectCode === project.code)) {
    throw new Error("Já existem vínculos financeiros para este código sem cadastro. Utilize a reconciliação; nenhum vínculo será substituído.");
  }
  const existing = finance.budgets.find((b) => b.projectCode === project.code);
  let budgetChange: ManualProjectPlan["budgetChange"] = null;
  if (request.correctionRequested || (!existing && request.amount.trim() !== "")) {
    if (request.correctionRequested && !existing) throw new Error("Não existe orçamento para corrigir. Reabra o formulário para cadastrar o valor inicial.");
    const after = parseBrlCents(request.amount);
    if (after < 0) throw new Error("O orçamento aprovado não pode ser negativo.");
    if (existing && after === existing.originalApprovedAmount) {
      const projects = baseline.projects.map((p) => p.code === editingCode ? project : p);
      return JSON.parse(JSON.stringify({ baseline, form, editingCode, request, project, projects, finance, budgetChange })) as ManualProjectPlan;
    }
    const justification = request.justification.trim() || (existing ? "Orçamento alterado no cadastro do projeto." : "Cadastro manual do orçamento original aprovado.");
    const before = existing?.originalApprovedAmount ?? null;
    if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("Data da correção inválida.");
    const budget = { ...existing, projectCode: project.code, originalApprovedAmount: after, updatedAmount: after,
      corrections: [...existing?.corrections ?? [], { previousAmount: before, newAmount: after, recordedAt, justification }],
    };
    if (existing) finance.budgets = finance.budgets.map((b) => b.projectCode === project.code ? budget : b);
    else finance.budgets = [...finance.budgets, budget];
    budgetChange = { before, after, justification };
  }
  const projects = editingCode === null ? [...baseline.projects, project] : baseline.projects.map((p) => p.code === editingCode ? project : p);
  return JSON.parse(JSON.stringify({ baseline, form, editingCode, request, project, projects, finance: normalizeFinanceData(finance), budgetChange })) as ManualProjectPlan;
}

/** Uses the same coordinated storage protocol as the application; the Excel importer is unchanged. */
export class ManualProjectBudgetRepository {
  constructor(private readonly storageProvider: () => StoragePort = browserStorage) {}

  async load(): Promise<ManualProjectSnapshot> {
    if (onlineMode && this.storageProvider === browserStorage) {
      const storage = await readOnlineStorage();
      return new ManualProjectBudgetRepository(() => storage).load();
    }
    const [projects, finance] = await Promise.all([
      new LocalStorageProjectRepository(this.storageProvider).load(),
      new LocalStorageFinanceRepository(this.storageProvider).load(),
    ]);
    return { projects: projects ?? [], finance };
  }

  pendingRecovery(): boolean { return !(onlineMode && this.storageProvider === browserStorage) && hasPendingStorageRecovery(this.storageProvider()); }
  async recover(): Promise<void> {
    if (onlineMode && this.storageProvider === browserStorage) return;
    await withStorageWriteLock(async () => recoverCoordinatedStorage(this.storageProvider()));
  }

  async save(plan: ManualProjectPlan, budgetConfirmed = false): Promise<{ project: Project; recoveryPending: boolean }> {
    if (onlineMode && this.storageProvider === browserStorage) {
      return mutateOnlineStorage((storage) => new ManualProjectBudgetRepository(() => storage).save(plan, budgetConfirmed));
    }
    return withStorageWriteLock(async () => {
      // Validate consent and all inputs before any recovery or write.
      const checked = planManualProjectSave(plan.baseline, plan.form, plan.editingCode, plan.request, new Date().toISOString());
      if (checked.budgetChange && !budgetConfirmed) throw new Error("Confirme explicitamente a gravação do orçamento após revisar os valores.");
      if (JSON.stringify(checked.budgetChange) !== JSON.stringify(plan.budgetChange)) throw new Error("A revisão do orçamento mudou. Revise novamente antes de confirmar.");
      const storage = this.storageProvider();
      recoverCoordinatedStorage(storage);
      const current = await this.load();
      if (JSON.stringify(current) !== JSON.stringify(checked.baseline)) throw new Error("Os dados mudaram em outra operação. Reabra o formulário e revise novamente; nenhuma alteração foi aplicada.");
      const cadastralChange = JSON.stringify(current.projects) !== JSON.stringify(checked.projects);
      let financial: string | null = null;
      if (checked.budgetChange) {
        const raw = readCoordinatedValue(storage, FINANCE_KEY);
        const envelope = raw === null ? { version: 1, data: current.finance } : JSON.parse(raw);
        const target = checked.finance.budgets.find((b) => b.projectCode === checked.project.code)!;
        const hasBudget = envelope.data.budgets.some((b: { projectCode: string }) => b.projectCode === checked.project.code);
        const budgets = hasBudget ? envelope.data.budgets.map((b: { projectCode: string }) => b.projectCode === checked.project.code ? target : b) : [...envelope.data.budgets, target];
        // Preserve every unrelated raw financial record and envelope extension.
        financial = JSON.stringify({ ...envelope, data: { ...envelope.data, budgets } });
      }
      if (cadastralChange && financial !== null) {
        return { project: checked.project, ...commitCoordinatedStorage(storage, JSON.stringify(checked.projects), financial) };
      }
      if (financial !== null) storage.setItem(FINANCE_KEY, compactFinanceStorage(financial));
      else if (cadastralChange) storage.setItem(PROJECT_KEY, JSON.stringify(checked.projects));
      return { project: checked.project, recoveryPending: false };
    });
  }
}
