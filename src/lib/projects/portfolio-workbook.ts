import { PortfolioWorkbookReadError, PORTFOLIO_READ_FAILURE } from "./portfolio-workbook-errors";
export { PortfolioWorkbookReadError, PORTFOLIO_READ_FAILURE } from "./portfolio-workbook-errors";

export type PortfolioCell = { value: string | number | boolean | null; codeText?: string; notIdentifier?: boolean; issue?: string };
export type PortfolioSheet = { name: string; rows: { rowNumber: number; cells: Record<number, PortfolioCell> }[]; columnCount: number };
export type PortfolioWorkbook = { sourceFile: string; date1904: boolean; sheets: PortfolioSheet[] };

/** Guard the reader/UI boundary before any state is allowed to expose sheet selectors. */
export function assertPortfolioWorkbook(value: unknown): asserts value is PortfolioWorkbook {
  if (!value || typeof value !== "object" || !("sheets" in value) || !Array.isArray(value.sheets) || !value.sheets.length
    || !("sourceFile" in value) || typeof value.sourceFile !== "string" || !("date1904" in value) || typeof value.date1904 !== "boolean"
    || value.sheets.some((sheet) => !sheet || typeof sheet.name !== "string" || !Array.isArray(sheet.rows) || !Number.isInteger(sheet.columnCount) || sheet.columnCount < 0)) {
    throw new Error("Nenhuma carteira Excel válida foi carregada. Selecione um arquivo .xlsx antes de mapear suas abas.");
  }
}

/** No layout assumptions: preserve sheet names, row numbers and column positions for explicit mapping. */
async function decodePortfolioWorkbook(buffer: ArrayBuffer, sourceFile: string): Promise<PortfolioWorkbook> {
  if (!buffer || typeof buffer.byteLength !== "number" || typeof sourceFile !== "string") throw new PortfolioWorkbookReadError("Selecione um arquivo .xlsx antes de iniciar a leitura.");
  if (!sourceFile.toLowerCase().endsWith(".xlsx")) throw new PortfolioWorkbookReadError("Selecione um arquivo .xlsx.");
  if (buffer.byteLength > 30 * 1024 * 1024) throw new PortfolioWorkbookReadError("Arquivo acima de 30 MB.");
  const { normalizePortfolioWorkbookZip } = await import("./portfolio-xml-normalization");
  const prepared = await normalizePortfolioWorkbookZip(buffer);
  const { loadPortfolioExcelWorkbook } = await import("./portfolio-exceljs-compatibility");
  const workbook = await loadPortfolioExcelWorkbook(prepared);
  if (!workbook.worksheets.length || workbook.worksheets.length > 20) throw new PortfolioWorkbookReadError("O arquivo deve ter entre 1 e 20 abas.");
  let totalRows = 0;
  const sheets = workbook.worksheets.map((sheet): PortfolioSheet => {
    totalRows += sheet.rowCount;
    if (totalRows > 20000 || sheet.columnCount > 200) throw new PortfolioWorkbookReadError("Limite de 20 mil linhas no arquivo e 200 colunas por aba.");
    const rows: PortfolioSheet["rows"] = [];
    sheet.eachRow((row, rowNumber) => {
      const cells: Record<number, PortfolioCell> = {};
      row.eachCell((cell, column) => {
        const value = cell.value;
        if (cell.isMerged && cell.master.address !== cell.address) {
          cells[column] = { value: null, issue: "Célula mesclada; use valores individuais." };
        } else if (value instanceof Date) {
          cells[column] = Number.isFinite(value.getTime()) ? { value: value.toISOString().slice(0, 10), notIdentifier: true } : { value: null, issue: "Data inválida." };
        } else if (value && typeof value === "object") {
          if ("formula" in value || "sharedFormula" in value || "error" in value) cells[column] = { value: null, issue: "Fórmula ou erro: exporte os valores calculados." };
          else if ("richText" in value) cells[column] = { value: value.richText.map((part) => part.text).join("") };
          else if ("text" in value) cells[column] = { value: value.text };
          else cells[column] = { value: null, issue: "Tipo de célula não suportado." };
        } else {
          cells[column] = { value: value ?? null };
          // Numeric identifiers are safe only with an explicit zero-padding mask.
          if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && /^0+$/.test(cell.numFmt)) {
            cells[column].codeText = String(value).padStart(cell.numFmt.length, "0");
          }
        }
      });
      rows.push({ rowNumber, cells });
    });
    return { name: sheet.name, rows, columnCount: sheet.columnCount };
  });
  const result = { sourceFile, date1904: !!workbook.properties.date1904, sheets };
  assertPortfolioWorkbook(result);
  return result;
}

export async function readPortfolioWorkbook(buffer: ArrayBuffer, sourceFile: string): Promise<PortfolioWorkbook> {
  try { return await decodePortfolioWorkbook(buffer, sourceFile); }
  catch (cause) {
    if (process.env.NODE_ENV === "development") console.error("[Carteira de Projetos] Falha na leitura do Excel", { sourceFile, cause: cause instanceof PortfolioWorkbookReadError && cause.cause ? cause.cause : cause });
    if (cause instanceof PortfolioWorkbookReadError) throw cause;
    throw new PortfolioWorkbookReadError(PORTFOLIO_READ_FAILURE, { cause });
  }
}
