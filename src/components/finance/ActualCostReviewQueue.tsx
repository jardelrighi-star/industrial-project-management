"use client";

import { useEffect, useState } from "react";
import { indexActualCostReviews, recordActualCostReview, rejectedActualCosts } from "../../lib/finance/actual-cost-review";
import { LocalStorageFinanceRepository, type FinanceRepository } from "../../lib/finance/repository";
import type { FinanceData } from "../../lib/finance/types";
import { onlineMode } from "../../lib/online/state";
import { recordOnlineCostReviews } from "../../lib/online/operations";
import { CostReviewForm, CostReviewHistory } from "./ActualCostReviewControls";

const repository = new LocalStorageFinanceRepository();
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function ActualCostReviewQueue({ dataRepository = repository }: { dataRepository?: FinanceRepository }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void dataRepository.load().then((loaded) => { if (active) setData(loaded); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [dataRepository, attempt]);

  const index = data ? indexActualCostReviews(data) : null;
  const queue = index ? rejectedActualCosts(index) : [];
  const unavailableHistory = index ? [...index.reviews.values()].filter((review) =>
    review.events.at(-1)?.action !== "rejected" && index.costs.get(review.identity)?.length !== 1) : [];
  return <section className="space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Análise de custos realizados</h1>
        <p className="mt-1 text-sm text-slate-600">Justifique a validação do custo ou concorde com a contestação e registre a rejeição.</p>
        {!onlineMode && <p className="mt-1 text-sm text-slate-600">As avaliações ficam salvas neste navegador.</p>}
      </div>
      <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => { setData(null); setError(false); setAttempt((value) => value + 1); }}>Atualizar lista</button>
    </header>
    {error ? <p role="alert" className="text-red-800">Não foi possível carregar a fila. Tente atualizar a lista.</p> :
      !data ? <p role="status">Carregando lançamentos rejeitados…</p> :
      !queue.length ? <p role="status" className="rounded-lg border bg-white p-4">Nenhum lançamento aguardando análise.</p> :
      queue.map(({ review, rejection, current, ambiguous }) => <article key={review.identity} className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Projeto {rejection.cost.projectCode} · Documento {rejection.cost.fiscalDocument}{rejection.cost.internalNoteId && ` · NUNOTA ${rejection.cost.internalNoteId}`}</h2>
        <p className="mt-1 text-sm">{[rejection.cost.description, rejection.cost.supplier].filter(Boolean).join(" · ")}</p>
        <p className="text-sm">Valor rejeitado {currency.format(rejection.cost.amount / 100)}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm"><strong>Motivo da rejeição</strong> · {rejection.note}</p>
        {current ? current.revision !== rejection.cost.revision && <p className="mt-2 text-sm text-blue-900">Atualizado na importação · Projeto {current.projectCode} · {currency.format(current.amount / 100)}</p> :
          <p className="mt-2 text-sm text-amber-900">{ambiguous ? "Mais de uma linha corresponde ao lançamento na última carga." : "Lançamento ausente na última carga."}</p>}
        <CostReviewHistory review={review} />
        {!ambiguous && <CostReviewForm actions={current ? ["analyst_validated", "analyst_rejected"] : ["analyst_rejected"]} onSubmit={async (action, actor, note) => {
          const target = {
            identity: review.identity,
            expectedEvents: review.events.length, expectedRevision: current?.revision ?? null,
          };
          setData(onlineMode
            ? await recordOnlineCostReviews([target], action, note)
            : await recordActualCostReview(dataRepository, { ...target, action, actor, note }));
        }} />}
      </article>)
    }
    {unavailableHistory.length > 0 && <section className="space-y-3">
      <h2 className="text-lg font-semibold">Histórico de lançamentos sem correspondência única</h2>
      {unavailableHistory.map((review) => {
        const cost = review.events[review.events.length - 1].cost;
        return <article key={review.identity} className="rounded-lg border bg-white p-4">
          <h3 className="font-semibold">Projeto {cost.projectCode} · Documento {cost.fiscalDocument}</h3>
          <p className="text-sm">{index?.costs.has(review.identity) ? "Identificação repetida na última carga." : "Lançamento ausente na última carga."}</p>
          <CostReviewHistory review={review} />
        </article>;
      })}
    </section>}
  </section>;
}
