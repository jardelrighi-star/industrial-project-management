import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { Workbook } from "exceljs";
import { parseBrlCents, parseExcelDate } from "./import-values";
import { COST_HEADERS, COST_SHEET, confirmCostImport, previewCostImport, type CostWorkbook } from "./sankhya-import";
import { readCostWorkbook } from "./sankhya-workbook";
import { calculateActualCostTotal, emptyFinanceData } from "./calculations";
import { FINANCE_STORAGE_KEY, LocalStorageFinanceRepository } from "./repository";

// Synthetic fixtures are used only in memory and never persisted to real browser storage.
const v = { COD_INDORAMA: "11", AD_PROJ_IHBL: "legacy-code", DESCRPROD: "Serviço", DESCRATIVO: "Bomba", VLRTOT: 16.97, CODEMP: 1,
  NUMNOTA: 123, CODPROJ: 999, CODCENCUS: 10, NOMEPARC: "Fornecedor", DTENTSAI: 45659, NUNOTA: 1001, ANO_PROJETO: 2024,
  CODTIPOPER: 1, CODPARC: 500, IDENTIFICACAO: "Projeto", CODPROD: 1, COD_GRUPO_CONS: 1, COD_GRUPO_IMOB: 2 };
const time = "2026-01-01T00:00:00Z";
const file = (values = [v]): CostWorkbook => ({ sourceFile: "test.xlsx", date1904: false, rows: values.map((values, i) => ({ rowNumber: i + 4, values })) });
function storage() {
  const entries = new Map<string, string>();
  let writes = 0;
  const repository = new LocalStorageFinanceRepository(() => ({ getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => { writes++; entries.set(key, value); } }));
  return { repository, entries, writes: () => writes };
}

test("monetary values convert exactly into safe integer cents", () => {
  for (const [value, expected] of [[16.97, 1697], [1.005, 101], ["R$ 1.234,56", 123456], ["1.234", 123400], ["0,005", 1], [-1.005, -101], ["12.34", 1234], [0, 0]] as const) assert.equal(parseBrlCents(value), expected);
  for (const value of [null, undefined, "", "abc", NaN, Infinity, "12,3,4", "1.23,45", "90071992547409999"]) assert.throws(() => parseBrlCents(value));
});

test("Excel dates handle 1900/1904 epochs, fractions, leap bug and local formats", () => {
  assert.equal(parseExcelDate(45659), "2025-01-02");
  assert.equal(parseExcelDate(45659.75), "2025-01-02");
  assert.equal(parseExcelDate(1), "1900-01-01");
  assert.equal(parseExcelDate(59), "1900-02-28");
  assert.equal(parseExcelDate(61), "1900-03-01");
  assert.equal(parseExcelDate(0, true), "1904-01-01");
  assert.equal(parseExcelDate(1, true), "1904-01-02");
  assert.equal(parseExcelDate("02/01/2025"), "2025-01-02");
  for (const value of [60, -1, NaN, "30/02/2025", "2025-02-29", null]) assert.throws(() => parseExcelDate(value));
});

test("link uses only COD_INDORAMA and preserves Sankhya metadata", () => {
  const preview = previewCostImport(file(), ["11"], emptyFinanceData(), time);
  assert.equal(preview.readyCount, 1);
  assert.equal(preview.readyTotal, 1697);
  const cost = preview.rows[0].cost!;
  assert.equal(cost.projectCode, "11"); assert.equal(cost.fiscalDocument, "123"); assert.equal(cost.supplier, "Fornecedor");
  assert.equal(cost.description, "Serviço"); assert.equal(cost.assetDescription, "Bomba");
  assert.equal(cost.sankhya?.codproj, "999"); assert.equal(cost.sankhya?.adProjIhbl, "legacy-code");
  assert.equal(cost.sankhya?.internalNoteId, "1001"); assert.equal(cost.sankhya?.projectYear, "2024");
  for (const codes of [["999"], ["legacy-code"], []]) {
    const unmatched = previewCostImport(file(), codes, emptyFinanceData(), time);
    assert.equal(unmatched.readyCount, 0); assert.match(unmatched.rows[0].message, /COD_INDORAMA/);
  }
});

test("each spreadsheet row has its own identity, including identical items", () => {
  const distinct = previewCostImport(file([v, { ...v, CODPROD: 2 }]), ["11"], emptyFinanceData(), time);
  assert.equal(distinct.readyCount, 2); assert.equal(distinct.readyTotal, 3394);
  assert.notEqual(distinct.rows[0].cost?.transactionId, distinct.rows[1].cost?.transactionId);
  const repeated = previewCostImport(file([v, { ...v }]), ["11"], emptyFinanceData(), time);
  assert.equal(repeated.readyCount, 2);
  assert.equal(repeated.issueCount, 0);
  assert.notEqual(repeated.rows[0].cost?.transactionId, repeated.rows[1].cost?.transactionId);
  const repeatedNumber = previewCostImport(file([v, { ...v, NUNOTA: 1002 }]), ["11"], emptyFinanceData(), time);
  assert.equal(repeatedNumber.readyCount, 2);
});

test("preview never writes; confirmation imports costs without creating budgets", async () => {
  const s = storage();
  const previous = emptyFinanceData();
  previous.budgets = [{ projectCode: "OTHER", originalApprovedAmount: 1000, updatedAmount: 1000 }];
  await s.repository.save(previous);
  const writes = s.writes();
  const p = previewCostImport(file(), ["11"], await s.repository.load(), time);
  assert.equal(s.writes(), writes);
  const result = await confirmCostImport(p, ["11"], s.repository);
  assert.equal(result.saved, true);
  const loaded = await s.repository.load();
  assert.equal(loaded.actualCosts.length, 1);
  assert.deepEqual({ ...loaded, actualCosts: [] }, previous);
  assert.equal(calculateActualCostTotal("11", loaded), 1697);
  assert.equal(calculateActualCostTotal("OTHER", loaded), 0);
});

test("global import links multiple registered projects and keeps per-project financial totals isolated", async () => {
  const s = storage();
  const workbook = file([v, { ...v, COD_INDORAMA: "22", VLRTOT: 25 }, { ...v, COD_INDORAMA: "UNKNOWN" }]);
  const preview = previewCostImport(workbook, ["11", "22"], emptyFinanceData(), time);
  assert.equal(preview.readyCount, 2);
  assert.equal(preview.issueCount, 1);
  assert.equal(s.writes(), 0);
  assert.equal((await confirmCostImport(preview, ["11", "22"], s.repository)).saved, true);
  const data = await s.repository.load();
  assert.equal(data.actualCosts.length, 2);
  assert.equal(calculateActualCostTotal("11", data), 1697);
  assert.equal(calculateActualCostTotal("22", data), 2500);
  assert.equal(calculateActualCostTotal("UNKNOWN", data), 0);
});

test("reimport replaces prior costs, including changed and omitted rows", async () => {
  const s = storage();
  const codes = ["11", "22"];
  const original = file([v, { ...v, COD_INDORAMA: "22" }]);
  const first = previewCostImport(original, codes, emptyFinanceData(), time);
  assert.equal((await confirmCostImport(first, codes, s.repository)).saved, true);

  const repeat = previewCostImport(original, codes, await s.repository.load(), time);
  assert.equal((await confirmCostImport(repeat, codes, s.repository)).saved, true);
  assert.equal((await s.repository.load()).actualCosts.length, 2);

  const updated = previewCostImport(file([{ ...v, VLRTOT: 99 }, { ...v, VLRTOT: 99 }]), codes, await s.repository.load(), time);
  assert.equal(updated.previousCount, 2);
  assert.equal((await confirmCostImport(updated, codes, s.repository)).saved, true);
  const saved = await s.repository.load();
  assert.deepEqual(saved.actualCosts.map((cost) => [cost.projectCode, cost.amount]), [["11", 9900], ["11", 9900]]);

  const invalid = previewCostImport(file([{ ...v, COD_INDORAMA: "UNKNOWN" }]), codes, saved, time);
  assert.equal((await confirmCostImport(invalid, codes, s.repository)).saved, false);
  assert.deepEqual(await s.repository.load(), saved);
});

test("confirmation rechecks project membership and changes since preview", async () => {
  const s = storage();
  const p = previewCostImport(file(), ["11"], emptyFinanceData(), time);
  assert.equal((await confirmCostImport(p, [], s.repository)).saved, false);
  assert.equal(s.writes(), 0);
  await s.repository.save({ ...emptyFinanceData(), budgets: [{ projectCode: "OTHER", originalApprovedAmount: 50, updatedAmount: 50 }] });
  const result = await confirmCostImport(p, ["11"], s.repository);
  assert.equal(result.saved, false); assert.equal(result.preview.readyCount, 1);
  assert.equal((await s.repository.load()).actualCosts.length, 0);
  assert.equal((await confirmCostImport(result.preview, ["11"], s.repository)).saved, true);
});

test("invalid inputs are inconsistencies and valid rows can be explicitly imported alone", async () => {
  const s = storage();
  const p = previewCostImport(file([v, { ...v, CODPROD: 2, COD_INDORAMA: "unknown" }, { ...v, CODPROD: 3, VLRTOT: -1 }, { ...v, CODPROD: 4, DTENTSAI: 60 }]), ["11"], emptyFinanceData(), time);
  assert.equal(p.readyCount, 1); assert.equal(p.issueCount, 3);
  await confirmCostImport(p, ["11"], s.repository);
  assert.equal((await s.repository.load()).actualCosts.length, 1);
  assert.ok(s.entries.has(FINANCE_STORAGE_KEY));
});

async function excelBuffer(options: { date1904?: boolean; headerRow?: number; missing?: boolean; formula?: boolean; serial?: number } = {}) {
  const workbook = new Workbook();
  workbook.properties.date1904 = !!options.date1904;
  const sheet = workbook.addWorksheet(COST_SHEET);
  sheet.getRow(options.headerRow ?? 3).values = [...COST_HEADERS].filter((h) => !options.missing || h !== "COD_INDORAMA");
  sheet.getRow(4).values = COST_HEADERS.map((h) => h === "DTENTSAI" ? options.serial ?? v.DTENTSAI : v[h]);
  if (options.formula) sheet.getRow(4).getCell(COST_HEADERS.indexOf("VLRTOT") + 1).value = { formula: "1+1", result: 2 };
  // ExcelJS types this as ArrayBuffer; Node returns a Buffer, browsers an ArrayBuffer.
  return new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
}

test("Excel reader uses row 3, enforces headers and preserves serial date systems", async () => {
  const read = await readCostWorkbook(await excelBuffer(), "test.xlsx");
  assert.equal(read.rows[0].rowNumber, 4); assert.equal(read.rows[0].values.DTENTSAI, 45659);
  assert.equal(previewCostImport(read, ["11"], emptyFinanceData(), time).readyCount, 1);
  const older = await readCostWorkbook(await excelBuffer({ date1904: true, serial: 1 }), "1904.xlsx");
  assert.equal(previewCostImport(older, ["11"], emptyFinanceData(), time).rows[0].cost?.date, "1904-01-02");
  await assert.rejects(readCostWorkbook(await excelBuffer({ missing: true }), "missing.xlsx"), /COD_INDORAMA/);
  await assert.rejects(readCostWorkbook(await excelBuffer({ headerRow: 2 }), "wrong.xlsx"), /linha 3/);
  await assert.rejects(readCostWorkbook(await excelBuffer({ formula: true }), "formula.xlsx"), /fórmula/);
});

test("reference workbook can be read locally without loading unrelated sheets or writing", { skip: !existsSync("references/Painel Capex 20252.xlsx") }, async (t) => {
  const reference = Uint8Array.from(readFileSync("references/Painel Capex 20252.xlsx")).buffer;
  const workbook = await readCostWorkbook(reference, "Painel Capex 20252.xlsx");
  assert.ok(workbook.rows.length > 0);
  const p = previewCostImport(workbook, [], emptyFinanceData(), time);
  assert.equal(p.readyCount, 0);
  assert.equal(p.issueCount, workbook.rows.length);
  const sourceCodes = [...new Set(workbook.rows.map((r) => String(r.values.COD_INDORAMA ?? "").trim()))];
  const checks = previewCostImport(workbook, sourceCodes, emptyFinanceData(), time);
  t.diagnostic(`${workbook.rows.length} linhas da referência; com códigos da origem em memória: ${checks.readyCount} válidas, ${checks.issueCount} inconsistências/ambiguidades. Nenhuma gravação.`);
});
