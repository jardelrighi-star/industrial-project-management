import { orderReportFields, readReportFields } from "./sankhya-report-fields";
import type { FinanceData, PurchaseOrder } from "./types";
import type { FinanceRepository } from "./repository";
import { normalizeFinanceData, purchaseOrderKey } from "./calculations";
import { parseBrlCents } from "./import-values";
import { ORDER_SHEET, type OrderWorkbook } from "./order-workbook";
import { SANKHYA_EXPORT_SHEET } from "./sankhya-workbook";

export type OrderImportRow = {
  rowNumbers: number[]; number: string; projectCode: string; amount: number | null;
  status: "new" | "updated" | "duplicate" | "invalid" | "conflict";
  message: string; order?: PurchaseOrder; previous?: PurchaseOrder;
};
export type OrderPreview = {
  workbook: OrderWorkbook; baseline: string; rows: OrderImportRow[];
  newCount: number; updatedCount: number; duplicateCount: number; issueCount: number;
};
const text = (value: unknown) => value === null || value === undefined ? "" : String(value).trim();
const key = (projectCode: string, number: string) => JSON.stringify([projectCode, number]);
function identifier(value: unknown) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new Error("Identificador numérico inválido.");
  return text(value);
}
const content = (order: PurchaseOrder) => JSON.stringify([
  order.projectCode, order.number, order.reportFields, order.objective, order.supplier, order.totalAmount, order.invoicedAmount,
  order.openBalance, order.status, order.requisitionCode,
  order.sankhya?.items.map((item) => JSON.stringify([item.product, item.objective, item.openBalance, item.requisitionCode])).sort() ?? null,
]);

/** A complete order/project group is imported, never a partial set of valid items. */
export function previewOrderImport(workbook: OrderWorkbook, projectCodes: readonly string[], input: FinanceData, recordedAt: string): OrderPreview {
  const data = normalizeFinanceData(input);
  const projects = new Set(projectCodes);
  const budgets = new Set(data.budgets.map((b) => b.projectCode));
  const directExport = workbook.sourceSheet === SANKHYA_EXPORT_SHEET;
  const documentField = directExport ? "Nr.Unico Ped." : "Nr. Pedido";
  const existingByKey = new Map(data.orders.map((order) => [purchaseOrderKey(order), order]));
  const otherLayoutNumbers = new Set(data.orders.filter((order) => Boolean(order.sankhya?.internalOrderId) !== directExport)
    .map((order) => key(order.projectCode, order.number)));
  const existingBySource = new Map(data.orders.map((order) => [JSON.stringify([order.traceability.sourceSystem, order.traceability.sourceRecordId]), order]));
  const groups = new Map<string, OrderWorkbook["rows"]>();
  const unidentifiedProjects = new Set<string>();
  for (const source of workbook.rows) {
    const project = text(source.values["Cód. Projeto"]);
    const number = text(source.values[documentField]);
    if (!directExport && !project && number) unidentifiedProjects.add(number);
    // The direct export assigns projects per line. Unassigned allocations stay separate.
    const id = number && (project || directExport) ? key(project, number) : `invalid-row:${source.rowNumber}`;
    const group = groups.get(id) ?? []; group.push(source); groups.set(id, group);
  }
  const rows: OrderImportRow[] = [...groups.values()].map((group) => {
    const first = group[0].values;
    const row: OrderImportRow = { rowNumbers: group.map((source) => source.rowNumber), number: text(first["Nr. Pedido"]), projectCode: text(first["Cód. Projeto"]), amount: null, status: "invalid", message: "" };
    try {
      const documentId = identifier(first[documentField]);
      if (!documentId || /^0+$/.test(documentId)) throw new Error(`Identificador ausente ou inválido em ${documentField}.`);
      row.projectCode = identifier(first["Cód. Projeto"]);
      const displayNumbers = new Set(group.map((source) => identifier(source.values["Nr. Pedido"])).filter((number) => number && !/^0+$/.test(number)));
      if (displayNumbers.size > 1) throw new Error("Números de pedido diferentes para o mesmo identificador interno.");
      row.number = [...displayNumbers][0] ?? documentId;
      if (unidentifiedProjects.has(documentId)) throw new Error("Há item deste pedido sem projeto identificável; corrija todas as linhas antes de importar.");
      if (!row.projectCode || /^0+$/.test(row.projectCode) || !projects.has(row.projectCode)) throw new Error("Projeto não cadastrado para Cód. Projeto.");
      if (row.projectCode !== row.projectCode.toUpperCase()) throw new Error("Código do projeto não canônico.");
      if (!budgets.has(row.projectCode)) throw new Error("Cadastre o orçamento do projeto antes de importar seus pedidos.");
      const items: NonNullable<PurchaseOrder["sankhya"]>["items"] = [];
      const suppliers = new Set<string>();
      const fingerprints = new Set<string>();
      const requisitionCodes = new Set<string>();
      let total = 0;
      for (const source of group) {
        if (source.issue) throw new Error(`Linha ${source.rowNumber}: ${source.issue}`);
        identifier(source.values["Cód. Projeto"]); identifier(source.values[documentField]);
        const supplier = text(source.values.Fornecedor);
        if (!supplier) throw new Error(`Linha ${source.rowNumber}: fornecedor não informado.`);
        suppliers.add(supplier);
        const amount = parseBrlCents(source.values["Vlr Pend"]);
        if (amount < 0) throw new Error(`Linha ${source.rowNumber}: Vlr Pend não pode ser negativo.`);
        const product = text(source.values.Produto);
        const objective = text(source.values[directExport ? "OBSERVACAO" : "Observação"]);
        const sc = directExport ? identifier(source.values.SC) : "";
        const requisitionCode = sc && !/^0+$/.test(sc) ? sc : undefined;
        if (requisitionCode) requisitionCodes.add(requisitionCode);
        if (!directExport) {
          const fingerprint = JSON.stringify([supplier, product, objective, amount]);
          if (fingerprints.has(fingerprint)) {
            row.status = "conflict";
            throw new Error("Itens indistinguíveis no mesmo pedido/projeto; obtenha a sequência do item ou corrija a exportação. Nenhum item deste grupo será importado.");
          }
          fingerprints.add(fingerprint);
        }
        total += amount;
        if (!Number.isSafeInteger(total)) throw new Error("Saldo do pedido fora do limite suportado.");
        items.push({ sourceRow: source.rowNumber, product, objective, openBalance: amount, ...(requisitionCode ? { requisitionCode } : {}) });
      }
      if (suppliers.size !== 1) throw new Error("Fornecedores diferentes no mesmo pedido/projeto; grupo não será importado.");
      row.amount = total;
      const sourceRecordId = JSON.stringify([directExport ? "sankhya-order-export-v1" : "sankhya-order-v1", row.projectCode, documentId]);
      if (!directExport) for (const sc of data.requisitions) {
        if (sc.projectCode === row.projectCode && sc.convertedOrderNumber === row.number) requisitionCodes.add(sc.code);
      }
      const reportFields = readReportFields(orderReportFields, group.map((item) => item.values), workbook.date1904);
      const order: PurchaseOrder = {
        ...(reportFields ? { reportFields } : {}),
        number: row.number, projectCode: row.projectCode,
        objective: [...new Set(items.map((item) => item.objective).filter(Boolean))].sort().join("\n\n"),
        supplier: [...suppliers][0], totalAmount: null, invoicedAmount: null, openBalance: total,
        status: "pending_delivery", requisitionCode: requisitionCodes.size === 1 ? [...requisitionCodes][0] : null,
        sankhya: { balanceField: "Vlr Pend", sourceFile: workbook.sourceFile, sourceSheet: workbook.sourceSheet ?? ORDER_SHEET, items, ...(directExport ? { internalOrderId: documentId } : {}) },
        traceability: { sourceSystem: "Sankhya", sourceRecordId, recordedAt, externalReference: row.number },
      };
      row.order = order;
      const previous = existingByKey.get(purchaseOrderKey(order));
      const sameSource = existingBySource.get(JSON.stringify(["Sankhya", sourceRecordId]));
      if (sameSource && sameSource !== previous) throw new Error("Identidade de origem vinculada a outro pedido; reconciliação necessária.");
      if (!previous && otherLayoutNumbers.has(key(row.projectCode, row.number))) {
        row.status = "conflict"; row.message = "Já existe pedido com o mesmo número e outra identidade. Concilie o registro anterior antes de importar.";
      } else if (previous && content(previous) === content(order)) {
        row.status = "duplicate"; row.message = "Já importado, sem alteração.";
      } else if (previous) {
        row.previous = previous;
        if (previous.traceability.sourceSystem !== "Sankhya" || previous.traceability.sourceRecordId !== sourceRecordId) {
          row.status = "conflict"; row.message = "Pedido de outra origem; não será sobrescrito por esta exportação.";
        } else {
          row.status = "updated"; row.message = "Atualizar os itens e o saldo em aberto conforme a prévia.";
        }
      } else { row.status = "new"; row.message = "Novo pedido, consolidado por projeto."; }
    } catch (cause) { row.message = cause instanceof Error ? cause.message : "Pedido inválido."; }
    return row;
  });
  return { workbook, baseline: JSON.stringify(data), rows,
    newCount: rows.filter((r) => r.status === "new").length,
    updatedCount: rows.filter((r) => r.status === "updated").length,
    duplicateCount: rows.filter((r) => r.status === "duplicate").length,
    issueCount: rows.filter((r) => r.status === "invalid" || r.status === "conflict").length,
  };
}

export async function confirmOrderImport(preview: OrderPreview, projectCodes: readonly string[], repository: FinanceRepository, loadProjectCodes?: () => Promise<readonly string[]>): Promise<{ saved: boolean; preview: OrderPreview }> {
  const currentCodes = loadProjectCodes ? await loadProjectCodes() : projectCodes;
  const existing = await repository.load();
  const refreshed = previewOrderImport(preview.workbook, currentCodes, existing, new Date().toISOString());
  const decisions = (p: OrderPreview) => JSON.stringify(p.rows.map((r) => [r.rowNumbers, r.status, r.order ? content(r.order) : null]));
  if (refreshed.baseline !== preview.baseline || decisions(refreshed) !== decisions(preview)) return { saved: false, preview: refreshed };
  const changes = refreshed.rows.filter((r) => r.status === "new" || r.status === "updated").map((r) => r.order!);
  if (!changes.length) return { saved: false, preview: refreshed };
  const replacements = new Map(changes.map((order) => [purchaseOrderKey(order), order]));
  const existingKeys = new Set(existing.orders.map(purchaseOrderKey));
  const next = normalizeFinanceData({ ...existing, orders: [
    ...existing.orders.map((order) => replacements.get(purchaseOrderKey(order)) ?? order),
    ...changes.filter((order) => !existingKeys.has(purchaseOrderKey(order))),
  ] });
  if (repository.saveIfCurrent) await repository.saveIfCurrent(next, existing, loadProjectCodes ? async () => {
    const latest = new Set(await loadProjectCodes());
    if (changes.some((order) => !latest.has(order.projectCode))) throw new Error("O cadastro de projetos mudou. Gere uma nova prévia.");
  } : undefined);
  else await repository.save(next);
  return { saved: true, preview: refreshed };
}
