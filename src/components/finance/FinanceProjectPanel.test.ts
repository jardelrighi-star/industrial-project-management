import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FinanceProjectPanel, { FinanceProjectPanelView, type FinancePanelState } from "./FinanceProjectPanel";
import { calculateProjectFinancials, emptyFinanceData } from "../../lib/finance/calculations";
import { previewOrderImport } from "../../lib/finance/order-import";
import { previewCostImport } from "../../lib/finance/sankhya-import";
import { evaluateActualCost, indexActualCostReviews } from "../../lib/finance/actual-cost-review";

const render = (state: FinancePanelState) => renderToStaticMarkup(createElement(FinanceProjectPanelView, { projectCode: "P1", state, onRetry: () => {} }));

test("pending-delivery orders display unknown totals and invoicing without hiding the open commitment", () => {
  const data = { ...emptyFinanceData(), budgets: [{ projectCode: "P1", originalApprovedAmount: 100000, updatedAmount: 100000 }] };
  const order = previewOrderImport({ sourceFile: "orders.xlsx", rows: [{ rowNumber: 4, cachedFormulaCount: 0, values: { "Cód. Projeto": "P1", "Nr. Pedido": "100", Fornecedor: "Fornecedor", Produto: "Bomba", "Observação": "Reforma", "Vlr Pend": 250 } }] }, ["P1"], data, "2026-11-16T12:00:00Z").rows[0].order!;
  const next = { ...data, orders: [order] };
  const html = render({ status: "ready", summary: calculateProjectFinancials("P1", next), requisitions: [], orders: [order], actualCosts: [] });
  assert.match(html, /Pendente de entrega/);
  assert.match(html, /250,00/);
  assert.equal((html.match(/>Não informado<\/td>/g) ?? []).length, 2);
});

test("panel renders loading and recoverable error states without financial values", () => {
  const loading = renderToStaticMarkup(createElement(FinanceProjectPanel, { projectCode: "P1" }));
  assert.match(loading, /Carregando dados financeiros de P1/);
  assert.doesNotMatch(loading, /Importar custos|type="file"/);
  assert.doesNotMatch(loading, /R\$/);
  const error = render({ status: "error" });
  assert.match(error, /role="alert"/);
  assert.match(error, /Tentar novamente/);
  assert.doesNotMatch(error, /R\$/);
});

test("empty project renders all three tables and no confirmed zeros", () => {
  const html = render({ status: "ready", summary: null, requisitions: [], orders: [], actualCosts: [] });
  assert.match(html, /Ainda não há dados financeiros cadastrados/);
  assert.match(html, /Não cadastrado/);
  assert.equal((html.match(/<table /g) ?? []).length, 3);
  assert.equal((html.match(/Nenhum registro para este projeto/g) ?? []).length, 3);
  assert.doesNotMatch(html, /R\$|0%/);
});

test("budget alone activates commitment at zero while missing movements keep their empty labels", () => {
  const d = emptyFinanceData();
  d.budgets = [{ projectCode: "P1", originalApprovedAmount: 10001, updatedAmount: 10001 }];
  const html = render({ status: "ready", summary: calculateProjectFinancials("P1", d), requisitions: [], orders: [], actualCosts: [] });
  assert.match(html, /100,01/);
  assert.match(html, /Ainda não há SCs, pedidos ou lançamentos/);
  assert.match(html, /Sem registros/);
  assert.match(html, /Comprometido<\/dt><dd[^>]*>R\$ 0,00<\/dd>/);
  assert.doesNotMatch(html, />0%</);
});

test("tables display model fields, cents, fiscal dates and domain totals", () => {
  const d = emptyFinanceData();
  const traceability = { sourceSystem: "test", sourceRecordId: "sc", recordedAt: "2026-01-01T00:00:00Z", externalReference: null };
  d.budgets = [{ projectCode: "P1", originalApprovedAmount: 100000, updatedAmount: 100000 }];
  d.requisitions = [{ code: "SC-1", objective: "Manutenção elétrica", projectCode: "P1", amount: 12345, approvalStatus: "approved", convertedOrderNumber: null, traceability }];
  d.orders = [{ number: "PO-1", objective: "Serviço especializado", supplier: "Fornecedor A", projectCode: "P1", totalAmount: 12345, invoicedAmount: 2345, openBalance: 10000, requisitionCode: "SC-1", status: "partially_invoiced", traceability: { ...traceability, sourceRecordId: "po" } }];
  d.actualCosts = [{ transactionId: "tx", supplier: "Fornecedor A", projectCode: "P1", fiscalDocument: "NF-CHAVE", documentEntryId: "1", date: "2026-01-02", amount: 2350, traceability: { ...traceability, sourceRecordId: "tx" } }];
  const html = render({ status: "ready", summary: calculateProjectFinancials("P1", d), requisitions: d.requisitions, orders: d.orders, actualCosts: d.actualCosts });
  for (const text of ["123,45", "23,45", "23,50", "100,00", "876,50", "2,35%", "Manutenção elétrica", "Serviço especializado", "Fornecedor A", "02/01/2026", "NF-CHAVE", "Convertida em pedido", "Parcialmente faturado", "Aprovada"]) assert.ok(html.includes(text), text);
});

test("costs without budget show realized and descriptions without inventing a budget", () => {
  const html = render({ status: "ready", summary: null, actualTotal: 1697, requisitions: [], orders: [], actualCosts: [{
    transactionId: "tx", projectCode: "P1", supplier: "Fornecedor", fiscalDocument: "123", documentEntryId: "item", date: "2025-01-02", amount: 1697,
    description: "Serviço", assetDescription: "Bomba", traceability: { sourceSystem: "test", sourceRecordId: "tx", recordedAt: "2026-01-01T00:00:00Z", externalReference: null },
  }] });
  for (const text of ["16,97", "Serviço", "Bomba", "orçamento financeiro não está cadastrado", "Não cadastrado", "Não disponível"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /0%/);
});

test("project's realized table groups costs under the center and asset while preserving item selection", () => {
  const line = { AD_PROJ_IHBL: "P1", CODEMP: 1, NUNOTA: 456, CODPROD: 2, CODCENCUS: 410201, DESCRATIVO: "Bomba centrífuga", VLRTOT: 50, DTENTSAI: 46000 };
  const data = emptyFinanceData();
  const preview = previewCostImport({
    sourceFile: "custos.xlsx", date1904: false, projectField: "AD_PROJ_IHBL",
    rows: [
      { rowNumber: 4, values: { ...line, NUMNOTA: 18451, DESCRPROD: "Revisão de bomba" } },
      { rowNumber: 5, values: { ...line, NUMNOTA: 18452, NUNOTA: 457, DESCRPROD: "Kit de vedação" } },
    ],
  }, ["P1"], data, "2026-11-20T12:00:00Z");
  assert.equal(preview.readyCount, 2);
  data.actualCosts = preview.rows.map((row) => row.cost!);
  const evaluation = evaluateActualCost(data.actualCosts[0], indexActualCostReviews(data));
  assert.equal(evaluation.status, "pending");
  data.actualCostReviews = [{ identity: evaluation.identity, events: [
    { action: "recognized", at: "2026-11-20T13:00:00Z", actor: "Gestor", note: "", cost: evaluation.current },
  ] }];
  const html = renderToStaticMarkup(createElement(FinanceProjectPanelView, {
    projectCode: "P1", onRetry: () => {}, onReview: async () => {},
    state: { status: "ready", summary: null, actualTotal: 10000, requisitions: [], orders: [], actualCosts: data.actualCosts, reviewIndex: indexActualCostReviews(data) },
  }));
  assert.equal((html.match(/410201 - Bomba centrífuga/g) ?? []).length, 1);
  assert.match(html, /410201 - Bomba centrífuga.*Revisão de bomba.*Kit de vedação/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.match(html, /Realizado<\/dt><dd[^>]*>R\$\s100,00<\/dd>/);
  assert.match(html, /Realizado Reconhecido<\/dt><dd[^>]*>R\$\s50,00<\/dd>/);
});
