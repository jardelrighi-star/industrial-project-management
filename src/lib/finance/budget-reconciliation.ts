import type { Project } from "../projects/types";
import type { ProjectRepository } from "../projects/repository";
import { validateProjects } from "../projects/validation";
import { normalizeFinanceData } from "./calculations";
import { parseBrlCents } from "./import-values";
import type { FinanceData, ProjectBudget } from "./types";
import type { LocalStorageFinanceRepository } from "./repository";

export type BudgetSituation = "legacy_only" | "financial_only" | "equal" | "divergent" | "no_budget" | "invalid_legacy";
export type BudgetDecision = "keep_financial" | "use_legacy" | "approve_zero";
export type BudgetRow = {
  projectCode: string; name: string; legacyCents: number | null; legacyValue: number | null;
  officialCents: number | null; situation: BudgetSituation; resolved: boolean; canMigrate: boolean;
};
export type BudgetPreview = { projects: Project[]; finance: FinanceData; rows: BudgetRow[] };
export type BudgetChoice = { projectCode: string; decision: BudgetDecision };
export type BudgetPlan = { preview: BudgetPreview; choices: BudgetChoice[]; changes: { projectCode: string; before: number | null; after: number; decision: BudgetDecision }[]; next: FinanceData };

/** No fallback: absence in finance is different from an explicitly approved zero. */
export function officialBudget(projectCode: string, finance: FinanceData): number | null {
  return finance.budgets.find((b) => b.projectCode === projectCode)?.originalApprovedAmount ?? null;
}

export function previewBudgetReconciliation(projects: Project[], input: FinanceData): BudgetPreview {
  validateProjects(projects);
  const finance = normalizeFinanceData(input);
  const codes = new Set([...projects.map((p) => p.code), ...finance.budgets.map((b) => b.projectCode)]);
  const rows = [...codes].map((projectCode): BudgetRow => {
    const project = projects.find((p) => p.code === projectCode);
    const budget = finance.budgets.find((b) => b.projectCode === projectCode);
    let legacyCents: number | null = null;
    if (project) {
      try {
        const cents = parseBrlCents(project.budget);
        if (cents >= 0 && cents / 100 === project.budget) legacyCents = cents;
      } catch { /* Invalid legacy monetary values remain untouched and visible. */ }
    }
    const officialCents = budget?.originalApprovedAmount ?? null;
    const situation: BudgetSituation = project && legacyCents === null ? "invalid_legacy"
      : legacyCents === null || legacyCents === 0 ? (budget ? "financial_only" : "no_budget")
      : !budget ? "legacy_only" : legacyCents === officialCents ? "equal" : "divergent";
    const audit = budget?.reconciliation;
    const resolved = !!audit && audit.legacyAmount === legacyCents && officialCents === (audit.decision === "keep_financial" ? audit.previousOriginalAmount : audit.legacyAmount);
    return { projectCode, name: project?.name ?? "Sem cadastro de projeto", legacyCents, legacyValue: project?.budget ?? null,
      officialCents, situation, resolved, canMigrate: !!project && legacyCents !== null && projectCode === projectCode.trim().toUpperCase() };
  });
  // Detached snapshots keep preview and confirmation independent from mutable UI state.
  return JSON.parse(JSON.stringify({ projects, finance, rows })) as BudgetPreview;
}

export function planBudgetReconciliation(preview: BudgetPreview, choices: readonly BudgetChoice[], confirmedAt: string): BudgetPlan {
  if (!choices.length) throw new Error("Escolha ao menos um projeto.");
  if (!Number.isFinite(Date.parse(confirmedAt))) throw new Error("Data de confirmação inválida.");
  const seen = new Set<string>();
  const budgets = preview.finance.budgets.map((b) => ({ ...b }));
  const changes = choices.map(({ projectCode, decision }) => {
    const row = preview.rows.find((r) => r.projectCode === projectCode);
    if (!row || seen.has(projectCode) || row.resolved) throw new Error("Decisão ausente, duplicada ou já conciliada.");
    seen.add(projectCode);
    const allowed = decision === "keep_financial" ? row.situation === "divergent"
      : decision === "use_legacy" ? row.situation === "legacy_only" || row.situation === "divergent"
      : decision === "approve_zero" && row.situation === "no_budget" && row.legacyCents === 0;
    if (!allowed || !row.canMigrate || row.legacyCents === null) throw new Error("Decisão incompatível com o projeto. Códigos e valores legados inválidos não são convertidos automaticamente.");
    const after = decision === "keep_financial" ? row.officialCents! : row.legacyCents;
    const reconciliation: NonNullable<ProjectBudget["reconciliation"]> = {
      legacyAmount: row.legacyCents, previousOriginalAmount: row.officialCents, decision, confirmedAt,
    };
    const existing = budgets.findIndex((b) => b.projectCode === projectCode);
    const next = { ...(existing >= 0 ? budgets[existing] : {}), projectCode, originalApprovedAmount: after, updatedAmount: after, reconciliation };
    if (existing >= 0) budgets[existing] = next; else budgets.push(next);
    return { projectCode, before: row.officialCents, after, decision };
  });
  return { preview, choices: [...choices], changes, next: normalizeFinanceData({ ...preview.finance, budgets }) };
}

export async function loadBudgetReconciliation(projects: ProjectRepository, finance: Pick<LocalStorageFinanceRepository, "load">): Promise<BudgetPreview> {
  const [portfolio, financial] = await Promise.all([projects.load(), finance.load()]);
  return previewBudgetReconciliation(portfolio ?? [], financial);
}

/** Only the financial key is written: no multi-key partial migration or rollback can overwrite later data. */
export async function confirmBudgetReconciliation(plan: BudgetPlan, projects: ProjectRepository, finance: Pick<LocalStorageFinanceRepository, "load" | "saveIfCurrent">): Promise<void> {
  const checked = planBudgetReconciliation(plan.preview, plan.choices, new Date().toISOString());
  await finance.saveIfCurrent(checked.next, plan.preview.finance, async () => {
    const current = await projects.load() ?? [];
    if (JSON.stringify(current) !== JSON.stringify(plan.preview.projects)) throw new Error("O cadastro mudou. Gere uma nova prévia.");
  });
}
