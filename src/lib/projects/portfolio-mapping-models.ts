import { PORTFOLIO_FIELDS, REQUIRED_PORTFOLIO_FIELDS, validatePortfolioMapping, type PortfolioField, type PortfolioMapping } from "./portfolio-import";
import { normalizePortfolioHeader, portfolioHeaderColumns } from "./portfolio-headers";
import type { PortfolioWorkbook, PortfolioSheet } from "./portfolio-workbook";

export type PortfolioMappingModel = { id: string; name: string; sheet: string; headerRow: number; bindings: Partial<Record<PortfolioField, string>> };
const aliases: Record<PortfolioField, string[]> = {
  code: ["COD_INDORAMA", "Código Indorama", "Código do projeto Indorama"],
  name: ["Nome", "Nome do projeto", "Projeto", "Descrição do projeto"],
  approvedAmount: ["Orçamento aprovado", "Orçamento original aprovado", "Orçamento aprovado (R$)", "Orçamento original aprovado (R$)", "Valor aprovado"],
  unit: ["Unidade", "Unidade industrial"], department: ["Departamento"], type: ["Tipo", "Tipo do projeto"], category: ["Categoria"],
  owner: ["Gestor do projeto", "Responsável", "Owner", "Responsável (Owner)"], manager: ["Gerente", "Gerente do projeto"],
  start: ["Data inicial", "Data de início", "Início"], finish: ["Data final", "Data final planejada", "Data de término", "Término"],
  priority: ["Prioridade"], status: ["Status", "Status operacional", "Situação"], progress: ["Avanço físico", "Avanço físico (%)", "Progresso"],
};
const normalizedAliases = Object.fromEntries(Object.entries(aliases).map(([field, labels]) => [field, new Set(labels.map(normalizePortfolioHeader))])) as Record<PortfolioField, Set<string>>;

function candidateRows(sheet: PortfolioSheet, preferredRow?: number) {
  return sheet.rows.filter((row) => row.rowNumber <= 50 || row.rowNumber === preferredRow);
}

/** Capture a guard for the mapped columns; headerless/blank positional mappings remain available manually. */
export function guardPortfolioMapping(workbook: PortfolioWorkbook, mapping: PortfolioMapping): PortfolioMapping {
  const plain: PortfolioMapping = { sheet: mapping.sheet, headerRow: mapping.headerRow, columns: { ...mapping.columns } };
  const sheet = workbook.sheets.find((sheet) => sheet.name === mapping.sheet);
  if (!sheet || mapping.headerRow === 0 || !Object.keys(mapping.columns).length) return plain;
  const headers = portfolioHeaderColumns(sheet, mapping.headerRow);
  const expectedHeaders: PortfolioMapping["expectedHeaders"] = {};
  for (const [field, column] of Object.entries(mapping.columns)) {
    const cell = sheet.rows.find((row) => row.rowNumber === mapping.headerRow)?.cells[column!];
    if (cell?.issue || typeof cell?.value !== "string") return plain;
    const label = normalizePortfolioHeader(cell.value);
    if (!label || headers.get(label)?.length !== 1) return plain;
    expectedHeaders[field as PortfolioField] = label;
  }
  return { ...plain, expectedHeaders };
}

export function createPortfolioMappingModel(workbook: PortfolioWorkbook, mapping: PortfolioMapping, name: string, id: string): PortfolioMappingModel {
  validatePortfolioMapping(workbook, mapping);
  const guarded = guardPortfolioMapping(workbook, mapping);
  if (!name.trim() || name.trim().length > 80) throw new Error("Informe um nome para o modelo com até 80 caracteres.");
  if (!id.trim()) throw new Error("Identificador de modelo inválido.");
  if (!guarded.expectedHeaders) throw new Error("Para salvar um modelo, cada coluna mapeada deve ter um cabeçalho textual único. Arquivos sem cabeçalho continuam disponíveis no modo manual.");
  return { id, name: name.trim(), sheet: mapping.sheet, headerRow: mapping.headerRow, bindings: guarded.expectedHeaders };
}

/** Resolve by header identity, not saved column numbers. Reordered columns are safe; missing/duplicate labels are not. */
export function applyPortfolioMappingModel(workbook: PortfolioWorkbook, model: PortfolioMappingModel, location?: Pick<PortfolioMapping, "sheet" | "headerRow">): PortfolioMapping {
  const matches: PortfolioMapping[] = [];
  for (const sheet of workbook.sheets) {
    if (location && sheet.name !== location.sheet) continue;
    const rows = location ? sheet.rows.filter((row) => row.rowNumber === location.headerRow) : candidateRows(sheet, model.headerRow);
    for (const row of rows) {
      const headers = portfolioHeaderColumns(sheet, row.rowNumber);
      const columns: PortfolioMapping["columns"] = {};
      if (Object.entries(model.bindings).some(([field, label]) => {
        const indices = headers.get(label!);
        if (!indices || indices.length !== 1) return true;
        columns[field as PortfolioField] = indices[0]; return false;
      })) continue;
      const mapping = { sheet: sheet.name, headerRow: row.rowNumber, columns, expectedHeaders: { ...model.bindings } };
      try { validatePortfolioMapping(workbook, mapping); matches.push(mapping); } catch { /* A malformed/incomplete model must never become a valid import mapping. */ }
    }
  }
  if (matches.length === 0) throw new Error(`O modelo “${model.name}” não corresponde às colunas deste arquivo. Cabeçalhos ausentes, alterados ou repetidos exigem ajustes manuais.`);
  if (matches.length > 1) throw new Error(`O modelo “${model.name}” corresponde a mais de uma aba ou cabeçalho. Selecione a aba e a linha antes de aplicá-lo.`);
  return matches[0];
}

export function recognizePortfolioHeaders(workbook: PortfolioWorkbook): PortfolioMapping[] {
  const results: PortfolioMapping[] = [];
  for (const sheet of workbook.sheets) for (const row of candidateRows(sheet)) {
    const headers = portfolioHeaderColumns(sheet, row.rowNumber);
    const columns: PortfolioMapping["columns"] = {};
    const used = new Set<number>();
    for (const field of Object.keys(PORTFOLIO_FIELDS) as PortfolioField[]) {
      const indices = [...headers].filter(([label]) => normalizedAliases[field].has(label)).flatMap(([, indices]) => indices);
      if (indices.length === 1 && !used.has(indices[0])) { columns[field] = indices[0]; used.add(indices[0]); }
    }
    if (!REQUIRED_PORTFOLIO_FIELDS.every((field) => columns[field] !== undefined)) continue;
    const mapping = guardPortfolioMapping(workbook, { sheet: sheet.name, headerRow: row.rowNumber, columns });
    try { validatePortfolioMapping(workbook, mapping); results.push(mapping); } catch { /* Ambiguous headers require explicit manual mapping. */ }
  }
  return results;
}

export function suggestPortfolioMapping(workbook: PortfolioWorkbook, models: readonly PortfolioMappingModel[]): { mapping: PortfolioMapping | null; modelId: string; message: string } {
  const compatible: { model: PortfolioMappingModel; mapping: PortfolioMapping }[] = [];
  for (const model of models) {
    try { compatible.push({ model, mapping: applyPortfolioMappingModel(workbook, model) }); } catch { /* Incompatible or ambiguous models are not auto-applied. */ }
  }
  if (compatible.length === 1) return { mapping: compatible[0].mapping, modelId: compatible[0].model.id, message: `Modelo “${compatible[0].model.name}” aplicado. Revise o mapeamento e confirme a prévia antes de importar.` };
  if (compatible.length > 1) return { mapping: null, modelId: "", message: "Mais de um modelo é compatível. Escolha o modelo desejado antes de gerar a prévia." };
  const candidates = recognizePortfolioHeaders(workbook);
  if (candidates.length === 1) return { mapping: candidates[0], modelId: "", message: `${models.length ? "Nenhum modelo salvo foi aplicado. " : ""}Aba e cabeçalho reconhecidos automaticamente. Confira as colunas antes de gerar a prévia.` };
  return { mapping: null, modelId: "", message: candidates.length > 1 ? "Mais de uma aba ou cabeçalho foi reconhecido. Escolha manualmente a aba e a linha." : "Não foi possível reconhecer um cabeçalho completo. Selecione a aba, a linha e as colunas manualmente." };
}
