"use client";

import SankhyaReportDetails from "./SankhyaReportDetails";
import { useEffect, useState } from "react";
import { evaluateActualCost, indexActualCostReviews } from "../../lib/finance/actual-cost-review";
import { LocalStorageFinanceRepository } from "../../lib/finance/repository";
import type { FinanceData } from "../../lib/finance/types";
import { CostReviewHistory, costReviewLabel, costReviewStatusLabels } from "./ActualCostReviewControls";

const repository = new LocalStorageFinanceRepository();
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pageSize = 50;

export default function ActualCostReport() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState(false);
  const [rejectedOnly, setRejectedOnly] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    void repository.load().then((loaded) => { if (active) setData(loaded); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  const index = data ? indexActualCostReviews(data) : null;
  const rows = data && index ? data.actualCosts.map((cost) => {
    const evaluation = evaluateActualCost(cost, index);
    return {
      id: cost.transactionId, projectCode: cost.projectCode, document: cost.fiscalDocument,
      description: [cost.description, cost.assetDescription].filter(Boolean).join(" · "),
      reportFields: cost.reportFields, amount: cost.amount, status: evaluation.status, statusLabel: costReviewLabel(evaluation),
      review: evaluation.status === "unavailable" ? undefined : evaluation.review,
    };
  }) : [];
  const filtered = rows.filter((row) => !rejectedOnly || row.status === "analyst_rejected");
  const historicalRejections = index ? [...index.reviews.values()].filter((review) =>
    review.events.at(-1)?.action === "analyst_rejected" && index.costs.get(review.identity)?.length !== 1) : [];

  return <section className="space-y-4">
    <h1 className="text-2xl font-bold">Relatório de custos realizados</h1>
    {error ? <p role="alert" className="text-red-800">Não foi possível carregar o relatório.</p> : !data ?
      <p role="status">Carregando relatório…</p> : <>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rejectedOnly} onChange={(event) => { setRejectedOnly(event.target.checked); setPage(0); }} />Somente rejeitados pelo analista</label>
        <div className="overflow-x-auto rounded-lg border bg-white" role="region" aria-label="Custos realizados" tabIndex={0}>
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50"><tr>{["Projeto", "Documento fiscal", "Descrição", "Valor", "Status"].map((column) => <th key={column} className="p-3" scope="col">{column}</th>)}</tr></thead>
            <tbody>{filtered.slice(page * pageSize, (page + 1) * pageSize).map((row) => <tr key={row.id} className="border-t [&_td]:p-3 [&_td]:align-top">
              <td>{row.projectCode}</td><td>{row.document}</td><td>{row.description || "Não informado"}<SankhyaReportDetails fields={row.reportFields} /></td><td className="whitespace-nowrap">{currency.format(row.amount / 100)}</td>
              <td><span className={row.status === "analyst_rejected" ? "font-semibold text-red-800" : ""}>{row.statusLabel}</span>{row.review && <CostReviewHistory review={row.review} />}</td>
            </tr>)}
            {!filtered.length && <tr><td colSpan={5} className="p-4 text-center">Nenhum lançamento neste filtro.</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button type="button" disabled={page === 0} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setPage(page - 1)}>Anterior</button>
          <span>Página {page + 1} de {Math.max(1, Math.ceil(filtered.length / pageSize))}</span>
          <button type="button" disabled={(page + 1) * pageSize >= filtered.length} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setPage(page + 1)}>Próxima</button>
        </div>
        {historicalRejections.length > 0 && <section className="space-y-2">
          <h2 className="text-lg font-semibold">Rejeições sem correspondência única na última carga</h2>
          {historicalRejections.map((review) => {
            const event = review.events[review.events.length - 1];
            return <article key={review.identity} className="rounded-lg border bg-white p-3 text-sm">
              <div>Projeto {event.cost.projectCode} · Documento {event.cost.fiscalDocument} · {currency.format(event.cost.amount / 100)}</div>
              <strong className="text-red-800">{costReviewStatusLabels.analyst_rejected}</strong>
              <CostReviewHistory review={review} />
            </article>;
          })}
        </section>}
      </>}
  </section>;
}
