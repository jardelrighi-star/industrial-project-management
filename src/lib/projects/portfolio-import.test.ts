import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Workbook } from "exceljs";
import { emptyFinanceData } from "../finance/calculations";
import { LocalStorageFinanceRepository } from "../finance/repository";
import { LocalStorageProjectRepository } from "./repository";
import { previewPortfolioImport, type PortfolioMapping } from "./portfolio-import";
import { readPortfolioWorkbook, type PortfolioCell, type PortfolioWorkbook } from "./portfolio-workbook";
import { PortfolioImportRepository } from "./portfolio-repository";
import { FINANCE_KEY, PROJECT_KEY, TRANSACTION_KEY } from "../coordinated-storage";
import type { Project } from "./types";
import type { FinanceData } from "../finance/types";
import { loadBudgetReconciliation, planBudgetReconciliation, confirmBudgetReconciliation } from "../finance/budget-reconciliation";

const mapping: PortfolioMapping = { sheet: "Carteira", headerRow: 2, columns: { code: 1, name: 2, approvedAmount: 3 } };
const legacy = (code = "OLD"): Project => ({ code, name: "Projeto anterior", budget: 99, unit: "Original", department: "", category: "", type: "", owner: "", manager: "", start: "", finish: "", priority: "", status: "Planejado", progress: 0 });
const cell = (value: PortfolioCell["value"]): PortfolioCell => ({ value });
function book(values: PortfolioCell[][] = [[cell("0012"), cell("Novo projeto"), cell("R$ 1.234,56")]]): PortfolioWorkbook {
  return { sourceFile: "carteira.xlsx", date1904: false, sheets: [{ name: "Carteira", columnCount: 5, rows: [
    { rowNumber: 1, cells: { 1: cell("Título livre") } },
    { rowNumber: 2, cells: { 1: cell("Identificador"), 2: cell("Descrição livre"), 3: cell("Verba autorizada") } },
    ...values.map((cells, i) => ({ rowNumber: i + 3, cells: Object.fromEntries(cells.map((item, index) => [index + 1, item])) })),
  ] }] };
}
function stores(projects: Project[] = [], finance: FinanceData = emptyFinanceData()) {
  const entries = new Map<string, string>([[PROJECT_KEY, JSON.stringify(projects)], [FINANCE_KEY, JSON.stringify({ version: 1, extraEnvelope: "preserved", data: finance })]]);
  const writes: string[] = [];
  let failKey: string | null = null;
  let failReads = false;
  const port = () => ({
    getItem: (key: string) => { if (failReads) throw new Error("Access denied"); return entries.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (key === failKey) throw new Error("QuotaExceededError"); writes.push(key); entries.set(key, value); },
  });
  return { entries, writes, portfolio: new PortfolioImportRepository(port), projects: new LocalStorageProjectRepository(port), finance: new LocalStorageFinanceRepository(port),
    fail: (key: string | null) => { failKey = key; }, failReads: (value: boolean) => { failReads = value; } };
}

test("preview creates only new projects with integer approved cents, unchanged codes and pending execution", () => {
  const snapshot = { projects: [], finance: emptyFinanceData() };
  const before = JSON.stringify(snapshot);
  const preview = previewPortfolioImport(book(), mapping, snapshot);
  assert.equal(preview.rows[0].status, "new");
  assert.equal(preview.rows[0].code, "0012");
  assert.equal(preview.rows[0].budget?.originalApprovedAmount, 123456);
  assert.equal(preview.rows[0].project?.budget, 0);
  assert.deepEqual(preview.rows[0].project?.executionAuthorization, { status: "pending", date: null, externalReference: null });
  assert.equal(JSON.stringify(snapshot), before);
});

test("mapping is explicit: wrong sheet, header, missing required field and overlapping columns fail", () => {
  const snapshot = { projects: [], finance: emptyFinanceData() };
  for (const invalid of [
    { ...mapping, sheet: "Wrong" }, { ...mapping, headerRow: 99 },
    { ...mapping, columns: { code: 1, name: 2 } },
    { ...mapping, columns: { code: 1, name: 1, approvedAmount: 3 } },
    { ...mapping, columns: { code: 1, name: 2, approvedAmount: 99 } },
  ]) assert.throws(() => previewPortfolioImport(book(), invalid, snapshot), /Mapeamento|Mapeamento|Selecione|Mapeamento|mapeamento/);
});

test("existing codes skip all fields even when the name, amount and other cells are invalid", async () => {
  const data = emptyFinanceData();
  data.budgets = [{ projectCode: "OLD", originalApprovedAmount: 1000, updatedAmount: 1000 }];
  const s = stores([legacy()], data);
  const workbook = book([[cell("OLD"), { value: null, issue: "formula" }, cell("invalid amount")], [cell("0012"), cell("Novo"), cell(50)]]);
  const preview = previewPortfolioImport(workbook, mapping, await s.portfolio.load());
  assert.equal(preview.rows[0].status, "existing");
  const result = await s.portfolio.confirm(preview);
  assert.equal(result.saved, true);
  if (!result.saved) return;
  assert.equal(result.report.imported.length, 1);
  assert.equal(result.report.notImported[0].code, "OLD");
  assert.match(result.report.notImported[0].reason, /ignorado/);
  assert.deepEqual((await s.projects.load())![0], legacy());
  assert.deepEqual((await s.finance.load()).budgets[0], data.budgets[0]);
});

test("every repeated Excel code is blocked, including invalid lines and existing projects", () => {
  const preview = previewPortfolioImport(book([[cell("0012"), cell("Valid"), cell(10)], [cell("0012"), cell(""), cell(null)], [cell("OLD"), cell("Old"), cell(0)], [cell("OLD"), cell("Old"), cell(0)]]), mapping, { projects: [legacy()], finance: emptyFinanceData() });
  assert.deepEqual(preview.rows.map((r) => r.status), ["duplicate", "duplicate", "duplicate", "duplicate"]);
  assert.ok(preview.rows.every((r) => !r.project && !r.budget && r.reason));
});

test("invalid required fields and orphan financial identities never produce import candidates", () => {
  const data = emptyFinanceData();
  data.budgets = [{ projectCode: "ORPHAN", originalApprovedAmount: 10, updatedAmount: 10 }];
  const preview = previewPortfolioImport(book([
    [cell(null), cell("Nome"), cell(10)], [cell("001"), cell(""), cell(10)], [cell("002"), cell("Nome"), cell(null)],
    [cell("003"), cell("Nome"), cell(-1)], [cell("004"), cell("Nome"), { value: null, issue: "Fórmula proibida" }],
    [cell(12), cell("Numeric unformatted"), cell(10)], [cell("lowercase"), cell("Nome"), cell(10)],
    [cell("ORPHAN"), cell("Nome"), cell(10)],
  ]), mapping, { projects: [], finance: data });
  assert.ok(preview.rows.every((r) => r.status === "invalid" && r.reason));
});

test("approved zero is explicit in the mapped field; it does not authorize execution", () => {
  const preview = previewPortfolioImport(book([[cell("000"), cell("Projeto zero"), cell(0)]]), mapping, { projects: [], finance: emptyFinanceData() });
  assert.equal(preview.rows[0].budget?.originalApprovedAmount, 0);
  assert.equal(preview.rows[0].project?.executionAuthorization?.status, "pending");
});

test("optional fields use mapped columns and reject invalid dates and progress", () => {
  const extended = { ...mapping, columns: { ...mapping.columns, start: 4, finish: 5 } };
  const invalid = previewPortfolioImport(book([[cell("A"), cell("Projeto"), cell(10), cell("31/12/2026"), cell("01/01/2026")]]), extended, { projects: [], finance: emptyFinanceData() });
  assert.equal(invalid.rows[0].status, "invalid");
  assert.match(invalid.rows[0].reason, /anterior/);
  const progress = previewPortfolioImport(book([[cell("B"), cell("Projeto"), cell(10), cell(101)]]), { ...mapping, columns: { ...mapping.columns, progress: 4 } }, { projects: [], finance: emptyFinanceData() });
  assert.match(progress.rows[0].reason, /Avanço/);
});

test("confirmation appends only new data and retains existing raw financial collections and projects", async () => {
  const traceability = { sourceSystem: "test", sourceRecordId: "tx", recordedAt: "2026-01-01T00:00:00Z", externalReference: null };
  const data = emptyFinanceData();
  data.budgets = [{ projectCode: "OLD", originalApprovedAmount: 10000, updatedAmount: 10000 }];
  data.adjustments = [{ id: "ADJ", projectCode: "OLD", type: "increase", amount: 1000, date: "2026-01-01", status: "approved", externalApprovalReference: "REF", justification: "Aprovado" }];
  data.requisitions = [{ code: "SC", projectCode: "OLD", amount: 100, approvalStatus: "pending", convertedOrderNumber: null, objective: "", traceability: { ...traceability, sourceRecordId: "sc" } }];
  data.orders = [{ number: "PO", projectCode: "OLD", totalAmount: 200, invoicedAmount: 0, openBalance: 200, requisitionCode: null, status: "open", objective: "", supplier: "", traceability: { ...traceability, sourceRecordId: "po" } }];
  data.actualCosts = [{ transactionId: "TX", projectCode: "OLD", supplier: "", fiscalDocument: "NF", documentEntryId: "ITEM", date: "2026-01-01", amount: 50, traceability }];
  const s = stores([{ ...legacy(), additionalHistory: ["old-event"] } as Project], data);
  const snapshot = await s.portfolio.load();
  const preview = previewPortfolioImport(book(), mapping, snapshot);
  assert.deepEqual(s.writes, []);
  const result = await s.portfolio.confirm(preview);
  assert.equal(result.saved, true);
  const raw = JSON.parse(s.entries.get(FINANCE_KEY)!);
  assert.equal(raw.extraEnvelope, "preserved");
  assert.deepEqual(raw.data, { ...data, budgets: [...data.budgets, preview.rows[0].budget] });
  assert.deepEqual((await s.projects.load())![0], snapshot.projects[0]);
  assert.equal((await s.finance.load()).budgets[0].updatedAmount, 11000);
  assert.equal((await s.projects.load())!.length, 2);
});

test("failure before atomic journal commit leaves both repositories and raw keys unchanged", async () => {
  const s = stores([legacy()]);
  const preview = previewPortfolioImport(book(), mapping, await s.portfolio.load());
  const before = [...s.entries];
  s.fail(TRANSACTION_KEY);
  await assert.rejects(s.portfolio.confirm(preview), /Quota/);
  assert.deepEqual([...s.entries], before);
  assert.equal((await s.projects.load())!.length, 1);
  assert.equal((await s.finance.load()).budgets.length, 0);
});

for (const failureKey of [PROJECT_KEY, FINANCE_KEY]) {
  test(`failure mirroring ${failureKey} still exposes the full committed batch and recovers without duplication`, async () => {
    const s = stores([legacy()]);
    const preview = previewPortfolioImport(book(), mapping, await s.portfolio.load());
    s.fail(failureKey);
    const result = await s.portfolio.confirm(preview);
    assert.equal(result.saved, true);
    if (!result.saved) return;
    assert.equal(result.report.recoveryPending, true);
    assert.equal(s.portfolio.pendingRecovery(), true);
    const readsBefore = s.writes.length;
    assert.equal((await s.projects.load())!.length, 2);
    assert.equal((await s.finance.load()).budgets.length, 1);
    assert.equal(s.writes.length, readsBefore);
    // Other writers may not bypass an unrecovered transaction.
    await assert.rejects(s.finance.save(await s.finance.load()));
    await assert.rejects(s.projects.save((await s.projects.load())!));
    s.fail(null);
    await s.portfolio.recover();
    assert.equal(s.portfolio.pendingRecovery(), false);
    assert.equal(JSON.parse(s.entries.get(PROJECT_KEY)!).length, 2);
    assert.equal(JSON.parse(s.entries.get(FINANCE_KEY)!).data.budgets.length, 1);
    const repeat = await s.portfolio.confirm(preview);
    assert.equal(repeat.saved, false);
    assert.equal((await s.projects.load())!.length, 2);
  });
}

test("a stale preview is refreshed and needs reconfirmation without any writes", async () => {
  const s = stores();
  const preview = previewPortfolioImport(book(), mapping, await s.portfolio.load());
  s.entries.set(PROJECT_KEY, JSON.stringify([legacy("0012")]));
  const before = [...s.entries];
  const result = await s.portfolio.confirm(preview);
  assert.equal(result.saved, false);
  if (result.saved) return;
  assert.equal(result.preview.rows[0].status, "existing");
  assert.deepEqual([...s.entries], before);
});

test("reading errors and corrupted transaction metadata cannot overwrite either original storage", async () => {
  const s = stores([legacy()]);
  s.failReads(true);
  await assert.rejects(s.portfolio.load());
  s.failReads(false);
  s.entries.set(TRANSACTION_KEY, "{broken");
  const before = [...s.entries];
  await assert.rejects(s.portfolio.load());
  await assert.rejects(s.portfolio.recover());
  assert.deepEqual([...s.entries], before);
  assert.deepEqual(s.writes, []);
});

test("external changes during pending recovery are detected without destructive rollback", async () => {
  const s = stores([legacy()]);
  const preview = previewPortfolioImport(book(), mapping, await s.portfolio.load());
  s.fail(FINANCE_KEY);
  await s.portfolio.confirm(preview);
  s.fail(null);
  s.entries.set(FINANCE_KEY, JSON.stringify({ version: 1, data: { ...emptyFinanceData(), budgets: [{ projectCode: "EXTERNAL", originalApprovedAmount: 100, updatedAmount: 100 }] } }));
  const before = [...s.entries];
  await assert.rejects(s.portfolio.recover(), /Conflito/);
  await assert.rejects(s.portfolio.load());
  assert.deepEqual([...s.entries], before);
});

test("a stale cadastral writer cannot delete an imported project accidentally", async () => {
  const s = stores([legacy()]);
  const prior = (await s.projects.load())!;
  const preview = previewPortfolioImport(book(), mapping, await s.portfolio.load());
  await s.portfolio.confirm(preview);
  await assert.rejects(s.projects.save([{ ...prior[0], name: "Stale edit" }], prior));
  assert.equal((await s.projects.load())!.length, 2);
});

test("journal cleanup failure is a committed batch, including after a new repository instance is created", async () => {
  const entries = new Map<string, string>();
  let failCleanup = true;
  const port = () => ({
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === TRANSACTION_KEY && value === "null" && failCleanup) throw new Error("Cleanup failed");
      entries.set(key, value);
    },
  });
  const first = new PortfolioImportRepository(port);
  const preview = previewPortfolioImport(book(), mapping, await first.load());
  const result = await first.confirm(preview);
  assert.equal(result.saved, true);
  if (!result.saved) return;
  assert.equal(result.report.recoveryPending, true);
  const reopened = new PortfolioImportRepository(port);
  assert.equal((await reopened.load()).projects[0].code, "0012");
  assert.equal((await reopened.load()).finance.budgets[0].projectCode, "0012");
  failCleanup = false;
  await reopened.recover();
  await reopened.recover();
  assert.equal(reopened.pendingRecovery(), false);
  assert.equal((await reopened.load()).projects.length, 1);
});

test("existing reconciliation remains available after a recovered portfolio import", async () => {
  const s = stores([legacy()]);
  const preview = previewPortfolioImport(book(), mapping, await s.portfolio.load());
  s.fail(FINANCE_KEY);
  await s.portfolio.confirm(preview);
  s.fail(null);
  const reconciliation = await loadBudgetReconciliation(s.projects, s.finance);
  const plan = planBudgetReconciliation(reconciliation, [{ projectCode: "OLD", decision: "use_legacy" }], "2026-11-15T12:00:00Z");
  await confirmBudgetReconciliation(plan, s.projects, s.finance);
  assert.equal(s.portfolio.pendingRecovery(), false);
  const finance = await s.finance.load();
  assert.equal(finance.budgets.find((b) => b.projectCode === "OLD")!.originalApprovedAmount, 9900);
  assert.equal(finance.budgets.find((b) => b.projectCode === "0012")!.originalApprovedAmount, 123456);
  assert.equal((await s.projects.load())!.length, 2);
});

test("headerless worksheets map by column without silently dropping the first data row", () => {
  const workbook = book();
  workbook.sheets[0].rows = [{ rowNumber: 1, cells: { 1: cell("0001"), 2: cell("Primeiro"), 3: cell(100) } }];
  const preview = previewPortfolioImport(workbook, { ...mapping, headerRow: 0 }, { projects: [], finance: emptyFinanceData() });
  assert.equal(preview.rows[0].code, "0001");
  assert.equal(preview.rows[0].status, "new");
});

test("concurrent portfolio confirmations commit at most once and request a refreshed preview", async () => {
  const s = stores();
  const preview = previewPortfolioImport(book(), mapping, await s.portfolio.load());
  const results = await Promise.all([s.portfolio.confirm(preview), s.portfolio.confirm(preview)]);
  assert.equal(results.filter((r) => r.saved).length, 1);
  assert.equal(results.filter((r) => !r.saved).length, 1);
  assert.equal((await s.projects.load())!.length, 1);
  assert.equal((await s.finance.load()).budgets.length, 1);
});

test("Excel reader preserves text and explicit zero masks, all sheets and header row choice", async () => {
  const excel = new Workbook();
  const sheet = excel.addWorksheet("Carteira");
  sheet.addRow(["Title"]); sheet.addRow(["Identifier", "Name", "Approved"]);
  sheet.addRow(["0012", "Texto", 100]);
  sheet.addRow([34, "Com máscara", 200]); sheet.getCell("A4").numFmt = "00000";
  sheet.addRow([56, "Sem máscara", 300]);
  sheet.addRow(["007", "Formula", { formula: "1+1", result: 2 }]);
  excel.addWorksheet("Outra aba").addRow(["Anything"]);
  const buffer = new Uint8Array(await excel.xlsx.writeBuffer() as unknown as ArrayBuffer).buffer;
  const workbook = await readPortfolioWorkbook(buffer, "book.xlsx");
  assert.deepEqual(workbook.sheets.map((s) => s.name), ["Carteira", "Outra aba"]);
  const preview = previewPortfolioImport(workbook, mapping, { projects: [], finance: emptyFinanceData() });
  assert.deepEqual(preview.rows.map((r) => [r.code, r.status]), [["0012", "new"], ["00034", "new"], ["56", "invalid"], ["007", "invalid"]]);
});
