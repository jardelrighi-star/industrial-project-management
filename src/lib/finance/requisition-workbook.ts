import { scReportFields } from "./sankhya-report-fields";
import { readSankhyaTable, type SankhyaTable, type SankhyaTableRow } from "./sankhya-table";

export const SC_SHEET = "SC PENDENTE";
export const SC_HEADERS = ["Nrº Projeto", "SC", "Vlr. Nota", "Confirmada", "Observação", "Nro. Pedido"] as const;
export type RequisitionSourceRow = SankhyaTableRow;
export type RequisitionWorkbook = SankhyaTable;

export async function readRequisitionWorkbook(buffer: ArrayBuffer, sourceFile: string): Promise<RequisitionWorkbook> {
  return readSankhyaTable(buffer, sourceFile, SC_SHEET, SC_HEADERS, {
    detectHeader: true,
    exportHeaders: ["Cód. Projeto", "Nr.Unico", "Vlr Pendente", "Confirmada", "Observação"],
    optionalHeaders: Object.keys(scReportFields),
    exportIdentity: "Nr.Unico",
  });
}
