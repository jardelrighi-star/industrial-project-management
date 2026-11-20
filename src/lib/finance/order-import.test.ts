import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { Workbook } from "exceljs";
import { calculateProjectFinancials, emptyFinanceData, normalizeFinanceData } from "./calculations";
import { LocalStorageFinanceRepository, FINANCE_STORAGE_KEY } from "./repository";
import { confirmOrderImport, previewOrderImport } from "./order-import";
import { readOrderWorkbook, ORDER_HEADERS, ORDER_SHEET, type OrderWorkbook } from "./order-workbook";
import type { FinanceData } from "./types";

const time = "2026-11-16T12:00:00Z";
const base = { "Cód. Projeto": "P1", "Nr. Pedido": "100", Fornecedor: "Fornecedor A", Produto: "Bomba", "Observação": "Reforma", "Vlr Pend": "100,00" };
const file = (values: Record<string, unknown>[] = [base]): OrderWorkbook => ({ sourceFile: "pedidos.xlsx", rows: values.map((v, i) => ({ rowNumber: i + 4, values: v, cachedFormulaCount: 0 })) });
const financed = (): FinanceData => ({ ...emptyFinanceData(), budgets: ["P1", "P2"].map((projectCode) => ({ projectCode, originalApprovedAmount: 100000, updatedAmount: 100000 })) });
function stores(data = financed()) {
  const entries = new Map([[FINANCE_STORAGE_KEY, JSON.stringify({ version: 1, data })]]);
  let writes = 0;
  const repository = new LocalStorageFinanceRepository(() => ({ getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => { writes++; entries.set(key, value); } }));
  return { repository, writes: () => writes, entries };
}

test("order items consolidate by project using only Vlr Pend, without inventing totals or invoicing", async () => {
  const s = stores();
  const workbook = file([base, { ...base, Produto: "Motor", "Vlr Pend": "50,25", "Valor Corrigido": 9999 }, { ...base, "Cód. Projeto": "P2", "Vlr Pend": 20 }]);
  const preview = previewOrderImport(workbook, ["P1", "P2"], await s.repository.load(), time);
  assert.equal(preview.newCount, 2);
  assert.equal(preview.rows[0].amount, 15025);
  assert.equal(s.writes(), 0);
  assert.equal((await confirmOrderImport(preview, ["P1", "P2"], s.repository)).saved, true);
  const saved = await s.repository.load();
  assert.equal(saved.orders[0].totalAmount, null);
  assert.equal(saved.orders[0].invoicedAmount, null);
  assert.equal(saved.orders[0].status, "pending_delivery");
  assert.equal(saved.orders[0].sankhya?.items.length, 2);
  assert.equal(calculateProjectFinancials("P1", saved).totalCommitted, 15025);
  assert.equal(calculateProjectFinancials("P2", saved).totalCommitted, 2000);
});

test("SC conversion and costs remain intact and commitment counts the order once", async () => {
  const data = financed();
  const traceability = { sourceSystem: "test", sourceRecordId: "SC", recordedAt: time, externalReference: null };
  data.requisitions = [{ code: "SC1", projectCode: "P1", objective: "Reforma", amount: 15000, approvalStatus: "approved", convertedOrderNumber: "100", traceability }];
  data.actualCosts = [{ transactionId: "TX", documentEntryId: "I1", projectCode: "P1", fiscalDocument: "NF1", supplier: "A", amount: 1000, date: "2026-11-16", traceability: { ...traceability, sourceRecordId: "TX" } }];
  const s = stores(data);
  const preview = previewOrderImport(file(), ["P1"], data, time);
  assert.equal(preview.rows[0].order?.requisitionCode, "SC1");
  await confirmOrderImport(preview, ["P1"], s.repository);
  const saved = await s.repository.load();
  const summary = calculateProjectFinancials("P1", saved);
  assert.equal(summary.approvedUnconvertedRequisitions, 0);
  assert.equal(summary.totalCommitted, 10000);
  assert.equal(summary.totalActual, 1000);
  assert.equal(summary.availableBalance, 89000);
  assert.deepEqual(saved.requisitions, data.requisitions);
  assert.deepEqual(saved.actualCosts, data.actualCosts);
  assert.deepEqual(saved.budgets, data.budgets);
  assert.deepEqual(saved.adjustments, data.adjustments);
});

test("reimports ignore source filename, item order and timestamp; changed balances replace instead of accumulating", async () => {
  const s = stores();
  const workbook = file([base, { ...base, Produto: "Motor", "Vlr Pend": 50 }]);
  await confirmOrderImport(previewOrderImport(workbook, ["P1"], await s.repository.load(), time), ["P1"], s.repository);
  const reordered = { ...workbook, sourceFile: "renamed.xlsx", rows: [...workbook.rows].reverse() };
  const duplicate = previewOrderImport(reordered, ["P1"], await s.repository.load(), time);
  assert.equal(duplicate.duplicateCount, 1);
  assert.equal((await confirmOrderImport(duplicate, ["P1"], s.repository)).saved, false);
  assert.equal(s.writes(), 1);
  const update = previewOrderImport(file([{ ...base, "Vlr Pend": 25 }]), ["P1"], await s.repository.load(), time);
  assert.equal(update.updatedCount, 1);
  assert.equal(update.rows[0].previous?.openBalance, 15000);
  await confirmOrderImport(update, ["P1"], s.repository);
  const saved = await s.repository.load();
  assert.equal(saved.orders.length, 1);
  assert.equal(saved.orders[0].openBalance, 2500);
});

test("one invalid item blocks its entire order/project group without changing the previous balance", async () => {
  const s = stores();
  await confirmOrderImport(previewOrderImport(file(), ["P1"], await s.repository.load(), time), ["P1"], s.repository);
  for (const invalid of ["bad", -1]) {
    const preview = previewOrderImport(file([base, { ...base, Produto: "Motor", "Vlr Pend": invalid }]), ["P1"], await s.repository.load(), time);
    assert.equal(preview.issueCount, 1);
    assert.equal((await confirmOrderImport(preview, ["P1"], s.repository)).saved, false);
    assert.equal((await s.repository.load()).orders[0].openBalance, 10000);
  }
});

test("indistinguishable items, mixed suppliers, missing budgets and unresolved projects block groups", () => {
  const workbook = file([
    base, base,
    { ...base, "Nr. Pedido": "2" }, { ...base, "Nr. Pedido": "2", Produto: "Other", Fornecedor: "B" },
    { ...base, "Nr. Pedido": "3", "Cód. Projeto": "UNKNOWN" },
    { ...base, "Nr. Pedido": "4", "Cód. Projeto": "NO_BUDGET" },
    { ...base, "Nr. Pedido": "5" }, { ...base, "Nr. Pedido": "5", "Cód. Projeto": null },
  ]);
  const preview = previewOrderImport(workbook, ["P1", "NO_BUDGET"], financed(), time);
  assert.equal(preview.newCount, 0);
  assert.equal(preview.rows[0].status, "conflict");
  assert.ok(preview.rows.every((row) => row.status === "invalid" || row.status === "conflict"));
});

test("orders absent from a later export and records from other origins are preserved", async () => {
  const data = financed();
  data.orders = [{ number: "100", projectCode: "P1", objective: "Existing", supplier: "A", totalAmount: 10000, invoicedAmount: 0, openBalance: 10000, status: "open", requisitionCode: null, traceability: { sourceSystem: "Manual", sourceRecordId: "M", recordedAt: time, externalReference: null } }];
  const s = stores(data);
  const preview = previewOrderImport(file([base, { ...base, "Nr. Pedido": "NEW" }]), ["P1"], data, time);
  assert.equal(preview.rows[0].status, "conflict");
  await confirmOrderImport(preview, ["P1"], s.repository);
  assert.deepEqual((await s.repository.load()).orders[0], data.orders[0]);
  const next = previewOrderImport(file([{ ...base, "Nr. Pedido": "OTHER" }]), ["P1"], await s.repository.load(), time);
  await confirmOrderImport(next, ["P1"], s.repository);
  assert.equal((await s.repository.load()).orders.length, 3);
});

test("stale finance or project membership cannot overwrite concurrent changes", async () => {
  const s = stores();
  const preview = previewOrderImport(file(), ["P1"], await s.repository.load(), time);
  assert.equal((await confirmOrderImport(preview, ["P1"], s.repository, async () => [])).saved, false);
  assert.equal(s.writes(), 0);
  let loads = 0;
  await assert.rejects(confirmOrderImport(preview, ["P1"], s.repository, async () => ++loads === 1 ? ["P1"] : []), /preservados/);
  assert.equal(s.writes(), 0);
  const second = previewOrderImport(file([{ ...base, "Nr. Pedido": "SECOND" }]), ["P1"], await s.repository.load(), time);
  await Promise.allSettled([confirmOrderImport(preview, ["P1"], s.repository), confirmOrderImport(second, ["P1"], s.repository)]);
  assert.equal(s.writes(), 1);
  assert.equal((await s.repository.load()).orders.length, 1);
});

test("quota failure preserves all data and allows retrying the same preview", async () => {
  let raw = JSON.stringify({ version: 1, data: financed() }); let fail = true;
  const repository = new LocalStorageFinanceRepository(() => ({ getItem: (key) => key === FINANCE_STORAGE_KEY ? raw : null, setItem: (_key, value) => { if (fail) throw new DOMException("Full", "QuotaExceededError"); raw = value; } }));
  const preview = previewOrderImport(file(), ["P1"], await repository.load(), time);
  const before = raw;
  await assert.rejects(confirmOrderImport(preview, ["P1"], repository), /armazenamento/);
  assert.equal(raw, before);
  fail = false;
  assert.equal((await confirmOrderImport(preview, ["P1"], repository)).saved, true);
});

test("unknown total/invoiced values require pending-delivery provenance and exact item sum", () => {
  const order = previewOrderImport(file(), ["P1"], financed(), time).rows[0].order!;
  assert.doesNotThrow(() => normalizeFinanceData({ ...financed(), orders: [order] }));
  for (const invalid of [{ ...order, sankhya: undefined }, { ...order, openBalance: 999 }, { ...order, totalAmount: 10000 }, { ...order, status: "open" }]) {
    assert.throws(() => normalizeFinanceData({ ...financed(), orders: [invalid] }));
  }
});

test("reader uses cached projects and Vlr Pend, ignoring errors in Valor Corrigido and delivery status", async () => {
  const book = new Workbook(); const sheet = book.addWorksheet(ORDER_SHEET);
  sheet.getRow(3).values = [...ORDER_HEADERS, "Valor Corrigido", "Status"];
  sheet.getRow(4).values = [{ formula: "1+1", result: 2 }, 100, "Fornecedor", "Bomba", "Objetivo", 25, { formula: "1/0", result: { error: "#DIV/0!" } }, "ATRASADO"];
  const workbook = await readOrderWorkbook(await book.xlsx.writeBuffer() as unknown as ArrayBuffer, "orders.xlsx");
  assert.equal(workbook.rows[0].cachedFormulaCount, 1);
  assert.equal(workbook.rows[0].issue, undefined);
  assert.equal(workbook.rows[0].values["Vlr Pend"], 25);
  const empty = new Workbook(); empty.addWorksheet(ORDER_SHEET).getRow(3).values = ["Nr. Pedido"];
  await assert.rejects(readOrderWorkbook(await empty.xlsx.writeBuffer() as unknown as ArrayBuffer, "orders.xlsx"), /incompleto/);
});

test("real pending-delivery workbook imports complete valid groups and reimports without duplicates", { skip: !existsSync("references/Painel Capex 20252.xlsx") }, async (t) => {
  const workbook = await readOrderWorkbook(Uint8Array.from(readFileSync("references/Painel Capex 20252.xlsx")).buffer, "Painel Capex 20252.xlsx");
  const codes = [...new Set(workbook.rows.map((row) => String(row.values["Cód. Projeto"] ?? "").trim()).filter(Boolean))];
  const initial = { ...emptyFinanceData(), budgets: codes.map((projectCode) => ({ projectCode, originalApprovedAmount: 100000000, updatedAmount: 100000000 })) };
  const s = stores(initial);
  const preview = previewOrderImport(workbook, codes, initial, time);
  assert.ok(preview.newCount > 0);
  const result = await confirmOrderImport(preview, codes, s.repository);
  assert.equal(result.saved, true);
  const saved = await s.repository.load();
  assert.deepEqual(saved.orders, result.preview.rows.filter((row) => row.status === "new").map((row) => row.order));
  assert.equal(previewOrderImport(workbook, codes, saved, time).duplicateCount, preview.newCount);
  t.diagnostic(`${workbook.rows.length} linhas, ${preview.newCount} pedidos/projetos válidos, ${preview.issueCount} grupos bloqueados. Somente armazenamento de teste em memória.`);
});
