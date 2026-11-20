import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { Workbook } from "exceljs";
import JSZip from "jszip";
import { calculateProjectFinancials, emptyFinanceData } from "./calculations";
import { LocalStorageFinanceRepository, FINANCE_STORAGE_KEY } from "./repository";
import { confirmRequisitionImport, previewRequisitionImport } from "./requisition-import";
import { readRequisitionWorkbook, SC_HEADERS, SC_SHEET, type RequisitionWorkbook } from "./requisition-workbook";
import type { FinanceData } from "./types";

const time = "2026-11-16T12:00:00Z";
const base = { "Nrº Projeto": "P1", SC: "123", "Vlr. Nota": "100,00", Confirmada: "Sim", "Observação": "Compra de peças", "Nro. Pedido": null };
const workbook = (values: Record<string, unknown>[] = [base]): RequisitionWorkbook => ({ sourceFile: "sc.xlsx", rows: values.map((v, index) => ({ rowNumber: index + 4, values: v, cachedFormulaCount: 0 })) });
const financed = (): FinanceData => ({ ...emptyFinanceData(), budgets: ["P1", "P2"].map((projectCode) => ({ projectCode, originalApprovedAmount: 100000, updatedAmount: 100000 })) });
function stores(data: FinanceData = financed()) {
  const entries = new Map<string, string>([[FINANCE_STORAGE_KEY, JSON.stringify({ version: 1, data })]]);
  let writes = 0;
  const repository = new LocalStorageFinanceRepository(() => ({ getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => { writes++; entries.set(key, value); } }));
  return { repository, entries, writes: () => writes };
}

test("Sim commits approved SCs, Não is planned, and linked orders prevent double commitment", async () => {
  const s = stores();
  const file = workbook([base, { ...base, SC: "124", Confirmada: "Não" }, { ...base, SC: "125", "Nro. Pedido": "0" }, { ...base, SC: "126", "Nro. Pedido": "999" }]);
  const preview = previewRequisitionImport(file, ["P1"], await s.repository.load(), time);
  assert.equal(preview.newCount, 4);
  assert.equal(s.writes(), 0);
  assert.equal((await confirmRequisitionImport(preview, ["P1"], s.repository)).saved, true);
  const data = await s.repository.load();
  assert.equal(data.requisitions[1].approvalStatus, "pending");
  assert.equal(data.requisitions[2].convertedOrderNumber, null);
  assert.equal(data.requisitions[3].convertedOrderNumber, "999");
  assert.equal(calculateProjectFinancials("P1", data).approvedUnconvertedRequisitions, 20000);
  assert.equal(calculateProjectFinancials("P2", data).approvedUnconvertedRequisitions, 0);
});

test("identical reimports ignore filename/time/position; changed SCs update once after confirmation", async () => {
  const s = stores();
  const first = previewRequisitionImport(workbook(), ["P1"], await s.repository.load(), time);
  await confirmRequisitionImport(first, ["P1"], s.repository);
  const renamed = { ...workbook(), sourceFile: "renamed.xlsx", rows: [{ ...workbook().rows[0], rowNumber: 20 }] };
  const repeat = previewRequisitionImport(renamed, ["P1"], await s.repository.load(), time);
  assert.equal(repeat.duplicateCount, 1);
  assert.equal((await confirmRequisitionImport(repeat, ["P1"], s.repository)).saved, false);
  assert.equal(s.writes(), 1);
  const changed = previewRequisitionImport(workbook([{ ...base, Confirmada: "Não", "Vlr. Nota": "250,00", "Nro. Pedido": "900" }]), ["P1"], await s.repository.load(), time);
  assert.equal(changed.updatedCount, 1);
  assert.equal(changed.rows[0].previous?.amount, 10000);
  assert.equal((await s.repository.load()).requisitions[0].amount, 10000);
  await confirmRequisitionImport(changed, ["P1"], s.repository);
  const data = await s.repository.load();
  assert.equal(data.requisitions.length, 1);
  assert.equal(data.requisitions[0].amount, 25000);
  assert.equal(data.requisitions[0].approvalStatus, "pending");
  assert.equal(calculateProjectFinancials("P1", data).totalCommitted, 0);
});

test("unknown projects, missing budgets, invalid approvals and values are blocked individually", () => {
  const preview = previewRequisitionImport(workbook([
    base, { ...base, SC: "2", "Nrº Projeto": "MISSING" }, { ...base, SC: "3", Confirmada: "" },
    { ...base, SC: "4", Confirmada: "Pendente" }, { ...base, SC: "5", "Vlr. Nota": -1 },
    { ...base, SC: "6", "Vlr. Nota": "abc" }, { ...base, SC: "7", "Nrº Projeto": "NO_BUDGET" },
    { ...base, SC: 1.2 }, { ...base, SC: "0" }, { ...base, SC: "8", "Nro. Pedido": 1.5 },
  ]), ["P1", "NO_BUDGET"], financed(), time);
  assert.equal(preview.newCount, 1);
  assert.equal(preview.issueCount, 9);
  assert.match(preview.rows[6].message, /orçamento/);
});

test("duplicate SC rows are blocked without summing; same SC on different projects remains separate", () => {
  const preview = previewRequisitionImport(workbook([base, { ...base, "Vlr. Nota": 200 }, { ...base, "Nrº Projeto": "P2" }]), ["P1", "P2"], financed(), time);
  assert.equal(preview.issueCount, 2);
  assert.equal(preview.newCount, 1);
  assert.equal(preview.rows[2].projectCode, "P2");
});

test("SCs from another source cannot be overwritten; missing SCs and other collections remain intact", async () => {
  const initial = financed();
  initial.requisitions = [{ code: "123", projectCode: "P1", amount: 50, objective: "Manual", approvalStatus: "approved", convertedOrderNumber: null, traceability: { sourceSystem: "Manual", sourceRecordId: "M1", recordedAt: time, externalReference: null } }];
  initial.actualCosts = [{ transactionId: "TX", documentEntryId: "ITEM", fiscalDocument: "NF", projectCode: "P1", supplier: "Fornecedor", amount: 100, date: "2026-11-16", traceability: { sourceSystem: "Other", sourceRecordId: "TX", recordedAt: time, externalReference: null } }];
  const s = stores(initial);
  const preview = previewRequisitionImport(workbook([base, { ...base, SC: "NEW" }]), ["P1"], initial, time);
  assert.equal(preview.rows[0].status, "conflict");
  await confirmRequisitionImport(preview, ["P1"], s.repository);
  const next = await s.repository.load();
  assert.deepEqual(next.requisitions[0], initial.requisitions[0]);
  assert.deepEqual(next.actualCosts, initial.actualCosts);
  assert.deepEqual(next.budgets, initial.budgets);
  assert.deepEqual(next.orders, initial.orders);
  assert.deepEqual(next.adjustments, initial.adjustments);
});

test("stale previews and changes to project membership require another preview without writes", async () => {
  const s = stores();
  const preview = previewRequisitionImport(workbook(), ["P1"], await s.repository.load(), time);
  assert.equal((await confirmRequisitionImport(preview, ["P1"], s.repository, async () => [])).saved, false);
  assert.equal(s.writes(), 0);
  const data = await s.repository.load();
  data.budgets[0].originalApprovedAmount += 1;
  await s.repository.save(data);
  assert.equal((await confirmRequisitionImport(preview, ["P1"], s.repository)).saved, false);
  assert.equal(s.writes(), 1);
});

test("project membership is checked again under the writer lock", async () => {
  const s = stores();
  const preview = previewRequisitionImport(workbook(), ["P1"], await s.repository.load(), time);
  let loads = 0;
  await assert.rejects(confirmRequisitionImport(preview, ["P1"], s.repository, async () => ++loads === 1 ? ["P1"] : []), /preservados/);
  assert.equal(s.writes(), 0);
});

test("concurrent confirmations do not duplicate SCs or overwrite another import", async () => {
  const s = stores();
  const baseline = await s.repository.load();
  const first = previewRequisitionImport(workbook(), ["P1"], baseline, time);
  const second = previewRequisitionImport(workbook([{ ...base, SC: "OTHER" }]), ["P1"], baseline, time);
  await Promise.allSettled([confirmRequisitionImport(first, ["P1"], s.repository), confirmRequisitionImport(second, ["P1"], s.repository)]);
  assert.equal(s.writes(), 1);
  assert.equal((await s.repository.load()).requisitions.length, 1);
});

test("storage failure keeps existing SCs intact and allows retrying the same preview", async () => {
  let raw = JSON.stringify({ version: 1, data: financed() });
  let fail = true;
  const repository = new LocalStorageFinanceRepository(() => ({ getItem: (key) => key === FINANCE_STORAGE_KEY ? raw : null, setItem: (_key, value) => { if (fail) throw new DOMException("Full", "QuotaExceededError"); raw = value; } }));
  const preview = previewRequisitionImport(workbook(), ["P1"], await repository.load(), time);
  const before = raw;
  await assert.rejects(confirmRequisitionImport(preview, ["P1"], repository), /armazenamento/);
  assert.equal(raw, before);
  fail = false;
  assert.equal((await confirmRequisitionImport(preview, ["P1"], repository)).saved, true);
  assert.equal((await repository.load()).requisitions.length, 1);
});

test("missing sheet and incomplete or duplicate headers are rejected before preview", async () => {
  for (const name of ["SC EM ABERTO", SC_SHEET]) {
    const book = new Workbook(); const sheet = book.addWorksheet(name);
    sheet.getRow(3).values = ["SC", "SC"];
    await assert.rejects(readRequisitionWorkbook(await book.xlsx.writeBuffer() as unknown as ArrayBuffer, "sc.xlsx"), /Aba obrigatória|Cabeçalho duplicado/);
  }
  const book = new Workbook(); book.addWorksheet(SC_SHEET).getRow(3).values = ["SC"];
  await assert.rejects(readRequisitionWorkbook(await book.xlsx.writeBuffer() as unknown as ArrayBuffer, "sc.xlsx"), /incompleto/);
});

test("Excel reader uses saved project formulas, treats errors per row, and ignores unrelated contract formulas", async () => {
  const book = new Workbook(); const sheet = book.addWorksheet(SC_SHEET);
  sheet.getRow(3).values = ["Relatório de solicitações"];
  sheet.getRow(5).values = [
    { formula: '"Nrº Projeto"', result: SC_HEADERS[0] },
    ...SC_HEADERS.slice(1),
    { formula: "1/0", result: { error: "#DIV/0!" } },
    { formula: "1+2" },
  ];
  sheet.getRow(6).values = [{ formula: "1+1", result: 2 }, 123, 100, "Sim", "Serviço", "0", { formula: "1/0", result: { error: "#DIV/0!" } }];
  sheet.getRow(7).values = [{ formula: "1/0", result: { error: "#DIV/0!" } }, 124, 100, "Não", "", null];
  sheet.getRow(8).values = [{ formula: "1+2" }, 125, 100, "Sim", "", null];
  const result = await readRequisitionWorkbook(await book.xlsx.writeBuffer() as unknown as ArrayBuffer, "sc.xlsx");
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].rowNumber, 6);
  assert.equal(result.rows[0].values["Nrº Projeto"], 2);
  assert.equal(result.rows[0].cachedFormulaCount, 1);
  assert.equal(result.rows[0].issue, undefined);
  assert.match(result.rows[1].issue!, /erro/);
  assert.match(result.rows[2].issue!, /sem resultado/);
});

test("real SC sheet can be previewed and saved with the agreed confirmation rule", { skip: !existsSync("references/Painel Capex 20252.xlsx") }, async (t) => {
  const bytes = readFileSync("references/Painel Capex 20252.xlsx");
  const archive = await JSZip.loadAsync(bytes);
  const workbookPath = "xl/workbook.xml";
  const workbookXml = await archive.file(workbookPath)!.async("string");
  if (!workbookXml.includes(`name="${SC_SHEET}"`)) {
    archive.file(workbookPath, workbookXml.replace('name="SC EM ABERTO"', `name="${SC_SHEET}"`));
  }
  const file = await readRequisitionWorkbook(await archive.generateAsync({ type: "arraybuffer" }), "Painel Capex 20252.xlsx");
  const codes = [...new Set(file.rows.map((r) => String(r.values["Nrº Projeto"] ?? "").trim()).filter(Boolean))];
  const initial = { ...emptyFinanceData(), budgets: codes.map((projectCode) => ({ projectCode, originalApprovedAmount: 100000000, updatedAmount: 100000000 })) };
  const s = stores(initial);
  const preview = previewRequisitionImport(file, codes, initial, time);
  assert.ok(preview.newCount > 0);
  const result = await confirmRequisitionImport(preview, codes, s.repository);
  assert.equal(result.saved, true);
  const data = await s.repository.load();
  for (const row of result.preview.rows.filter((r) => r.status === "new")) {
    const expected = row.requisition!;
    assert.deepEqual(data.requisitions.find((r) => r.code === expected.code && r.projectCode === expected.projectCode), expected);
    assert.equal(expected.approvalStatus, expected.sankhya!.confirmed ? "approved" : "pending");
  }
  assert.equal(previewRequisitionImport(file, codes, data, time).duplicateCount, preview.newCount);
  t.diagnostic(`${file.rows.length} linhas: ${preview.newCount} SCs novas, ${preview.issueCount} inconsistências. Apenas armazenamento de teste em memória.`);
});
