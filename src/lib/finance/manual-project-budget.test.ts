import { strict as assert } from "node:assert";
import { test } from "node:test";
import { budgetInputValue, ManualProjectBudgetRepository, planManualProjectSave } from "./manual-project-budget";
import { emptyFinanceData } from "./calculations";
import { FINANCE_KEY, PROJECT_KEY, TRANSACTION_KEY } from "../coordinated-storage";
import { LocalStorageProjectRepository } from "../projects/repository";
import { LocalStorageFinanceRepository } from "./repository";
import { confirmBudgetReconciliation, loadBudgetReconciliation, planBudgetReconciliation } from "./budget-reconciliation";
import type { Project } from "../projects/types";
import type { FinanceData } from "./types";

const time = "2026-11-15T12:00:00Z";
const project = (code = "P1", budget = 99): Project => ({ code, budget, name: "Projeto", unit: "", department: "", type: "", category: "", owner: "", manager: "", start: "", finish: "", priority: "", status: "Planejado", progress: 0 });
const initial = { amount: "123,45", correctionRequested: false, justification: "" };
const correction = { amount: "200,00", correctionRequested: true, justification: "Correção do valor digitado no cadastro original." };
function stores(projects: Project[] = [project()], finance: FinanceData = emptyFinanceData()) {
  const entries = new Map<string, string>([[PROJECT_KEY, JSON.stringify(projects)], [FINANCE_KEY, JSON.stringify({ version: 1, metadata: "preserved", data: finance })]]);
  const writes: string[] = [];
  let fail: string | null = null;
  const port = () => ({
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { if (key === fail) throw new Error("Quota exceeded"); writes.push(key); entries.set(key, value); },
  });
  return { entries, writes, manual: new ManualProjectBudgetRepository(port), projects: new LocalStorageProjectRepository(port), finance: new LocalStorageFinanceRepository(port), fail: (key: string | null) => { fail = key; } };
}
const financed = () => ({ ...emptyFinanceData(), budgets: [{ projectCode: "P1", originalApprovedAmount: 10000, updatedAmount: 10000 }] });

test("initial approved budget is planned independently of legacy value and requires explicit confirmation", async () => {
  const s = stores();
  const baseline = await s.manual.load();
  const plan = planManualProjectSave(baseline, baseline.projects[0], "P1", initial, time);
  assert.deepEqual(plan.budgetChange, { before: null, after: 12345, justification: "Cadastro manual do orçamento original aprovado." });
  assert.deepEqual(s.writes, []);
  await assert.rejects(s.manual.save(plan), /Confirme explicitamente/);
  assert.deepEqual(s.writes, []);
  const rawProjects = s.entries.get(PROJECT_KEY);
  await s.manual.save(plan, true);
  assert.deepEqual(s.writes, [FINANCE_KEY]);
  assert.equal(s.entries.get(PROJECT_KEY), rawProjects);
  const budget = (await s.finance.load()).budgets[0];
  assert.equal(budget.originalApprovedAmount, 12345);
  assert.equal(budget.corrections?.[0].previousAmount, null);
  assert.equal(budget.corrections?.[0].newAmount, 12345);
  assert.ok(Number.isFinite(Date.parse(budget.corrections![0].recordedAt)));
});

test("new project and approved budget are saved together with a zero legacy marker", async () => {
  const s = stores([]);
  const plan = planManualProjectSave(await s.manual.load(), project("NEW", 0), null, initial, time);
  await s.manual.save(plan, true);
  assert.equal((await s.projects.load())![0].code, "NEW");
  assert.equal((await s.projects.load())![0].budget, 0);
  assert.equal((await s.finance.load()).budgets[0].originalApprovedAmount, 12345);
  assert.equal(s.manual.pendingRecovery(), false);
});

test("editing budget accepts an optional note and unchanged amounts do not add history", async () => {
  const s = stores([project()], financed());
  const baseline = await s.manual.load();
  const unchanged = planManualProjectSave(baseline, baseline.projects[0], "P1", initial, time);
  assert.equal(unchanged.budgetChange, null);
  assert.equal(unchanged.finance.budgets[0].originalApprovedAmount, 10000);
  const withoutNote = planManualProjectSave(baseline, baseline.projects[0], "P1", { ...correction, justification: " " }, time);
  assert.equal(withoutNote.budgetChange?.justification, "Orçamento alterado no cadastro do projeto.");
  const sameValue = planManualProjectSave(baseline, { ...baseline.projects[0], name: "Nome editado" }, "P1", { ...correction, amount: "100,00" }, time);
  assert.equal(sameValue.budgetChange, null);
  assert.equal(sameValue.project.name, "Nome editado");
  assert.equal(sameValue.finance.budgets[0].corrections?.length ?? 0, 0);
  const plan = planManualProjectSave(baseline, baseline.projects[0], "P1", correction, time);
  await assert.rejects(s.manual.save(plan, false), /Confirme/);
  assert.equal((await s.finance.load()).budgets[0].originalApprovedAmount, 10000);
  assert.deepEqual(s.writes, []);
});

test("multiple corrections append previous/new values, timestamps and reasons without replacing history", async () => {
  const s = stores([project()], financed());
  for (const amount of ["200,00", "150,00"]) {
    const baseline = await s.manual.load();
    await s.manual.save(planManualProjectSave(baseline, baseline.projects[0], "P1", { ...correction, amount }, time), true);
  }
  const budget = (await s.finance.load()).budgets[0];
  assert.equal(budget.originalApprovedAmount, 15000);
  assert.deepEqual(budget.corrections?.map((c) => [c.previousAmount, c.newAmount, c.justification]), [[10000, 20000, correction.justification], [20000, 15000, correction.justification]]);
  assert.equal((await s.projects.load())![0].budget, 99);
});

test("correction recalculates updated amount and retains raw adjustments, costs, SCs, orders and envelope", async () => {
  const data: FinanceData = financed();
  const traceability = { sourceSystem: "test", sourceRecordId: "TX", recordedAt: time, externalReference: null };
  data.adjustments = [{ id: "A1", projectCode: "P1", amount: 5000, type: "increase", status: "approved", externalApprovalReference: "REF", date: "2026-01-01", justification: "Ampliação" }];
  data.requisitions = [{ projectCode: "P1", code: "SC", objective: "", amount: 100, approvalStatus: "pending", convertedOrderNumber: null, traceability: { ...traceability, sourceRecordId: "SC" } }];
  data.orders = [{ projectCode: "P1", number: "PO", objective: "", supplier: "", totalAmount: 500, invoicedAmount: 0, openBalance: 500, requisitionCode: null, status: "open", traceability: { ...traceability, sourceRecordId: "PO" } }];
  data.actualCosts = [{ projectCode: "P1", transactionId: "TX", supplier: "", fiscalDocument: "NF", documentEntryId: "ITEM", amount: 200, date: "2026-01-01", traceability }];
  const s = stores([project()], data);
  const baseline = await s.manual.load();
  const plan = planManualProjectSave(baseline, { ...baseline.projects[0], name: "Nome corrigido" }, "P1", correction, time);
  assert.equal(plan.finance.budgets[0].updatedAmount, 25000);
  await s.manual.save(plan, true);
  const raw = JSON.parse(s.entries.get(FINANCE_KEY)!);
  assert.equal(raw.metadata, "preserved");
  for (const field of ["adjustments", "requisitions", "orders", "actualCosts"] as const) assert.deepEqual(raw.data[field], data[field]);
  assert.equal((await s.projects.load())![0].name, "Nome corrigido");
  assert.equal((await s.projects.load())![0].budget, 99);
});

test("blank initial amount does not infer approval from legacy; an explicit zero can be registered", async () => {
  const s = stores();
  const baseline = await s.manual.load();
  const blank = planManualProjectSave(baseline, baseline.projects[0], "P1", { ...initial, amount: "" }, time);
  assert.equal(blank.budgetChange, null);
  await s.manual.save(blank);
  assert.deepEqual(s.writes, []);
  const zero = planManualProjectSave(baseline, baseline.projects[0], "P1", { ...initial, amount: "0" }, time);
  await s.manual.save(zero, true);
  assert.equal((await s.finance.load()).budgets[0].originalApprovedAmount, 0);
});

test("bad amounts, altered legacy values and existing orphan financial identities are rejected", async () => {
  const s = stores();
  const baseline = await s.manual.load();
  for (const amount of ["-1", "abc", "900719925474099999999999"]) assert.throws(() => planManualProjectSave(baseline, baseline.projects[0], "P1", { ...initial, amount }, time));
  assert.throws(() => planManualProjectSave(baseline, { ...baseline.projects[0], budget: 500 }, "P1", initial, time), /somente leitura/);
  const orphan = stores([], financed());
  assert.throws(() => planManualProjectSave({ projects: [], finance: financed() }, project("P1", 0), null, initial, time), /vínculos financeiros/);
  assert.deepEqual(orphan.writes, []);
});

test("old v1 budgets remain unchanged when read and acquire no fabricated correction history", async () => {
  const s = stores([project()], financed());
  const before = [...s.entries];
  const loaded = await s.manual.load();
  assert.equal(loaded.finance.budgets[0].corrections, undefined);
  assert.deepEqual([...s.entries], before);
  assert.deepEqual(s.writes, []);
});

test("a budget-only write failure does not touch the project or create history", async () => {
  const s = stores([project()], financed());
  const baseline = await s.manual.load();
  const plan = planManualProjectSave(baseline, baseline.projects[0], "P1", correction, time);
  const before = [...s.entries];
  s.fail(FINANCE_KEY);
  await assert.rejects(s.manual.save(plan, true), /Quota/);
  assert.deepEqual([...s.entries], before);
  assert.equal((await s.finance.load()).budgets[0].corrections, undefined);
});

test("combined cadastral/budget failure before commit preserves both previous snapshots", async () => {
  const s = stores([project()], financed());
  const baseline = await s.manual.load();
  const plan = planManualProjectSave(baseline, { ...baseline.projects[0], name: "Unsaved name" }, "P1", correction, time);
  const before = [...s.entries];
  s.fail(TRANSACTION_KEY);
  await assert.rejects(s.manual.save(plan, true));
  assert.deepEqual([...s.entries], before);
});

for (const key of [PROJECT_KEY, FINANCE_KEY]) {
  test(`failure synchronizing ${key} exposes both committed changes together and recovers one history entry`, async () => {
    const s = stores([project()], financed());
    const baseline = await s.manual.load();
    const plan = planManualProjectSave(baseline, { ...baseline.projects[0], name: "Saved name" }, "P1", correction, time);
    s.fail(key);
    const result = await s.manual.save(plan, true);
    assert.equal(result.recoveryPending, true);
    assert.equal((await s.projects.load())![0].name, "Saved name");
    assert.equal((await s.finance.load()).budgets[0].originalApprovedAmount, 20000);
    s.fail(null);
    await s.manual.recover();
    await s.manual.recover();
    assert.equal((await s.finance.load()).budgets[0].corrections?.length, 1);
    await assert.rejects(s.manual.save(plan, true), /dados mudaram/);
    assert.equal((await s.finance.load()).budgets[0].corrections?.length, 1);
  });
}

test("financial and cadastral conflicts between tabs abort without overwriting intervening changes", async () => {
  for (const key of [PROJECT_KEY, FINANCE_KEY]) {
    const s = stores([project()], financed());
    const baseline = await s.manual.load();
    const plan = planManualProjectSave(baseline, { ...baseline.projects[0], name: "Stale name" }, "P1", correction, time);
    s.entries.set(key, key === PROJECT_KEY ? JSON.stringify([{ ...project(), name: "Other tab" }]) : JSON.stringify({ version: 1, data: { ...financed(), budgets: [{ projectCode: "P1", originalApprovedAmount: 30000, updatedAmount: 30000 }] } }));
    const before = [...s.entries];
    await assert.rejects(s.manual.save(plan, true), /dados mudaram/);
    assert.deepEqual([...s.entries], before);
    assert.deepEqual(s.writes, []);
  }
});

test("reconciliation is preserved and retains manual correction history", async () => {
  const s = stores([project()], financed());
  const baseline = await s.manual.load();
  await s.manual.save(planManualProjectSave(baseline, baseline.projects[0], "P1", correction, time), true);
  const history = (await s.finance.load()).budgets[0].corrections;
  const preview = await loadBudgetReconciliation(s.projects, s.finance);
  await confirmBudgetReconciliation(planBudgetReconciliation(preview, [{ projectCode: "P1", decision: "use_legacy" }], time), s.projects, s.finance);
  assert.deepEqual((await s.finance.load()).budgets[0].corrections, history);
  assert.equal((await s.finance.load()).budgets[0].originalApprovedAmount, 9900);
});

test("invalid persisted history is rejected without rewriting v1 records", async () => {
  const data = { ...financed(), budgets: [{ ...financed().budgets[0], corrections: [{ previousAmount: 10000, newAmount: 20000, recordedAt: "invalid-date", justification: "" }] }] };
  const s = stores([project()], data);
  const before = [...s.entries];
  await assert.rejects(s.manual.load());
  assert.deepEqual([...s.entries], before);
});

test("amount input conversion preserves every cent even at the safe integer limit", () => {
  assert.equal(budgetInputValue(0), "0,00");
  assert.equal(budgetInputValue(10001), "100,01");
  assert.equal(budgetInputValue(Number.MAX_SAFE_INTEGER), "90071992547409,91");
});
