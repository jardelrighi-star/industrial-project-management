import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Workbook } from "exceljs";
import { calculateCommittedTotal, emptyFinanceData, normalizeFinanceData } from "./calculations";
import { previewOrderImport } from "./order-import";
import { readOrderWorkbook } from "./order-workbook";
import { previewRequisitionImport } from "./requisition-import";
import { readRequisitionWorkbook } from "./requisition-workbook";
import { COST_HEADERS, previewCostImport } from "./sankhya-import";
import { readCostWorkbook } from "./sankhya-workbook";

const date = "2026-11-20T12:00:00Z";
const projects = ["123"];
const finance = () => ({
  ...emptyFinanceData(),
  budgets: [{ projectCode: "123", originalApprovedAmount: 100000, updatedAmount: 100000 }],
});

async function exportFile(headers: readonly string[], rows: unknown[][], footerColumn: number) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("new sheet");
  sheet.addRows([["Relatório"], ["Emissão", `Total de registros:${rows.length}`], [...headers], ...rows]);
  sheet.getCell(rows.length + 4, footerColumn).value = { formula: "SUM(A4:A5)", result: 100 };
  return Uint8Array.from(new Uint8Array(await workbook.xlsx.writeBuffer())).buffer;
}

test("standalone cost export reads the source tab, skips the footer and flags unlinked project codes", async () => {
  const line: Record<string, unknown> = { COD_INDORAMA: 123, VLRTOT: 25, NUMNOTA: 1, NUNOTA: 2, CODEMP: 1, CODPROD: 3, DTENTSAI: 46000 };
  const rows = [
    { ...line, COD_INDORAMA: 0, AD_PROJ_IHBL: 123 },
    { ...line, AD_PROJ_IHBL: 999 },
    { ...line, AD_PROJ_IHBL: 0 },
    { ...line, AD_PROJ_IHBL: null },
  ].map((entry: Record<string, unknown>) => COST_HEADERS.map((header) => entry[header]));
  const workbook = await readCostWorkbook(await exportFile(COST_HEADERS, rows, 2), "custos.xlsx");
  const preview = previewCostImport(workbook, [...projects, "999"], finance(), date);
  assert.equal(preview.rows.length, 4);
  assert.equal(preview.readyCount, 2);
  assert.equal(preview.issueCount, 2);
  assert.equal(preview.rows[0].cost?.projectCode, "123");
  assert.equal(preview.rows[1].cost?.projectCode, "999");
  assert.equal(preview.rows[1].cost?.sankhya?.adProjIhbl, "999");
  assert.equal(preview.rows[1].cost?.sankhya?.sourceSheet, "new sheet");
  assert.match(preview.rows[2].message, /AD_PROJ_IHBL sem projeto/);
  assert.match(preview.rows[3].message, /AD_PROJ_IHBL sem projeto/);
});

test("standalone SCs and orders consolidate items and keep distinct internal order IDs", async () => {
  const scHeaders = ["Cód. Projeto", "Nr.Unico", "Vlr Pendente", "Confirmada", "Observação"];
  const scFile = await exportFile(scHeaders, [[123, 100, 10, "Sim", "A"], [123, 100, 15, "Sim", "B"], [123, 200, 30, "Sim", "C"]], 3);
  const scs = previewRequisitionImport(await readRequisitionWorkbook(scFile, "scs.xlsx"), projects, finance(), date);
  assert.equal(scs.newCount, 2);
  assert.deepEqual(scs.rows[0].rowNumbers, [4, 5]);
  assert.equal(scs.rows[0].amount, 2500);

  const orderHeaders = ["Cód. Projeto", "Nr. Pedido", "Fornecedor", "Produto", "OBSERVACAO", "Vlr Pend", "Nr.Unico Ped.", "SC"];
  const orderFile = await exportFile(orderHeaders, [
    [123, 50, "Fornecedor", "Produto A", "Obs", 60, 300, 100],
    [123, 50, "Fornecedor", "Produto B", "Obs", 50, 300, 200],
    [123, 50, "Fornecedor", "Produto A", "Obs", 60, 300, 100],
    [123, 50, "Fornecedor", "Produto A", "Obs", 20, 301, 0],
    [123, 0, "Fornecedor", "Produto A", "Obs", 5, 302, 0],
    [null, 50, "Fornecedor", "Projeto não informado", "Obs", 25, 300, 0],
  ], 6);
  const data = { ...finance(), requisitions: scs.rows.map((row) => row.requisition!) };
  const workbook = await readOrderWorkbook(orderFile, "pedidos.xlsx");
  const orders = previewOrderImport(workbook, projects, data, date);
  assert.equal(orders.newCount, 3);
  assert.equal(orders.issueCount, 1);
  assert.equal(orders.rows[0].amount, 17000);
  assert.deepEqual(orders.rows[0].order?.sankhya?.items.map((item) => item.sourceRow), [4, 5, 6]);
  assert.equal(orders.rows[2].number, "302");
  const saved = normalizeFinanceData({ ...data, orders: orders.rows.flatMap((row) => row.order ? [row.order] : []) });
  assert.equal(calculateCommittedTotal(projects, saved), 19500);
  assert.equal(previewOrderImport(workbook, projects, saved, date).duplicateCount, 3);
});

test("legacy XLS imports additional report fields with the existing financial values", async () => {
  const { utils, write } = await import("xlsx");
  const legacyExport = (headers: readonly string[], values: Record<string, unknown>) => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([
      ["Relatório"], ["Emissão"], [...headers], headers.map((header) => values[header]),
    ]), "new sheet");
    return write(book, { bookType: "biff8", type: "array" }) as ArrayBuffer;
  };
  const requisitions = await readRequisitionWorkbook(legacyExport(
    ["Cód. Projeto", "Nr.Unico", "Vlr Pendente", "Confirmada", "Observação", "Nome Comprador", "Dt. Entrada/Saída"],
    { "Cód. Projeto": 123, "Nr.Unico": 42, "Vlr Pendente": 25, Confirmada: "Sim", "Nome Comprador": "Compradora", "Dt. Entrada/Saída": 46000 },
  ), "SC_s_Pendentes.xls");
  const sc = previewRequisitionImport(requisitions, projects, finance(), date).rows[0].requisition;
  assert.equal(sc?.amount, 2500);
  assert.deepEqual(sc.reportFields, { Comprador: ["Compradora"], "Data de entrada/saída": ["09/12/2025"] });

  const orders = await readOrderWorkbook(legacyExport(
    ["Cód. Projeto", "Nr. Pedido", "Fornecedor", "Produto", "OBSERVACAO", "Vlr Pend", "Nr.Unico Ped.", "SC", "Desc.Grupo Produto"],
    { "Cód. Projeto": 123, "Nr. Pedido": 51, Fornecedor: "Fornecedor", Produto: "Produto A", "Vlr Pend": 10, "Nr.Unico Ped.": 52, SC: 42, "Desc.Grupo Produto": "Grupo A" },
  ), "Pedidos_Pendentes.xls");
  const order = previewOrderImport(orders, projects, finance(), date).rows[0].order;
  assert.equal(order?.openBalance, 1000);
  assert.equal(order.requisitionCode, "42");
  assert.deepEqual(order.reportFields?.["Grupo do produto"], ["Grupo A"]);

  const costs = await readCostWorkbook(legacyExport(
    [...COST_HEADERS, "NF_PEDIDO", "DESCROPER"],
    { AD_PROJ_IHBL: 123, VLRTOT: 12, NUMNOTA: 1, NUNOTA: 2, CODEMP: 1, CODPROD: 3, DTENTSAI: 46000, NF_PEDIDO: 51, DESCROPER: "Operação A" },
  ), "Exportação de Custo.xls");
  const cost = previewCostImport(costs, projects, finance(), date).rows[0].cost;
  assert.equal(cost?.amount, 1200);
  assert.deepEqual(cost.reportFields, { NF_PEDIDO: ["51"], Operação: ["Operação A"] });
});
