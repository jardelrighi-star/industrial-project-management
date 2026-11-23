import { parseExcelDate } from "./import-values";

export const scReportFields = {
  "Nome Comprador": "Comprador",
  "Nome (Usuário Inclusão)": "Usuário de inclusão",
  "Dt. Entrada/Saída": "Data de entrada/saída",
  "Item": "Item",
  "Cod. Prod": "Código do produto",
  "Qtde.Pendente": "Quantidade pendente",
  "Unit": "Valor unitário",
  "Natureza": "Natureza",
  "Centro de Custo": "Centro de custo",
  "Descrição (TOP)": "Operação",
} as const;

export const orderReportFields = {
  "Solicitante": "Solicitante",
  "Dt. Pedido": "Data do pedido",
  "Desc.Grupo Produto": "Grupo do produto",
  "Produto": "Produto",
  "Qtde Atendida": "Quantidade atendida",
  "Qtd. Negociada": "Quantidade negociada",
  "Qtde Pendente": "Quantidade pendente",
  "Natureza": "Natureza",
  "Centro de custo": "Centro de custo",
} as const;

export const costReportFields = {
  NF_PEDIDO: "NF_PEDIDO",
  DESCRCENCUS: "Centro de custo",
  DESCROPER: "Operação",
  DESCRICAO: "Descrição complementar",
  DESC_GRUPO_CONS: "Grupo de consumo",
  DESC_GRUPO_IMOB: "Grupo de imobilizado",
} as const;

export type SankhyaReportFields = Record<string, string[]>;

export function readReportFields(
  fields: Readonly<Record<string, string>>,
  rows: readonly Record<string, unknown>[],
  date1904 = false,
): SankhyaReportFields | undefined {
  const report: SankhyaReportFields = {};
  for (const [column, label] of Object.entries(fields)) {
    const values = new Set<string>();
    for (const row of rows) {
      const value = row[column];
      if (value == null || value === "") continue;
      if (column === "Dt. Pedido" || column === "Dt. Entrada/Saída") {
        try { values.add(parseExcelDate(value, date1904).split("-").reverse().join("/")); }
        catch { /* An invalid optional date does not invalidate a financial entry. */ }
      } else if (typeof value === "string" || typeof value === "number") {
        const text = String(value).trim();
        if (text) values.add(text);
      }
    }
    if (values.size) report[label] = [...values].sort();
  }
  return Object.keys(report).length ? report : undefined;
}
