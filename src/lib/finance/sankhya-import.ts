import { costReportFields, readReportFields } from "./sankhya-report-fields";
import type { ActualCost, FinanceData } from "./types";
import type { FinanceRepository } from "./repository";
import { normalizeFinanceData } from "./calculations";
import { parseBrlCents, parseExcelDate } from "./import-values";
import { reconcileActualCostReviews } from "./actual-cost-review";

export const COST_SHEET = "EXPORTAÇÃO DE CUSTOS";
export const COST_HEADERS = ["COD_INDORAMA", "VLRTOT", "NUMNOTA", "NOMEPARC", "DTENTSAI", "DESCRPROD", "DESCRATIVO", "NUNOTA", "ANO_PROJETO", "CODPROJ", "AD_PROJ_IHBL", "CODEMP", "CODPROD", "CODCENCUS", "CODTIPOPER", "CODPARC", "IDENTIFICACAO", "COD_GRUPO_CONS", "COD_GRUPO_IMOB"] as const;
export type CostSourceRow = { rowNumber: number; values: Record<string, unknown> };
export type CostWorkbook = { rows: CostSourceRow[]; sourceFile: string; sourceSheet?: string; date1904: boolean; projectField?: "AD_PROJ_IHBL" | "COD_INDORAMA" };
export type ImportRow = {
  rowNumber: number; projectCode: string; document: string; supplier: string;
  amount: number | null; status: "ready" | "invalid";
  message: string; cost?: ActualCost;
};
export type CostImportPreview = {
  workbook: CostWorkbook; rows: ImportRow[]; baseline: string;
  readyCount: number; previousCount: number; issueCount: number;
  readyTotal: number; readTotal: number;
};
const string = (value: unknown): string => value === null || value === undefined ? "" : String(value).trim();
const identity = (parts: string[]) => JSON.stringify(parts);

/** Ignore import-session metadata when comparing source business content. */
function content(cost: ActualCost): string {
  const source = cost.sankhya;
  return JSON.stringify([
    cost.transactionId, cost.projectCode, cost.fiscalDocument, cost.documentEntryId,
    cost.reportFields, cost.date, cost.amount, cost.supplier, cost.description ?? "", cost.assetDescription ?? "",
    source ? [source.internalNoteId, source.projectYear, source.codproj, source.adProjIhbl,
      source.companyCode, source.productCode, source.partnerCode, source.costCenterCode,
      source.operationCode, source.identification] : null,
  ]);
}
function safeSum(values: number[]) {
  let sum = 0;
  for (const value of values) {
    sum += value;
    if (!Number.isSafeInteger(sum)) throw new Error("Total da importação fora do limite suportado");
  }
  return sum;
}

/** Associates costs with registered projects using the source layout's project column. */
export function previewCostImport(workbook: CostWorkbook, registeredProjectCodes: readonly string[], existing: FinanceData, recordedAt: string): CostImportPreview {
  const current = normalizeFinanceData(existing);
  const projects = new Set(registeredProjectCodes);
  const projectField = workbook.projectField ?? "COD_INDORAMA";
  const rows: ImportRow[] = workbook.rows.map(({ rowNumber, values: v }) => {
    const row: ImportRow = { rowNumber, projectCode: string(v[projectField]), document: string(v.NUMNOTA), supplier: string(v.NOMEPARC), amount: null, status: "invalid", message: "" };
    try {
      row.amount = parseBrlCents(v.VLRTOT);
      if (row.amount < 0) throw new Error("Valor negativo requer reconciliação; o modelo atual não aceita estornos");
      if (!row.projectCode || /^0+$/.test(row.projectCode) || !projects.has(row.projectCode)) throw new Error(`${projectField} sem projeto cadastrado correspondente`);
      if (row.projectCode !== row.projectCode.toUpperCase()) throw new Error("Código de projeto não canônico");
      const nunota = string(v.NUNOTA);
      const company = string(v.CODEMP);
      const product = string(v.CODPROD);
      if (!nunota || !company || !product || !row.document) throw new Error("CODEMP, NUNOTA, CODPROD e NUMNOTA são obrigatórios");
      const lineKey = identity(["sankhya-cost-snapshot-v1", String(rowNumber)]);
      const reportFields = readReportFields(costReportFields, [v], workbook.date1904);
      const cost: ActualCost = {
        ...(reportFields ? { reportFields } : {}),
        transactionId: lineKey, documentEntryId: lineKey, projectCode: row.projectCode,
        fiscalDocument: row.document, supplier: row.supplier, description: string(v.DESCRPROD), assetDescription: string(v.DESCRATIVO),
        date: parseExcelDate(v.DTENTSAI, workbook.date1904), amount: row.amount,
        sankhya: { internalNoteId: nunota, projectYear: string(v.ANO_PROJETO), codproj: string(v.CODPROJ), adProjIhbl: string(v.AD_PROJ_IHBL),
          companyCode: company, productCode: product, partnerCode: string(v.CODPARC), costCenterCode: string(v.CODCENCUS), operationCode: string(v.CODTIPOPER), identification: string(v.IDENTIFICACAO),
          sourceFile: workbook.sourceFile, sourceSheet: workbook.sourceSheet ?? COST_SHEET, sourceRow: rowNumber },
        traceability: { sourceSystem: "Sankhya", sourceRecordId: lineKey, recordedAt, externalReference: identity([company, nunota]) },
      };
      row.cost = cost;
      row.status = "ready";
      row.message = "Pronto para importar";
    } catch (error) { row.message = error instanceof Error ? error.message : "Registro inválido"; }
    return row;
  });
  return { workbook, rows, baseline: JSON.stringify(current),
    readyCount: rows.filter((r) => r.status === "ready").length,
    previousCount: current.actualCosts.length,
    issueCount: rows.filter((r) => r.status === "invalid").length,
    readyTotal: safeSum(rows.filter((r) => r.status === "ready").map((r) => r.amount!)),
    readTotal: safeSum(rows.filter((r) => r.amount !== null).map((r) => r.amount!)),
  };
}

/** Call only from explicit confirmation. Rechecks storage before any write. */
export async function confirmCostImport(preview: CostImportPreview, projectCodes: readonly string[], repository: FinanceRepository): Promise<{ saved: boolean; preview: CostImportPreview }> {
  const existing = await repository.load();
  const refreshed = previewCostImport(preview.workbook, projectCodes, existing, new Date().toISOString());
  const decisions = (p: CostImportPreview) => JSON.stringify(p.rows.map((r) => [r.rowNumber, r.status, r.cost ? content(r.cost) : null]));
  if (refreshed.baseline !== preview.baseline || decisions(refreshed) !== decisions(preview)) return { saved: false, preview: refreshed };
  const costs = refreshed.rows.filter((r) => r.status === "ready").map((r) => r.cost!);
  if (!costs.length) return { saved: false, preview: refreshed };
  // Preserve every other collection exactly: no project/budget/SC/order creation.
  const next = reconcileActualCostReviews({ ...existing, actualCosts: costs });
  if (repository.saveIfCurrent) await repository.saveIfCurrent(next, existing);
  else await repository.save(next);
  return { saved: true, preview: refreshed };
}
