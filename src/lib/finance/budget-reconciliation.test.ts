import { strict as assert } from "node:assert";
import { test } from "node:test";
import { previewBudgetReconciliation, planBudgetReconciliation, loadBudgetReconciliation, confirmBudgetReconciliation, officialBudget } from "./budget-reconciliation";
import { emptyFinanceData, normalizeFinanceData } from "./calculations";
import { LocalStorageFinanceRepository, FINANCE_STORAGE_KEY } from "./repository";
import { LocalStorageProjectRepository, PROJECTS_STORAGE_KEY } from "../projects/repository";
import { prepareProject } from "../projects/validation";
import type { Project } from "../projects/types";
import type { FinanceData } from "./types";

const project = (code: string, budget: number): Project => ({ code, budget, name: code, unit: "", department: "", type: "CAPEX", category: "", owner: "", manager: "", start: "", finish: "", priority: "", status: "Planejado", progress: 0 });
const time = "2026-11-15T12:00:00Z";
function stores(projects: Project[] = [], finance: FinanceData = emptyFinanceData()) {
  const entries = new Map<string, string>([[PROJECTS_STORAGE_KEY, JSON.stringify(projects)], [FINANCE_STORAGE_KEY, JSON.stringify({ version: 1, data: finance })]]);
  const writes: string[] = [];
  let fail = false;
  let failRead = false;
  const port = () => ({
    getItem: (key: string) => { if (failRead) throw new Error("Read denied"); return entries.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (fail) throw new Error("Quota exceeded"); writes.push(key); entries.set(key, value); },
  });
  return { entries, writes, projects: new LocalStorageProjectRepository(port), finance: new LocalStorageFinanceRepository(port),
    fail: (value: boolean) => { fail = value; }, failRead: (value: boolean) => { failRead = value; } };
}

test("preview classifies all sources, does not approve legacy zero or mutate either snapshot", () => {
  const projects = [project("LEGACY", 12.34), project("EQUAL", 10), project("DIFF", 20), project("ZERO", 0), project("INVALID", 1.005)];
  const finance = emptyFinanceData();
  finance.budgets = ["EQUAL", "DIFF", "FINANCE"].map((projectCode) => ({ projectCode, originalApprovedAmount: 1000, updatedAmount: 1000 }));
  const before = JSON.stringify({ projects, finance });
  const preview = previewBudgetReconciliation(projects, finance);
  assert.deepEqual(preview.rows.map((r) => [r.projectCode, r.situation]), [["LEGACY", "legacy_only"], ["EQUAL", "equal"], ["DIFF", "divergent"], ["ZERO", "no_budget"], ["INVALID", "invalid_legacy"], ["FINANCE", "financial_only"]]);
  assert.equal(officialBudget("LEGACY", finance), null);
  assert.equal(officialBudget("ZERO", finance), null);
  assert.equal(JSON.stringify({ projects, finance }), before);
});

test("preview reads persisted sources without any writes or automatic migration", async () => {
  const s = stores([project("P1", 100)]);
  const before = [...s.entries];
  const preview = await loadBudgetReconciliation(s.projects, s.finance);
  assert.equal(preview.rows[0].situation, "legacy_only");
  assert.deepEqual([...s.entries], before);
  assert.deepEqual(s.writes, []);
});

test("confirmed legacy migration writes only finance and preserves raw legacy plus financial links", async () => {
  const data = emptyFinanceData();
  data.actualCosts = [{ transactionId: "tx", projectCode: "P1", supplier: "Fornecedor", fiscalDocument: "NF", documentEntryId: "item", date: "2026-01-01", amount: 100, traceability: { sourceSystem: "test", sourceRecordId: "tx", recordedAt: time, externalReference: null } }];
  const s = stores([project("P1", 123.45)], data);
  const raw = s.entries.get(PROJECTS_STORAGE_KEY);
  const preview = await loadBudgetReconciliation(s.projects, s.finance);
  const plan = planBudgetReconciliation(preview, [{ projectCode: "P1", decision: "use_legacy" }], time);
  assert.deepEqual(s.writes, []);
  await confirmBudgetReconciliation(plan, s.projects, s.finance);
  assert.deepEqual(s.writes, [FINANCE_STORAGE_KEY]);
  assert.equal(s.entries.get(PROJECTS_STORAGE_KEY), raw);
  const loaded = await s.finance.load();
  assert.equal(loaded.budgets[0].originalApprovedAmount, 12345);
  assert.deepEqual(loaded.actualCosts, data.actualCosts);
  assert.equal((await loadBudgetReconciliation(s.projects, s.finance)).rows[0].resolved, true);
});

test("divergences require explicit per-project decisions and retain original amounts in audit", async () => {
  for (const decision of ["keep_financial", "use_legacy"] as const) {
    const data = emptyFinanceData();
    data.budgets = [{ projectCode: "P1", originalApprovedAmount: 10000, updatedAmount: 10000 }, { projectCode: "P2", originalApprovedAmount: 5000, updatedAmount: 5000 }];
    const s = stores([project("P1", 200), project("P2", 75)], data);
    const preview = await loadBudgetReconciliation(s.projects, s.finance);
    assert.throws(() => planBudgetReconciliation(preview, [], time), /Escolha/);
    const plan = planBudgetReconciliation(preview, [{ projectCode: "P1", decision }], time);
    assert.equal((await s.finance.load()).budgets[0].originalApprovedAmount, 10000);
    await confirmBudgetReconciliation(plan, s.projects, s.finance);
    const loaded = await s.finance.load();
    assert.equal(loaded.budgets[0].originalApprovedAmount, decision === "keep_financial" ? 10000 : 20000);
    assert.equal(loaded.budgets[0].reconciliation?.previousOriginalAmount, 10000);
    assert.equal(loaded.budgets[0].reconciliation?.legacyAmount, 20000);
    assert.equal(loaded.budgets[1].originalApprovedAmount, 5000);
    const refreshed = await loadBudgetReconciliation(s.projects, s.finance);
    assert.equal(refreshed.rows[0].resolved, true);
    assert.equal(refreshed.rows[1].resolved, false);
  }
});

test("updated budget continues derived from externally approved adjustments only", () => {
  const data = emptyFinanceData();
  data.budgets = [{ projectCode: "P1", originalApprovedAmount: 10000, updatedAmount: 999999 }];
  data.adjustments = [{ id: "A1", projectCode: "P1", type: "increase", amount: 5000, justification: "Ampliação", date: "2026-01-01", status: "approved", externalApprovalReference: "AP-1" }, { id: "A2", projectCode: "P1", type: "increase", amount: 3000, justification: "Pendente", date: "2026-01-01", status: "pending", externalApprovalReference: null }];
  const preview = previewBudgetReconciliation([project("P1", 200)], data);
  const plan = planBudgetReconciliation(preview, [{ projectCode: "P1", decision: "use_legacy" }], time);
  assert.equal(plan.next.budgets[0].originalApprovedAmount, 20000);
  assert.equal(plan.next.budgets[0].updatedAmount, 25000);
  assert.deepEqual(plan.next.adjustments, data.adjustments);
});

test("zero needs its own explicit decision; true financial zero is an official value", async () => {
  const s = stores([project("P1", 0)]);
  const preview = await loadBudgetReconciliation(s.projects, s.finance);
  assert.throws(() => planBudgetReconciliation(preview, [{ projectCode: "P1", decision: "use_legacy" }], time), /incompatível/);
  const plan = planBudgetReconciliation(preview, [{ projectCode: "P1", decision: "approve_zero" }], time);
  await confirmBudgetReconciliation(plan, s.projects, s.finance);
  assert.equal(officialBudget("P1", await s.finance.load()), 0);
  assert.equal(officialBudget("ABSENT", await s.finance.load()), null);
});

test("quota failure leaves both sources intact and the same plan can be retried safely", async () => {
  const s = stores([project("P1", 100)]);
  const plan = planBudgetReconciliation(await loadBudgetReconciliation(s.projects, s.finance), [{ projectCode: "P1", decision: "use_legacy" }], time);
  const before = [...s.entries];
  s.fail(true);
  await assert.rejects(confirmBudgetReconciliation(plan, s.projects, s.finance), /preservados/);
  assert.deepEqual([...s.entries], before);
  s.fail(false);
  await confirmBudgetReconciliation(plan, s.projects, s.finance);
  assert.equal((await s.finance.load()).budgets.length, 1);
  await assert.rejects(confirmBudgetReconciliation(plan, s.projects, s.finance));
  assert.equal(s.writes.length, 1);
});

test("stale project or financial snapshots require new preview without overwriting changes", async () => {
  for (const key of [PROJECTS_STORAGE_KEY, FINANCE_STORAGE_KEY]) {
    const s = stores([project("P1", 100)]);
    const plan = planBudgetReconciliation(await loadBudgetReconciliation(s.projects, s.finance), [{ projectCode: "P1", decision: "use_legacy" }], time);
    s.entries.set(key, key === PROJECTS_STORAGE_KEY ? JSON.stringify([project("P1", 200)]) : JSON.stringify({ version: 1, data: { ...emptyFinanceData(), budgets: [{ projectCode: "OTHER", originalApprovedAmount: 2000, updatedAmount: 2000 }] } }));
    const before = [...s.entries];
    await assert.rejects(confirmBudgetReconciliation(plan, s.projects, s.finance));
    assert.deepEqual([...s.entries], before);
    assert.deepEqual(s.writes, []);
  }
});

test("read errors and malformed sources never create a budget or repair storage", async () => {
  const s = stores([project("P1", 100)]);
  s.failRead(true);
  await assert.rejects(loadBudgetReconciliation(s.projects, s.finance));
  s.failRead(false);
  s.entries.set(FINANCE_STORAGE_KEY, "{broken");
  await assert.rejects(loadBudgetReconciliation(s.projects, s.finance));
  assert.equal(s.entries.get(FINANCE_STORAGE_KEY), "{broken");
  assert.deepEqual(s.writes, []);
});

test("legacy budgets are frozen in form and repository; new projects start without an approved budget", async () => {
  const p = project("P1", 100);
  assert.throws(() => prepareProject({ ...p, budget: 200 }, [p], p.code), /somente leitura/);
  const s = stores([p]);
  await assert.rejects(s.projects.save([{ ...p, budget: 200 }]));
  await s.projects.save([{ ...p, name: "Edited" }, project("P2", 0)]);
  assert.equal((await s.projects.load())![0].budget, 100);
  assert.equal(officialBudget("P2", await s.finance.load()), null);
});

test("invalid legacy codes and fractions are reported without code conversion or rounding", () => {
  const preview = previewBudgetReconciliation([project("lowercase", 10), project("P1", 1.005)], emptyFinanceData());
  assert.equal(preview.rows[0].canMigrate, false);
  assert.equal(preview.rows[1].situation, "invalid_legacy");
  assert.throws(() => planBudgetReconciliation(preview, [{ projectCode: "lowercase", decision: "use_legacy" }], time));
  assert.deepEqual(normalizeFinanceData(emptyFinanceData()).budgets, []);
});

test("concurrent confirmations cannot overwrite a committed reconciliation", async () => {
  const s = stores([project("P1", 100), project("P2", 200)]);
  const preview = await loadBudgetReconciliation(s.projects, s.finance);
  const first = planBudgetReconciliation(preview, [{ projectCode: "P1", decision: "use_legacy" }], time);
  const second = planBudgetReconciliation(preview, [{ projectCode: "P2", decision: "use_legacy" }], time);
  const results = await Promise.allSettled([confirmBudgetReconciliation(first, s.projects, s.finance), confirmBudgetReconciliation(second, s.projects, s.finance)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal((await s.finance.load()).budgets.length, 1);
  assert.equal(s.writes.length, 1);
});
