import type { PortfolioSheet } from "./portfolio-workbook";

/** Normalize labels only. Project identifiers and cell data must never pass through this function. */
export function normalizePortfolioHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function portfolioHeaderColumns(sheet: PortfolioSheet, rowNumber: number): Map<string, number[]> {
  const result = new Map<string, number[]>();
  const row = sheet.rows.find((item) => item.rowNumber === rowNumber);
  for (const [column, cell] of Object.entries(row?.cells ?? {})) {
    if (cell.issue || typeof cell.value !== "string") continue;
    const label = normalizePortfolioHeader(cell.value);
    if (label) result.set(label, [...result.get(label) ?? [], Number(column)]);
  }
  return result;
}
