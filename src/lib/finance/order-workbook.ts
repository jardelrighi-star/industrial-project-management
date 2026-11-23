import { orderReportFields } from "./sankhya-report-fields";
import { readSankhyaTable, type SankhyaTable } from "./sankhya-table";

export const ORDER_SHEET = "PENTENDES DE ENTREGA";
export const ORDER_HEADERS = ["Cód. Projeto", "Nr. Pedido", "Fornecedor", "Produto", "Observação", "Vlr Pend"] as const;
export type OrderWorkbook = SankhyaTable;

export async function readOrderWorkbook(buffer: ArrayBuffer, sourceFile: string): Promise<OrderWorkbook> {
  return readSankhyaTable(buffer, sourceFile, ORDER_SHEET, ORDER_HEADERS, {
    exportHeaders: ["Cód. Projeto", "Nr. Pedido", "Fornecedor", "Produto", "OBSERVACAO", "Vlr Pend", "Nr.Unico Ped.", "SC"],
    optionalHeaders: Object.keys(orderReportFields),
    exportIdentity: "Nr.Unico Ped.",
  });
}
