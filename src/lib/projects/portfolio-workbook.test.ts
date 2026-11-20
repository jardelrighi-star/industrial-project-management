import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Workbook } from "exceljs";
import JSZip from "jszip";
import { PortfolioWorkbookReadError, readPortfolioWorkbook } from "./portfolio-workbook";

async function validWorkbook() {
  const excel = new Workbook();
  const sheet = excel.addWorksheet("Carteira CAPEX");
  sheet.addRow(["Título"]);
  sheet.addRow(["COD_INDORAMA", "Nome", "Orçamento aprovado"]);
  sheet.addRow(["0001", "Projeto de teste", 100]);
  excel.addWorksheet("Instruções").addRow(["Cabeçalho na linha 2"]);
  return Uint8Array.from(new Uint8Array(await excel.xlsx.writeBuffer())).buffer;
}

test("valid Excel preserves sheet names, header positions, columns and leading zero codes", async () => {
  const workbook = await readPortfolioWorkbook(await validWorkbook(), "valid.xlsx");
  assert.deepEqual(workbook.sheets.map((s) => s.name), ["Carteira CAPEX", "Instruções"]);
  assert.deepEqual(workbook.sheets[0].rows.find((r) => r.rowNumber === 2)?.cells, { 1: { value: "COD_INDORAMA" }, 2: { value: "Nome" }, 3: { value: "Orçamento aprovado" } });
  assert.equal(workbook.sheets[0].rows.find((r) => r.rowNumber === 3)?.cells[1].value, "0001");
});

test("invalid XLSX reports a friendly message and preserves the original technical exception", async () => {
  await assert.rejects(readPortfolioWorkbook(new TextEncoder().encode("not an Excel archive").buffer, "invalid.xlsx"), (error: unknown) => {
    assert.ok(error instanceof PortfolioWorkbookReadError);
    assert.match(error.message, /não é um Excel \.xlsx válido|corrompido/);
    assert.ok(error.cause instanceof Error);
    assert.doesNotMatch(error.message, /Cannot read|undefined|TypeError|central directory/);
    return true;
  });
});

test("ExcelJS reads prefixed workbook XML after safe in-memory normalization", async () => {
  const zip = await JSZip.loadAsync(await validWorkbook());
  const xml = (await zip.file("xl/workbook.xml")!.async("string"))
    .replace("<workbook ", '<workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ')
    .replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)\b/g, "<$1x:$2");
  zip.file("xl/workbook.xml", xml);
  const buffer = Uint8Array.from(await zip.generateAsync({ type: "uint8array" })).buffer;
  const workbook = await readPortfolioWorkbook(buffer, "namespace-prefix.xlsx");
  assert.deepEqual(workbook.sheets.map((sheet) => sheet.name), ["Carteira CAPEX", "Instruções"]);
  assert.equal(workbook.sheets[0].rows.find((row) => row.rowNumber === 3)?.cells[1].value, "0001");
});

test("development console retains the original error object and filename", async (context) => {
  const previous = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "development");
  const logged: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  try {
    await assert.rejects(readPortfolioWorkbook(new Uint8Array([1, 2, 3]).buffer, "diagnostic.xlsx"), (error: unknown) => {
      assert.ok(error instanceof PortfolioWorkbookReadError);
      assert.equal(logged.length, 1);
      const details = logged[0][1] as { sourceFile: string; cause: Error };
      assert.equal(details.sourceFile, "diagnostic.xlsx");
      assert.equal(details.cause, error.cause);
      assert.ok(details.cause.stack);
      return true;
    });
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Reflect.set(process.env, "NODE_ENV", previous);
  }
});

const fixtureName = "carteira_capex_ficticia_teste.xlsx";
const fixture = [process.env.PORTFOLIO_WORKBOOK_FIXTURE, resolve(fixtureName), resolve("references", fixtureName), resolve("fixtures", fixtureName)].find((path): path is string => !!path && existsSync(path));
test("workspace carteira_capex_ficticia_teste.xlsx sheets and header can be inspected without importing", { skip: fixture ? false : "Arquivo fictício não encontrado no workspace; informe PORTFOLIO_WORKBOOK_FIXTURE ou coloque-o em references/." }, async (context) => {
  const workbook = await readPortfolioWorkbook(Uint8Array.from(readFileSync(fixture!)).buffer, fixtureName);
  context.diagnostic(`Abas: ${workbook.sheets.map((sheet) => sheet.name).join(", ")}`);
  const capex = workbook.sheets.find((sheet) => sheet.name === "Carteira CAPEX");
  assert.ok(capex, "Aba Carteira CAPEX não reconhecida pelo importador.");
  const header = capex.rows.find((row) => row.rowNumber === 1);
  assert.ok(header && Object.values(header.cells).some((cell) => cell.value === "COD_INDORAMA"), "Cabeçalho COD_INDORAMA não reconhecido na linha 1.");
  const projects = capex.rows.filter((row) => row.rowNumber > 1 && Object.values(row.cells).some((cell) => cell.value !== null && cell.value !== ""));
  assert.equal(projects.length, 10, "A carteira fictícia deve conter exatamente 10 linhas de projetos.");
  const headers = workbook.sheets.flatMap((sheet) => sheet.rows.filter((row) => Object.values(row.cells).some((cell) => typeof cell.value === "string" && /COD[ _-]*INDORAMA/i.test(cell.value))).map((row) => ({ sheet: sheet.name, row: row.rowNumber, columns: Object.values(row.cells).map((cell) => cell.value) })));
  assert.ok(headers.length, "Cabeçalho com COD_INDORAMA não encontrado; inspecione o layout para mapeamento explícito.");
  for (const header of headers) context.diagnostic(`Cabeçalho: ${JSON.stringify(header)}`);
});
