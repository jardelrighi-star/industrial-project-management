import { normalizeFinanceData } from "../finance/calculations";
import { parseBrlCents, parseExcelDate } from "../finance/import-values";
import type { FinanceData, ProjectBudget } from "../finance/types";
import type { Project } from "./types";
import { validateProjects } from "./validation";
import { assertPortfolioWorkbook, type PortfolioCell, type PortfolioWorkbook } from "./portfolio-workbook";
import { normalizePortfolioHeader, portfolioHeaderColumns } from "./portfolio-headers";

export const PORTFOLIO_FIELDS = {
  code: "COD_INDORAMA *", name: "Nome do projeto *", approvedAmount: "Orçamento original aprovado (R$) *",
  unit: "Unidade", department: "Departamento", type: "Tipo", category: "Categoria", owner: "Responsável", manager: "Gerente",
  start: "Data inicial", finish: "Data final", priority: "Prioridade", status: "Status operacional", progress: "Avanço físico (0 a 100)",
} as const;
export type PortfolioField = keyof typeof PORTFOLIO_FIELDS;
export const REQUIRED_PORTFOLIO_FIELDS = ["code", "name", "approvedAmount"] as const;
export type PortfolioMapping = { sheet: string; headerRow: number; columns: Partial<Record<PortfolioField, number>>; expectedHeaders?: Partial<Record<PortfolioField, string>> };
export type PortfolioStatus = "new" | "existing" | "duplicate" | "invalid";
export type PortfolioRow = { rowNumber: number; code: string; name: string; status: PortfolioStatus; reason: string; project?: Project; budget?: ProjectBudget };
export type PortfolioSnapshot = { projects: Project[]; finance: FinanceData };
export type PortfolioPreview = { workbook: PortfolioWorkbook; mapping: PortfolioMapping; baseline: PortfolioSnapshot; rows: PortfolioRow[] };
export type PortfolioReport = { imported: PortfolioRow[]; notImported: PortfolioRow[]; recoveryPending: boolean };

export function validatePortfolioMapping(workbook: PortfolioWorkbook, mapping: PortfolioMapping) {
  assertPortfolioWorkbook(workbook);
  const sheet = workbook.sheets.find((item) => item.name === mapping.sheet);
  if (!sheet || !Number.isSafeInteger(mapping.headerRow) || mapping.headerRow < 0 || (mapping.headerRow !== 0 && !sheet.rows.some((r) => r.rowNumber === mapping.headerRow))) throw new Error("Selecione uma aba e uma linha de cabeçalho existentes (0 para arquivo sem cabeçalho).");
  for (const field of REQUIRED_PORTFOLIO_FIELDS) {
    if (mapping.columns[field] === undefined) throw new Error(`Mapeamento obrigatório ausente: ${PORTFOLIO_FIELDS[field]}.`);
  }
  const used = new Set<number>();
  for (const [field, column] of Object.entries(mapping.columns)) {
    if (!Object.hasOwn(PORTFOLIO_FIELDS, field) || !Number.isInteger(column) || column! < 1 || column! > sheet.columnCount || used.has(column!)) throw new Error("Mapeamento inválido: cada campo deve usar uma coluna diferente e existente.");
    used.add(column!);
  }
  if (mapping.expectedHeaders) {
    if (mapping.headerRow === 0) throw new Error("Modelos de cabeçalho não podem ser aplicados a arquivos sem cabeçalho.");
    const headers = portfolioHeaderColumns(sheet, mapping.headerRow);
    for (const [field, column] of Object.entries(mapping.columns)) {
      const expected = mapping.expectedHeaders[field as PortfolioField];
      const cell = sheet.rows.find((row) => row.rowNumber === mapping.headerRow)?.cells[column!];
      if (!expected || cell?.issue || typeof cell?.value !== "string" || normalizePortfolioHeader(cell.value) !== expected || headers.get(expected)?.length !== 1) {
        throw new Error(`O mapeamento não corresponde ao cabeçalho do arquivo: ${PORTFOLIO_FIELDS[field as PortfolioField]}. Revise as colunas e gere outra prévia.`);
      }
    }
  }
  return sheet;
}

function text(cell?: PortfolioCell): string {
  if (cell?.issue) throw new Error(cell.issue);
  if (cell?.value === null || cell?.value === undefined) return "";
  if (typeof cell.value !== "string" && typeof cell.value !== "number") throw new Error("Campo textual inválido.");
  return String(cell.value).trim();
}
function code(cell?: PortfolioCell): string {
  if (cell?.issue) throw new Error(cell.issue);
  if (cell?.notIdentifier) throw new Error("COD_INDORAMA foi lido como data; exporte o código original como texto.");
  const value = typeof cell?.value === "string" ? cell.value : cell?.codeText;
  if (!value) throw new Error("COD_INDORAMA obrigatório: use texto ou máscara numérica explícita de zeros; números sem máscara não preservam a identidade.");
  if (value !== value.trim() || value !== value.toUpperCase()) throw new Error("COD_INDORAMA incompatível: espaços externos ou letras minúsculas. O código não será transformado.");
  return value;
}

/** Pure preview: only genuinely new codes can produce project/budget candidates. */
export function previewPortfolioImport(workbook: PortfolioWorkbook, mapping: PortfolioMapping, snapshot: PortfolioSnapshot): PortfolioPreview {
  const sheet = validatePortfolioMapping(workbook, mapping);
  validateProjects(snapshot.projects);
  const finance = normalizeFinanceData(snapshot.finance);
  const existing = new Set(snapshot.projects.map((p) => p.code));
  const financialCodes = new Set([...finance.budgets, ...finance.adjustments, ...finance.requisitions, ...finance.orders, ...finance.actualCosts].map((b) => b.projectCode));
  const rows: PortfolioRow[] = [];
  for (const row of sheet.rows) {
    if (row.rowNumber <= mapping.headerRow) continue;
    const get = (field: PortfolioField) => mapping.columns[field] === undefined ? undefined : row.cells[mapping.columns[field]!];
    if (Object.keys(mapping.columns).every((field) => {
      const cell = get(field as PortfolioField); return !cell?.issue && (cell?.value === undefined || cell.value === null || cell.value === "");
    })) continue;
    const result: PortfolioRow = { rowNumber: row.rowNumber, code: "", name: "", status: "invalid", reason: "" };
    // Recover identity before validating other fields, so even an invalid repeated row blocks the whole code.
    try {
      const raw = get("code");
      result.code = typeof raw?.value === "string" ? raw.value : raw?.codeText ?? (raw?.value == null ? "" : String(raw.value));
      try { result.name = text(get("name")); } catch { /* Existing projects are skipped in full, even with invalid mapped values. */ }
      if (existing.has(result.code)) {
        if (!result.name) result.name = snapshot.projects.find((p) => p.code === result.code)!.name;
        result.status = "existing"; result.reason = "Projeto já cadastrado: cadastro e orçamento ignorados integralmente.";
      }
      else {
        const projectCode = code(raw);
        if (snapshot.projects.some((p) => p.code.toUpperCase() === projectCode)) throw new Error("Código conflita com cadastro legado de capitalização diferente; nenhuma alteração realizada.");
        if (financialCodes.has(projectCode)) throw new Error("Já existem vínculos financeiros para este código sem cadastro; requer reconciliação, sem sobrescrita.");
        const name = text(get("name"));
        if (!name) throw new Error("Nome do projeto obrigatório.");
        const amountCell = get("approvedAmount");
        if (amountCell?.issue) throw new Error(amountCell.issue);
        const amount = parseBrlCents(amountCell?.value);
        if (amount < 0) throw new Error("Orçamento aprovado não pode ser negativo.");
        const startValue = get("start"), finishValue = get("finish");
        if (startValue?.issue || finishValue?.issue) throw new Error(startValue?.issue ?? finishValue?.issue);
        const date = (cell?: PortfolioCell) => cell?.value == null || cell.value === "" ? "" : parseExcelDate(cell.value, workbook.date1904);
        const start = date(startValue), finish = date(finishValue);
        if (start && finish && finish < start) throw new Error("Data final anterior à inicial.");
        const progressText = text(get("progress"));
        const progress = progressText === "" ? 0 : Number(progressText.replace(",", "."));
        if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error("Avanço físico deve estar entre 0 e 100.");
        const project: Project = { code: projectCode, name, budget: 0, start, finish, progress,
          unit: text(get("unit")), department: text(get("department")), type: text(get("type")), category: text(get("category")), owner: text(get("owner")), manager: text(get("manager")), priority: text(get("priority")), status: text(get("status")) || "Planejado",
          executionAuthorization: { status: "pending", date: null, externalReference: null },
        };
        validateProjects([project]);
        result.name = name; result.project = project;
        result.budget = { projectCode, originalApprovedAmount: amount, updatedAmount: amount };
        result.status = "new"; result.reason = "Novo projeto; orçamento aprovado na camada financeira e autorização de execução pendente.";
      }
    } catch (cause) { result.reason = cause instanceof Error ? cause.message : "Linha inválida."; }
    rows.push(result);
  }
  const counts = new Map<string, number>();
  for (const row of rows) if (row.code) counts.set(row.code, (counts.get(row.code) ?? 0) + 1);
  for (const row of rows) if (row.code && counts.get(row.code)! > 1) {
    row.status = "duplicate"; row.reason = "COD_INDORAMA repetido na planilha: todas as ocorrências foram bloqueadas.";
    delete row.project; delete row.budget;
  }
  return JSON.parse(JSON.stringify({ workbook, mapping, baseline: { projects: snapshot.projects, finance }, rows })) as PortfolioPreview;
}
