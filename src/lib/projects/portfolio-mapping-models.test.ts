import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { applyPortfolioMappingModel, createPortfolioMappingModel, recognizePortfolioHeaders, suggestPortfolioMapping } from "./portfolio-mapping-models";
import { LocalStoragePortfolioModelRepository, PORTFOLIO_MODELS_KEY } from "./portfolio-model-repository";
import { previewPortfolioImport, validatePortfolioMapping } from "./portfolio-import";
import { emptyFinanceData } from "../finance/calculations";
import { readPortfolioWorkbook, type PortfolioWorkbook } from "./portfolio-workbook";
import { PortfolioImportRepository } from "./portfolio-repository";

function workbook(headers = ["COD_INDORAMA", "Nome do projeto", "Orçamento aprovado", "Responsável"], rowNumber = 1, sheet = "Carteira CAPEX"): PortfolioWorkbook {
  return { sourceFile: "carteira.xlsx", date1904: false, sheets: [{ name: sheet, columnCount: headers.length, rows: [
    { rowNumber, cells: Object.fromEntries(headers.map((value, i) => [i + 1, { value }])) },
    { rowNumber: rowNumber + 1, cells: { 1: { value: "0001" }, 2: { value: "Projeto" }, 3: { value: 100 }, 4: { value: "Pessoa" } } },
  ] }] };
}
function savedModel() {
  const data = workbook();
  return createPortfolioMappingModel(data, recognizePortfolioHeaders(data)[0], "Carteira da unidade", "model-1");
}
function storage() {
  const entries = new Map<string, string>();
  const writes: string[] = [];
  let failure = false;
  const port = () => ({ getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { if (failure) throw new Error("Quota"); writes.push(key); entries.set(key, value); } });
  return { entries, writes, repository: new LocalStoragePortfolioModelRepository(port), importRepository: new PortfolioImportRepository(port), fail: (value: boolean) => { failure = value; } };
}

test("automatic recognition finds required and optional aliases, header row and worksheet without writes", () => {
  const file = workbook(undefined, 4);
  const before = JSON.stringify(file);
  const suggestion = suggestPortfolioMapping(file, []);
  assert.equal(suggestion.mapping?.sheet, "Carteira CAPEX");
  assert.equal(suggestion.mapping?.headerRow, 4);
  assert.deepEqual(suggestion.mapping?.columns, { code: 1, name: 2, approvedAmount: 3, owner: 4 });
  assert.equal(suggestion.mapping?.expectedHeaders?.approvedAmount, "orcamento aprovado");
  assert.equal(JSON.stringify(file), before);
});

test("saved model is reusable after reload and stores only mapping metadata in a separate key", async () => {
  const s = storage();
  s.entries.set("industrial-projects", "unchanged cadastral bytes");
  s.entries.set("industrial-project-finance:v1", "unchanged financial bytes");
  assert.deepEqual(await s.repository.load(), []);
  assert.deepEqual(s.writes, []);
  await s.repository.add(savedModel());
  const models = await s.repository.load();
  assert.equal(models[0].name, "Carteira da unidade");
  const suggestion = suggestPortfolioMapping(workbook(), models);
  assert.equal(suggestion.modelId, "model-1");
  assert.equal(suggestion.mapping?.columns.code, 1);
  assert.deepEqual(s.writes, [PORTFOLIO_MODELS_KEY]);
  assert.equal(s.entries.get("industrial-projects"), "unchanged cadastral bytes");
  assert.equal(s.entries.get("industrial-project-finance:v1"), "unchanged financial bytes");
});

test("reordered columns resolve by header identity instead of reusing old column numbers", () => {
  const changed = workbook(["Responsável", "Orçamento aprovado", "COD_INDORAMA", "Nome do projeto"], 3, "Nova aba");
  const mapping = applyPortfolioMappingModel(changed, savedModel());
  assert.deepEqual(mapping.columns, { code: 3, name: 4, approvedAmount: 2, owner: 1 });
  assert.equal(mapping.headerRow, 3);
  assert.equal(mapping.sheet, "Nova aba");
});

test("a user-defined model recognizes custom headers that are outside the automatic alias list", () => {
  const original = workbook(["Referência interna", "Título cadastral", "Verba liberada", "Contato técnico"]);
  assert.equal(recognizePortfolioHeaders(original).length, 0);
  const model = createPortfolioMappingModel(original, { sheet: "Carteira CAPEX", headerRow: 1, columns: { code: 1, name: 2, approvedAmount: 3, owner: 4 } }, "Layout personalizado", "custom");
  const next = workbook(["Contato técnico", "Título cadastral", "Referência interna", "Verba liberada"]);
  const suggestion = suggestPortfolioMapping(next, [model]);
  assert.equal(suggestion.modelId, "custom");
  assert.deepEqual(suggestion.mapping?.columns, { code: 3, name: 2, approvedAmount: 4, owner: 1 });
});

test("cosmetic case, accents and punctuation are compatible without altering cell data or project codes", () => {
  const changed = workbook(["cod indorama", " NOME DO PROJETO ", "ORCAMENTO APROVADO", "Responsavel"]);
  const before = JSON.stringify(changed);
  const mapping = applyPortfolioMappingModel(changed, savedModel());
  assert.equal(mapping.columns.approvedAmount, 3);
  assert.equal(JSON.stringify(changed), before);
});

test("renamed, missing or duplicate mapped headers invalidate the whole model, including optional fields", () => {
  for (const headers of [
    ["COD_INDORAMA", "Nome do projeto", "Realizado", "Responsável"],
    ["COD_INDORAMA", "Nome do projeto", "Orçamento aprovado"],
    ["COD_INDORAMA", "Nome do projeto", "Orçamento aprovado", "Responsável", "Nome do projeto"],
  ]) assert.throws(() => applyPortfolioMappingModel(workbook(headers), savedModel()), /não corresponde/);
});

test("extra unmapped columns are allowed, but missing required mappings cannot become saved models", () => {
  assert.equal(applyPortfolioMappingModel(workbook(["COD_INDORAMA", "Nome do projeto", "Orçamento aprovado", "Responsável", "Observações"]), savedModel()).columns.code, 1);
  assert.throws(() => createPortfolioMappingModel(workbook(), { sheet: "Carteira CAPEX", headerRow: 1, columns: { code: 1, name: 2 } }, "Incomplete", "id"), /obrigatório/);
  assert.throws(() => createPortfolioMappingModel(workbook(), { sheet: "Carteira CAPEX", headerRow: 0, columns: { code: 1, name: 2, approvedAmount: 3 } }, "No header", "id"), /cabeçalho/);
});

test("ambiguous worksheet/header choices never cause automatic model application", () => {
  const file = workbook();
  file.sheets.push({ ...structuredClone(file.sheets[0]), name: "Outra carteira" });
  assert.equal(suggestPortfolioMapping(file, [savedModel()]).mapping, null);
  assert.throws(() => applyPortfolioMappingModel(file, savedModel()), /mais de uma/);
  assert.equal(applyPortfolioMappingModel(file, savedModel(), { sheet: "Outra carteira", headerRow: 1 }).sheet, "Outra carteira");
  assert.equal(suggestPortfolioMapping(workbook(), [savedModel(), { ...savedModel(), id: "model-2", name: "Segundo modelo" }]).mapping, null);
});

test("duplicate or ambiguous required aliases are not auto-guessed", () => {
  assert.deepEqual(recognizePortfolioHeaders(workbook(["COD_INDORAMA", "Nome do projeto", "Orçamento aprovado", "Valor aprovado"])), []);
  assert.deepEqual(recognizePortfolioHeaders(workbook(["COD_INDORAMA", "Nome do projeto", "Orçamento aprovado", "COD_INDORAMA"])), []);
});

test("other Sankhya identifiers and generic project-code headers are never guessed as COD_INDORAMA", () => {
  for (const header of ["CODPROJ", "AD_PROJ_IHBL", "Código do projeto", "Código Sankhya"]) {
    assert.deepEqual(recognizePortfolioHeaders(workbook([header, "Nome do projeto", "Orçamento aprovado"])), []);
  }
});

test("preview and confirmation reject a stale header guard before any project or financial write", async () => {
  const s = storage();
  const file = workbook();
  const mapping = applyPortfolioMappingModel(file, savedModel());
  const preview = previewPortfolioImport(file, mapping, { projects: [], finance: emptyFinanceData() });
  preview.workbook.sheets[0].rows[0].cells[3].value = "Custo realizado";
  assert.throws(() => validatePortfolioMapping(preview.workbook, preview.mapping), /não corresponde/);
  await assert.rejects(s.importRepository.confirm(preview), /não corresponde/);
  assert.deepEqual(s.writes, []);
});

test("invalid stored templates remain intact and do not seed replacements", async () => {
  for (const value of ["{broken", "{}", JSON.stringify({ version: 1, models: [{ ...savedModel(), bindings: { code: "cod indorama" } }] }), JSON.stringify({ version: 2, models: [] })]) {
    const s = storage(); s.entries.set(PORTFOLIO_MODELS_KEY, value);
    await assert.rejects(s.repository.load(), /preservados/);
    await assert.rejects(s.repository.add(savedModel()), /preservados/);
    assert.equal(s.entries.get(PORTFOLIO_MODELS_KEY), value);
    assert.deepEqual(s.writes, []);
  }
});

test("duplicate names, quota failures and concurrent saves preserve previously stored models", async () => {
  const s = storage();
  await s.repository.add(savedModel());
  const before = s.entries.get(PORTFOLIO_MODELS_KEY);
  await assert.rejects(s.repository.add({ ...savedModel(), id: "other" }), /Já existe/);
  s.fail(true);
  await assert.rejects(s.repository.add({ ...savedModel(), id: "second", name: "Segundo" }), /preservados/);
  assert.equal(s.entries.get(PORTFOLIO_MODELS_KEY), before);
  s.fail(false);
  await Promise.all([s.repository.add({ ...savedModel(), id: "second", name: "Segundo" }), s.repository.add({ ...savedModel(), id: "third", name: "Terceiro" })]);
  assert.equal((await s.repository.load()).length, 3);
});

test("reference workbook is recognized and its model can be reused without importing projects", { skip: !existsSync("references/carteira_capex_ficticia_teste.xlsx") }, async () => {
  const data = await readPortfolioWorkbook(Uint8Array.from(readFileSync("references/carteira_capex_ficticia_teste.xlsx")).buffer, "carteira_capex_ficticia_teste.xlsx");
  const suggestion = suggestPortfolioMapping(data, []);
  assert.equal(suggestion.mapping?.sheet, "Carteira CAPEX");
  assert.equal(suggestion.mapping?.headerRow, 1);
  assert.equal(Object.keys(suggestion.mapping!.columns).length, 13);
  const s = storage();
  await s.repository.add(createPortfolioMappingModel(data, suggestion.mapping!, "CAPEX de teste", "fixture"));
  const reused = suggestPortfolioMapping(structuredClone(data), await s.repository.load());
  assert.equal(reused.modelId, "fixture");
  assert.equal(previewPortfolioImport(data, reused.mapping!, { projects: [], finance: emptyFinanceData() }).rows.filter((row) => row.status === "new").length, 10);
  assert.deepEqual(s.writes, [PORTFOLIO_MODELS_KEY]);
});
