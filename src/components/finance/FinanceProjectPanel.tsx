"use client";

import { useEffect, useState, type ReactNode } from "react";
import { calculateActualCostTotal, calculateProjectFinancials, orderRequisitionCodes, purchaseOrderKey } from "../../lib/finance/calculations";
import { LocalStorageFinanceRepository, type FinanceRepository } from "../../lib/finance/repository";
import type { ActualCost, ActualCostReviewAction, FinanceData, ProjectFinancialSummary, PurchaseOrder, PurchaseRequisition } from "../../lib/finance/types";
import { evaluateActualCost, indexActualCostReviews, recordActualCostReviews, type ActualCostReviewTarget } from "../../lib/finance/actual-cost-review";
import { CostReviewCell, CostReviewForm } from "./ActualCostReviewControls";
import { onlineMode } from "../../lib/online/state";
import { recordOnlineCostReviews } from "../../lib/online/operations";

type SubmitCostReviews = (targets: ActualCostReviewTarget[], decision: { action: ActualCostReviewAction; actor: string; note: string }) => Promise<void>;

export type FinancePanelState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; summary: ProjectFinancialSummary | null; actualTotal?: number; requisitions: PurchaseRequisition[]; orders: PurchaseOrder[]; actualCosts: ActualCost[]; reviewIndex?: ReturnType<typeof indexActualCostReviews> };

const repository = new LocalStorageFinanceRepository();
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const centerOrder = new Intl.Collator("pt-BR", { numeric: true });
const money = (cents: number) => currency.format(cents / 100);
const percent = (value: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}%`;
const date = (value: string) => value.split("-").reverse().join("/");
const approvalLabels = { pending: "Planejada", approved: "Aprovada", rejected: "Rejeitada" };
const orderLabels = { open: "Aberto", partially_invoiced: "Parcialmente faturado", fully_invoiced: "Totalmente faturado", cancelled: "Cancelado", pending_delivery: "Pendente de entrega" };

function FinancialTable({ title, columns, children, empty, toolbar, grouped = false }: { title: string; columns: string[]; children: ReactNode; empty: boolean; toolbar?: ReactNode; grouped?: boolean }) {
  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      {toolbar}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={title}>
        <table className="w-full min-w-[750px] text-left text-sm">
          <caption className="mb-4 text-left text-lg font-bold">{title}</caption>
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>{columns.map((column) => <th key={column} scope="col" className="p-3">{column}</th>)}</tr>
          </thead>
          {grouped && !empty ? children : <tbody className="[&_td]:p-3 [&_td]:align-top [&_tr]:border-b [&_tr:last-child]:border-0">
            {empty ? <tr><td colSpan={columns.length} className="text-center text-slate-500">Nenhum registro para este projeto.</td></tr> : children}
          </tbody>}
        </table>
      </div>
    </section>
  );
}

function ActualCostsTable({ costs, reviewIndex, onReview }: {
  costs: ActualCost[];
  reviewIndex?: ReturnType<typeof indexActualCostReviews>;
  onReview?: SubmitCostReviews;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const showReviews = Boolean(reviewIndex);
  const rows = costs.map((cost) => ({ cost, evaluation: reviewIndex && evaluateActualCost(cost, reviewIndex) }));
  const columns = ["Documento fiscal", "Descrição", "Fornecedor", "Data", "Valor", ...(showReviews ? ["Avaliação do gestor"] : []), ...(onReview ? ["Selecionar"] : [])];
  const groups = new Map<string, { center: string; asset: string; rows: typeof rows }>();
  for (const row of rows) {
    const center = row.cost.sankhya?.costCenterCode.trim() || "";
    const asset = row.cost.assetDescription?.trim() || "";
    const key = JSON.stringify([center, asset]);
    const group = groups.get(key) ?? { center, asset, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const orderedGroups = [...groups].sort(([, left], [, right]) =>
    centerOrder.compare(left.center, right.center) || centerOrder.compare(left.asset, right.asset));
  const targets = rows.flatMap(({ evaluation }) => {
    if (!evaluation || (evaluation.status !== "pending" && evaluation.status !== "review_again" && evaluation.status !== "recognized")) return [];
    return [{
      identity: evaluation.identity,
      expectedEvents: evaluation.review?.events.length ?? 0,
      expectedRevision: evaluation.current.revision,
      mayRecognize: evaluation.status !== "recognized",
    }];
  });
  const targetsByIdentity = new Map(targets.map((target) => [target.identity, target]));
  const selectedTargets = targets.filter(({ identity }) => selected.has(identity));
  const canRecognize = selectedTargets.some((target) => target.mayRecognize);

  function toggle(identity: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(identity);
      else next.delete(identity);
      return next;
    });
  }

  return <FinancialTable title="Realizado" grouped
    columns={columns}
    empty={!costs.length}
    toolbar={onReview && selectedTargets.length > 0 && <div className="mb-4 rounded-lg bg-slate-50 p-3">
      <p role="status" className="text-sm font-medium">{selectedTargets.length} lançamento(s) selecionado(s)</p>
      <CostReviewForm key={JSON.stringify(selectedTargets)} selectedCosts actions={canRecognize ? ["recognized", "rejected"] : ["rejected"]}
        onSubmit={async (action, actor, note) => {
          setSaving(true);
          try {
            const batch = action === "recognized" ? selectedTargets.filter((target) => target.mayRecognize) : selectedTargets;
            await onReview(batch, { action, actor, note });
            setSelected(new Set());
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>}
  >
    {orderedGroups.map(([key, group]) => {
      const expanded = !collapsed.has(key);
      return <tbody key={key} className="[&_td]:p-3 [&_td]:align-top">
        <tr className="border-t border-blue-200 bg-blue-100">
          <th scope="rowgroup" colSpan={columns.length}>
            <button type="button" aria-expanded={expanded}
              className="flex w-full items-center gap-3 px-3 py-3 text-left font-semibold text-slate-900"
              onClick={() => setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })}>
              <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
              {group.center || "Centro de custo não informado"} - {group.asset || "Descrição do ativo não informada"}
            </button>
          </th>
        </tr>
        {expanded && group.rows.map(({ cost, evaluation }) => {
          const target = evaluation && evaluation.status !== "unavailable" ? targetsByIdentity.get(evaluation.identity) : undefined;
          return <tr key={cost.transactionId} className="border-t">
            <td className="break-all pl-9!">{cost.fiscalDocument}</td>
            <td>{cost.description || "Não informado"}</td>
            <td>{cost.supplier || "Não informado"}</td>
            <td className="whitespace-nowrap">{date(cost.date)}</td>
            <td className="whitespace-nowrap">{money(cost.amount)}</td>
            {showReviews && <td>{evaluation && <CostReviewCell evaluation={evaluation} />}</td>}
            {onReview && <td>{target && <input type="checkbox" checked={selected.has(target.identity)} disabled={saving}
                aria-label={`Selecionar lançamento ${cost.fiscalDocument}, linha ${cost.sankhya?.sourceRow}`}
                onChange={(event) => toggle(target.identity, event.target.checked)} />}</td>}
          </tr>;
        })}
      </tbody>;
    })}
  </FinancialTable>;
}

/** Presentation only: financial totals come exclusively from the domain layer. */
export function FinanceProjectPanelView({ projectCode, state, onRetry, onReview }: { projectCode: string; state: FinancePanelState; onRetry: () => void; onReview?: SubmitCostReviews }) {
  if (state.status === "loading") return <div role="status" className="rounded-xl border bg-white p-6 text-slate-500" aria-live="polite">Carregando dados financeiros de {projectCode}…</div>;
  if (state.status === "error") return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
      <p>Não foi possível carregar os dados financeiros deste projeto.</p>
      <p className="mt-1 text-sm">Os dados armazenados foram preservados.</p>
      <button type="button" onClick={onRetry} className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium">Tentar novamente</button>
    </div>
  );
  const { summary, requisitions, orders, actualCosts } = state;
  const noRecords = "Sem registros";
  const hasCommitmentRecords = requisitions.length > 0 || orders.length > 0;
  const actualTotal = actualCosts.length
    ? state.actualTotal ?? summary?.totalActual
    : undefined;
  const reviewIndex = state.reviewIndex;
  const recognizedTotal = reviewIndex ? actualCosts.reduce((total, cost) =>
    total + (evaluateActualCost(cost, reviewIndex).status === "recognized" ? cost.amount : 0), 0) : 0;
  const cards = [
    [["Orçamento original aprovado", summary ? money(summary.originalApprovedAmount) : "Não cadastrado"]],
    [["Orçamento atualizado", summary ? money(summary.updatedAmount) : "Não cadastrado"]],
    [["Comprometido", summary ? money(summary.totalCommitted) : "Não disponível"]],
    [
      ["Realizado", actualTotal !== undefined ? money(actualTotal) : actualCosts.length ? "Não disponível" : noRecords],
      ["Realizado Reconhecido", actualCosts.length ? money(recognizedTotal) : noRecords],
    ],
    [["Saldo disponível", summary ? money(summary.availableBalance) : "Não disponível"]],
    [["Execução financeira", actualCosts.length ? (summary ? (summary.financialExecutionPercent === null ? "Não aplicável" : percent(summary.financialExecutionPercent)) : "Orçamento não cadastrado") : noRecords]],
  ];
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Controle financeiro</h2>
        <p className="mt-1 text-sm text-slate-500">Projeto {projectCode} · Valores em reais</p>
      </div>
      {!summary && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">{actualCosts.length ? "Há custos realizados, mas o orçamento financeiro não está cadastrado. Saldo disponível e execução percentual não podem ser calculados." : "Ainda não há dados financeiros cadastrados para este projeto."}</p>}
      {summary && !hasCommitmentRecords && !actualCosts.length && <p role="status" className="text-sm text-slate-500">Orçamento cadastrado. Ainda não há SCs, pedidos ou lançamentos realizados; o saldo disponível considera apenas os registros existentes.</p>}
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((metrics) => <div key={metrics[0][0]} className={`rounded-xl border bg-white p-5 shadow-sm ${metrics.length > 1 ? "grid grid-cols-2 divide-x divide-slate-200" : ""}`}>
          {metrics.map(([label, value], index) => <div key={label} className={`flex min-w-0 flex-col ${index > 0 ? "pl-3" : ""}`}>
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="mt-auto break-words pt-3 text-xl font-bold">{value}</dd>
          </div>)}
        </div>)}
      </dl>
      <section className="rounded-xl border bg-white p-5 shadow-sm" aria-label="Composição do comprometido">
        <h3 className="font-bold">Composição do comprometido</h3>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><dt className="text-sm text-slate-500">SCs aprovadas ainda não convertidas</dt><dd className="mt-1 font-semibold">{summary ? money(summary.approvedUnconvertedRequisitions) : "Não disponível"}</dd></div>
          <div><dt className="text-sm text-slate-500">Pedidos com compromisso em aberto</dt><dd className="mt-1 font-semibold">{summary ? money(summary.uninvoicedOrderBalance) : "Não disponível"}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-slate-500">Indicadores calculados sobre os registros cadastrados. Ausência de registros não confirma ausência de movimentação financeira.</p>
      </section>
      <FinancialTable title="SCs" columns={["Número", "Objetivo", "Valor", "Aprovação", "Pedido vinculado", "Status"]} empty={!requisitions.length}>
        {requisitions.map((r) => {
          const linkedOrders = orders.filter((o) => orderRequisitionCodes(o).includes(r.code)).map((o) => o.number);
          const linked = [...new Set([...(r.convertedOrderNumber ? [r.convertedOrderNumber] : []), ...linkedOrders])];
          return <tr key={r.code}><td>{r.code}</td><td>{r.objective || "Não informado"}</td><td className="whitespace-nowrap">{money(r.amount)}</td><td>{approvalLabels[r.approvalStatus]}</td><td>{linked.join(", ") || "Não informado"}</td><td>{linked.length ? "Convertida em pedido" : "Sem conversão registrada"}</td></tr>;
        })}
      </FinancialTable>
      <FinancialTable title="Pedidos" columns={["Número", "Objetivo", "Fornecedor", "Valor total", "Valor faturado", "Saldo aberto", "Status"]} empty={!orders.length}>
        {orders.map((o) => <tr key={purchaseOrderKey(o)}><td>{o.number}{o.sankhya?.internalOrderId && <div className="text-xs text-slate-500">Nº único {o.sankhya.internalOrderId}</div>}</td><td>{o.objective || "Não informado"}</td><td>{o.supplier || "Não informado"}</td><td className="whitespace-nowrap">{o.totalAmount === null ? "Não informado" : money(o.totalAmount)}</td><td className="whitespace-nowrap">{o.invoicedAmount === null ? "Não informado" : money(o.invoicedAmount)}</td><td className="whitespace-nowrap">{money(o.openBalance)}</td><td>{orderLabels[o.status]}</td></tr>)}
      </FinancialTable>
      <ActualCostsTable costs={actualCosts} reviewIndex={state.reviewIndex} onReview={onReview} />
    </div>
  );
}

function projectFinanceState(projectCode: string, data: FinanceData): FinancePanelState {
  return {
    status: "ready",
    summary: data.budgets.some((b) => b.projectCode === projectCode) ? calculateProjectFinancials(projectCode, data) : null,
    actualTotal: calculateActualCostTotal(projectCode, data),
    requisitions: data.requisitions.filter((r) => r.projectCode === projectCode),
    orders: data.orders.filter((o) => o.projectCode === projectCode),
    actualCosts: data.actualCosts.filter((c) => c.projectCode === projectCode),
    reviewIndex: indexActualCostReviews(data),
  };
}

function FinanceProjectLoader({ projectCode, dataRepository, canReview }: { projectCode: string; dataRepository: FinanceRepository; canReview: boolean }) {
  const [state, setState] = useState<FinancePanelState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await dataRepository.load();
        if (active) setState(projectFinanceState(projectCode, data));
      } catch {
        if (active) setState({ status: "error" });
      }
    }
    void load();
    return () => { active = false; };
  }, [projectCode, dataRepository, attempt]);
  return <FinanceProjectPanelView projectCode={projectCode} state={state}
    onRetry={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}
    onReview={canReview ? async (targets, decision) => setState(projectFinanceState(projectCode, onlineMode
      ? await recordOnlineCostReviews(targets, decision.action, decision.note)
      : await recordActualCostReviews(dataRepository, targets, decision))) : undefined}
  />;
}

export default function FinanceProjectPanel({ projectCode, dataRepository = repository, canReview = true }: { projectCode: string; dataRepository?: FinanceRepository; canReview?: boolean }) {
  // Reset immediately when selecting another project; late requests cannot show stale data.
  return <FinanceProjectLoader key={projectCode} projectCode={projectCode} dataRepository={dataRepository} canReview={canReview} />;
}
