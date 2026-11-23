import { orderRequisitionCodes } from "../finance/calculations";
import { LocalStorageFinanceRepository } from "../finance/repository";
import type { ActualCost, FinanceData } from "../finance/types";
import type { StoragePort } from "../coordinated-storage";
import { withStorageWriteLock } from "../storage-write-lock";
import { loadProcurementPlan, PROCUREMENT_PLAN_KEY, type PlannedPurchase } from "./procurement-plan";

type HistoryRow = {
  orderId: string;
  orderNumber?: string;
  scNumber?: string;
  costs: ActualCost[];
  total: number;
  itemId?: string;
  issue?: string;
};

function costOrderId(cost: ActualCost) {
  const references = cost.reportFields?.NF_PEDIDO;
  const id = references?.length === 1 ? references[0].trim() : "";
  return /^[1-9]\d*$/.test(id) ? id : "";
}

export function previewProcurementHistory(projectCode: string, finance: FinanceData, purchases: PlannedPurchase[]) {
  const groups = new Map<string, ActualCost[]>();
  let unlinked = 0;
  for (const cost of finance.actualCosts) {
    const id = costOrderId(cost);
    if (!id) {
      if (cost.projectCode === projectCode) unlinked++;
      continue;
    }
    const group = groups.get(id) ?? [];
    group.push(cost);
    groups.set(id, group);
  }
  const rows: HistoryRow[] = [];
  for (const [orderId, group] of groups) {
    const costs = group.filter((cost) => cost.projectCode === projectCode);
    if (!costs.length) continue;
    const orders = finance.orders.filter((order) => order.sankhya?.internalOrderId === orderId);
    const order = orders.length === 1 && orders[0].projectCode === projectCode ? orders[0] : undefined;
    const scs = order ? orderRequisitionCodes(order) : [];
    const uniqueScOrder = scs.length === 1 && finance.orders.filter((candidate) =>
      candidate.projectCode === projectCode && orderRequisitionCodes(candidate).includes(scs[0])).length === 1;
    const matches = purchases.filter((item) => item.projectCode === projectCode && (
      item.realized?.orderId === orderId ||
      (!item.realized && (item.orderNumber?.trim() === orderId ||
        (order && item.orderNumber?.trim() === order.number &&
          finance.orders.filter((candidate) => candidate.projectCode === projectCode && candidate.number === order.number).length === 1) ||
        (uniqueScOrder && !item.orderNumber?.trim() && item.scNumber?.trim() === scs[0])))
    ));
    const total = costs.reduce((sum, cost) => sum + cost.amount, 0);
    const crossesProjects = costs.length !== group.length || orders.some((candidate) => candidate.projectCode !== projectCode) ||
      purchases.some((item) => item.realized?.orderId === orderId && item.projectCode !== projectCode);
    let issue: string | undefined;
    if (crossesProjects) issue = "Pedido associado a mais de um projeto.";
    else if (matches.length > 1 || orders.length > 1) issue = "Mais de um vínculo possível. Revise o pedido no plano.";
    else if (!Number.isSafeInteger(total)) issue = "Valor realizado fora do limite suportado.";
    rows.push({ orderId, orderNumber: order?.number, scNumber: scs.length === 1 ? scs[0] : undefined,
      costs, total, itemId: matches[0]?.id, issue });
  }
  const matchedCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.itemId) matchedCounts.set(row.itemId, (matchedCounts.get(row.itemId) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.itemId && (matchedCounts.get(row.itemId) ?? 0) > 1) {
      row.issue ??= "Mais de um pedido corresponde ao mesmo item do plano.";
    }
  }
  return { rows: rows.sort((a, b) => a.orderId.localeCompare(b.orderId, "pt-BR", { numeric: true })), unlinked };
}

export async function procurementHistorySignature(preview: ReturnType<typeof previewProcurementHistory>) {
  const bytes = new TextEncoder().encode(JSON.stringify(preview));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function saveProcurementHistory(projectCode: string, signature: string, storage: StoragePort) {
  return withStorageWriteLock(async () => {
    const finance = await new LocalStorageFinanceRepository(() => storage).load();
    const plan = loadProcurementPlan(storage);
    const preview = previewProcurementHistory(projectCode, finance, plan.purchases);
    if (signature !== await procurementHistorySignature(preview)) throw new Error("Os dados mudaram. Gere uma nova prévia.");
    const purchases = [...plan.purchases];
    for (const row of preview.rows) {
      if (row.issue) continue;
      const realized = {
        orderId: row.orderId, cents: row.total, lineCount: row.costs.length,
        documents: [...new Set(row.costs.map((cost) => cost.fiscalDocument))].sort(),
      };
      const index = purchases.findIndex((item) => item.projectCode === projectCode && item.id === row.itemId);
      if (index >= 0) {
        const item = purchases[index];
        if (item.historical) {
          purchases[index] = { ...item, realized, orderNumber: row.orderNumber ?? item.orderNumber,
            scNumber: row.scNumber ?? item.scNumber };
        } else {
          purchases[index] = { ...item, realized, scNumber: item.scNumber || row.scNumber };
        }
        continue;
      }
      const descriptions = [...new Set(row.costs.map((cost) => cost.assetDescription?.trim() || cost.description?.trim()).filter(Boolean))];
      purchases.push({
        id: crypto.randomUUID(), projectCode, title: `Pedido ${row.orderNumber ?? row.orderId}`,
        description: descriptions.join("\n") || "Aquisição registrada na exportação de custos.",
        type: "Histórico", estimatedCents: 0, orderNumber: row.orderNumber, scNumber: row.scNumber,
        historical: true, realized,
      });
    }
    const saved = { ...plan, purchases };
    if (preview.rows.some((row) => !row.issue)) storage.setItem(PROCUREMENT_PLAN_KEY, JSON.stringify(saved));
    return saved;
  });
}
