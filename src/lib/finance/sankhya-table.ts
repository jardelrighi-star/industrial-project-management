import type { CellValue } from "exceljs";
import { isSankhyaExportFooter, loadSankhyaSheet, SANKHYA_EXPORT_SHEET } from "./sankhya-workbook";

export type SankhyaTableRow = { rowNumber: number; values: Record<string, unknown>; cachedFormulaCount: number; issue?: string };
export type SankhyaTable = { sourceFile: string; sourceSheet?: string; rows: SankhyaTableRow[] };

/** Uses saved formula results only; Excel formulas are never executed. */
export async function readSankhyaTable(buffer: ArrayBuffer, sourceFile: string, sheetName: string, legacyHeaders: readonly string[], { detectHeader = false, exportHeaders, exportIdentity }: { detectHeader?: boolean; exportHeaders?: readonly string[]; exportIdentity?: string } = {}): Promise<SankhyaTable> {
  const { sheet } = await loadSankhyaSheet(buffer, sheetName);
  const directExport = sheet.name === SANKHYA_EXPORT_SHEET;
  const headers = directExport && exportHeaders ? exportHeaders : legacyHeaders;
  const scalar = (value: CellValue, onFormula: () => void): unknown => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("formula" in value || "sharedFormula" in value) {
        onFormula();
        if (value.result === undefined || value.result === null) throw new Error("Fórmula sem resultado salvo; recalcule e salve o Excel.");
        return scalar(value.result, () => { throw new Error("Resultado de fórmula inválido."); });
      }
      if ("error" in value) throw new Error("Célula com erro; corrija e salve o Excel.");
      if ("richText" in value) return value.richText.map((part) => part.text).join("");
      if ("text" in value) return value.text;
      throw new Error("Tipo de célula não suportado.");
    }
    return value;
  };
  function readHeader(rowNumber: number) {
    const columns = new Map<string, number>();
    const unreadableHeaders: string[] = [];
    let duplicate: string | undefined;
    sheet.getRow(rowNumber).eachCell((cell, column) => {
      let name: string;
      try {
        name = String(scalar(cell.value, () => {}) ?? "").trim();
      } catch {
        unreadableHeaders.push(cell.address);
        return;
      }
      if (!headers.includes(name)) return;
      if (columns.has(name)) duplicate ??= name;
      columns.set(name, column);
    });
    return { rowNumber, columns, unreadableHeaders, duplicate };
  }
  let header = readHeader(3);
  if (detectHeader && header.columns.size < headers.length) {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber++) {
      if (rowNumber === 3) continue;
      const candidate = readHeader(rowNumber);
      if (candidate.columns.size > header.columns.size) header = candidate;
      if (header.columns.size === headers.length) break;
    }
  }
  const { rowNumber: headerRow, columns, unreadableHeaders, duplicate } = header;
  if (duplicate) throw new Error(`Cabeçalho duplicado: ${duplicate}`);
  const missing = headers.filter((name) => !columns.has(name));
  if (missing.length) {
    const hint = unreadableHeaders.length
      ? ` Confira as células ${unreadableHeaders.join(", ")}. Para fórmulas, recalcule e salve o arquivo no Excel.`
      : "";
    const location = detectHeader && !columns.size ? "nas primeiras 30 linhas" : `na linha ${headerRow}`;
    throw new Error(`Cabeçalho incompleto ${location} da aba ${sheet.name}. Colunas obrigatórias ausentes: ${missing.join(", ")}.${hint}`);
  }
  const rows: SankhyaTableRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    if (directExport && exportIdentity && isSankhyaExportFooter(sheet, row, columns.get(exportIdentity)!)) return;
    if (headers.every((name) => row.getCell(columns.get(name)!).value === null)) return;
    const source: SankhyaTableRow = { rowNumber, values: {}, cachedFormulaCount: 0 };
    for (const name of headers) {
      try { source.values[name] = scalar(row.getCell(columns.get(name)!).value, () => source.cachedFormulaCount++); }
      catch (cause) { source.issue = `${name}: ${cause instanceof Error ? cause.message : "Célula inválida."}`; }
    }
    rows.push(source);
  });
  return { sourceFile, sourceSheet: sheet.name, rows };
}
