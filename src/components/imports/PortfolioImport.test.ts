import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PortfolioImport from "./PortfolioImport";
import { PortfolioImportRepository } from "../../lib/projects/portfolio-repository";
import PortfolioWorkbookPanel from "./PortfolioWorkbookPanel";
import { Workbook } from "exceljs";
import { assertPortfolioWorkbook, readPortfolioWorkbook, type PortfolioWorkbook } from "../../lib/projects/portfolio-workbook";
import { validatePortfolioMapping, type PortfolioMapping } from "../../lib/projects/portfolio-import";
import { initialPortfolioPanelState, portfolioPanelReducer, portfolioSelectionError } from "./portfolio-panel-state";

const mapping: PortfolioMapping = { sheet: "", headerRow: 1, columns: {} };
const noAction = () => { throw new Error("Rendering must not read, map or import data"); };
const renderPanel = (workbook?: PortfolioWorkbook | null, busy = false, selected = mapping) => renderToStaticMarkup(createElement(PortfolioWorkbookPanel, {
  workbook, busy, mapping: selected, onFile: noAction, onMapping: noAction, onPrepare: noAction,
}));

test("portfolio importer opens as an explicit action without touching storage or offering immediate confirmation", () => {
  let accesses = 0;
  const html = renderToStaticMarkup(createElement(PortfolioImport, { dataRepository: new PortfolioImportRepository(() => { accesses++; throw new Error("Unexpected storage access"); }) }));
  assert.match(html, /Importar Carteira de Projetos/);
  assert.doesNotMatch(html, /Confirmar importação|type="file"/);
  assert.equal(accesses, 0);
});

test("opened file panel renders safely without a selected file, including null and undefined workbook states", () => {
  for (const workbook of [null, undefined]) {
    const html = renderPanel(workbook);
    assert.match(html, /type="file"/);
    assert.match(html, /Selecione um arquivo Excel/);
    assert.doesNotMatch(html, /<select|Confirmar mapeamento/);
  }
});

test("loading keeps file input disabled and does not expose selectors from absent or stale file data", () => {
  const prior: PortfolioWorkbook = { sourceFile: "prior.xlsx", date1904: false, sheets: [{ name: "Stale sheet", columnCount: 0, rows: [] }] };
  for (const workbook of [undefined, null, prior]) {
    const html = renderPanel(workbook, true);
    assert.match(html, /Processando/);
    assert.match(html, /type="file"[^>]*disabled=""/);
    assert.doesNotMatch(html, /<select|Stale sheet|Confirmar mapeamento/);
  }
});

test("a real Excel reader result renders available sheet names and selected sheet samples", async () => {
  const excel = new Workbook();
  const sheet = excel.addWorksheet("Carteira 2026");
  sheet.addRow(["COD_INDORAMA", "Nome", "Orçamento aprovado"]);
  sheet.addRow(["00012", "Projeto da carteira", 1200]);
  excel.addWorksheet("Outra aba").addRow(["Observações"]);
  const file = new File([new Uint8Array(await excel.xlsx.writeBuffer())], "carteira.xlsx");
  const workbook = await readPortfolioWorkbook(await file.arrayBuffer(), file.name);
  assertPortfolioWorkbook(workbook);
  const html = renderPanel(workbook);
  assert.match(html, /<option[^>]*>Carteira 2026<\/option>/);
  assert.match(html, /<option[^>]*>Outra aba<\/option>/);
  assert.match(html, /Confirmar mapeamento e gerar prévia/);
  const selected = renderPanel(workbook, false, { ...mapping, sheet: "Carteira 2026" });
  assert.match(selected, /00012/);
  assert.match(selected, /Projeto da carteira/);
});

test("missing or malformed reader results produce a clear validation error before accessing sheets", () => {
  for (const value of [undefined, null, {}, { sheets: undefined }, { sheets: [] }]) {
    assert.throws(() => validatePortfolioMapping(value as unknown as PortfolioWorkbook, mapping), /Selecione um arquivo \.xlsx antes de mapear/);
    const html = renderPanel(value as unknown as PortfolioWorkbook);
    assert.match(html, /Selecione um arquivo Excel/);
    assert.doesNotMatch(html, /Confirmar mapeamento/);
  }
});

test("reader refuses to start without a file buffer and filename instead of throwing a property access error", async () => {
  await assert.rejects(readPortfolioWorkbook(undefined as unknown as ArrayBuffer, undefined as unknown as string), /Selecione um arquivo \.xlsx/);
});

test("closing and reopening clears old messages while preserving the exact selected File", () => {
  const file = new File(["invalid Excel"], "invalid.xlsx");
  let state = portfolioPanelReducer(initialPortfolioPanelState, { type: "toggle" });
  state = portfolioPanelReducer(state, { type: "select", file });
  state = portfolioPanelReducer(state, { type: "error", message: "Previous error" });
  state = portfolioPanelReducer(state, { type: "notice", message: "Previous notice" });
  state = portfolioPanelReducer(state, { type: "toggle" });
  assert.equal(state.open, false);
  assert.equal(state.error, "");
  assert.equal(state.notice, "");
  assert.equal(state.selectedFile, file);
  state = portfolioPanelReducer(state, { type: "error", message: "Stale error while closed" });
  state = portfolioPanelReducer(state, { type: "toggle" });
  assert.equal(state.open, true);
  assert.equal(state.error, "");
  assert.equal(state.selectedFile, file);
});

test("repeated opening without a file never invokes ExcelJS loading", (context) => {
  const excel = new Workbook();
  const load = context.mock.method(Object.getPrototypeOf(excel.xlsx), "load", () => { throw new Error("Unexpected Excel read"); });
  let state = initialPortfolioPanelState;
  for (let count = 0; count < 6; count++) {
    state = portfolioPanelReducer(state, { type: "toggle" });
    if (state.open) assert.match(renderPanel(null), /Selecione um arquivo Excel/);
    assert.equal(state.selectedFile, null);
    assert.equal(state.error, "");
  }
  assert.equal(load.mock.callCount(), 0);
});

test("a failed file remains visibly selected with a retry action after clearing the error", () => {
  const file = new File(["invalid"], "carteira-invalida.xlsx");
  let state = portfolioPanelReducer(initialPortfolioPanelState, { type: "select", file });
  state = portfolioPanelReducer(state, { type: "error", message: portfolioSelectionError(new TypeError("Cannot read properties of undefined (reading 'sheets')")) });
  assert.doesNotMatch(state.error, /Cannot read|undefined|TypeError/);
  state = portfolioPanelReducer(state, { type: "toggle" });
  assert.equal(state.error, "");
  const html = renderToStaticMarkup(createElement(PortfolioWorkbookPanel, { workbook: null, busy: false, mapping, selectedFileName: state.selectedFile!.name, onRetry: noAction, onFile: noAction, onMapping: noAction, onPrepare: noAction }));
  assert.match(html, /carteira-invalida.xlsx/);
  assert.match(html, /Tentar ler este arquivo novamente/);
  assert.match(html, /arquivo selecionado foi mantido/);
});
