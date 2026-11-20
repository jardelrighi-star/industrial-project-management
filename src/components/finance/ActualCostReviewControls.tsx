"use client";

import { useId, useState, type FormEvent } from "react";
import type { evaluateActualCost } from "../../lib/finance/actual-cost-review";
import type { ActualCostReview, ActualCostReviewAction } from "../../lib/finance/types";
import { onlineMode } from "../../lib/online/state";

const actionLabels = { recognized: "Reconhecido pelo gestor", rejected: "Contestado pelo gestor", returned: "Devolvido para revisão", analyst_validated: "Validado pelo analista", analyst_rejected: "Rejeitado pelo analista" };
export const costReviewStatusLabels = { pending: "A avaliar", recognized: "Reconhecido", rejected: "Em análise", review_again: "Reavaliar", analyst_validated: "Validado pelo analista", analyst_rejected: "Rejeitado pelo analista", unavailable: "Identificação indisponível" };

export function costReviewLabel(evaluation: ReturnType<typeof evaluateActualCost>) {
  if (evaluation.status !== "unavailable") return costReviewStatusLabels[evaluation.status];
  return evaluation.reason === "duplicate"
    ? "Linhas idênticas no arquivo. É necessária a sequência do item ou do rateio."
    : "Código de empresa, nota interna, produto ou centro de custo ausente.";
}
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function CostReviewHistory({ review }: { review: ActualCostReview }) {
  return <details className="mt-2 text-sm">
    <summary className="cursor-pointer text-blue-800">Histórico de avaliação</summary>
    <ol className="mt-2 space-y-2">
      {[...review.events].reverse().map((event, index) => <li key={index}>
        <strong>{actionLabels[event.action]}</strong> · {event.actor} · {new Date(event.at).toLocaleString("pt-BR")}
        <div>Projeto {event.cost.projectCode} · {currency.format(event.cost.amount / 100)}</div>
        {event.note && <p className="whitespace-pre-wrap break-words">{event.note}</p>}
      </li>)}
    </ol>
  </details>;
}

export function CostReviewForm({ actions, onSubmit, selectedCosts = false }: {
  actions: ActualCostReviewAction[];
  onSubmit: (action: ActualCostReviewAction, actor: string, note: string) => Promise<void>;
  selectedCosts?: boolean;
}) {
  const [action, setAction] = useState<ActualCostReviewAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fieldId = useId();
  const labels = {
    recognized: selectedCosts ? "Reconhecer selecionados" : "Reconhecer",
    rejected: selectedCosts ? "Rejeitar selecionados" : "Rejeitar",
    analyst_validated: "Validar custo", analyst_rejected: "Concordar e rejeitar",
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await onSubmit(action, String(form.get("actor") ?? ""), String(form.get("note") ?? ""));
      setAction(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar a avaliação.");
    } finally {
      setSaving(false);
    }
  }

  if (!action) return <div className="mt-2 flex flex-wrap gap-2">
    {actions.map((item) => <button key={item} type="button" onClick={() => setAction(item)} className="rounded border px-2 py-1 text-xs font-medium text-blue-800">{labels[item]}</button>)}
  </div>;

  return <form onSubmit={(event) => void submit(event)} className="mt-2 min-w-48 space-y-2 text-sm">
    {!onlineMode && <>
      <label htmlFor={fieldId + "-actor"} className="block">Seu nome</label>
      <input id={fieldId + "-actor"} name="actor" required maxLength={120} className="w-full rounded border p-1" />
    </>}
    {action !== "recognized" && <>
      <label htmlFor={fieldId + "-note"} className="block">{action === "analyst_validated" ? "Justificativa da validação" : action === "analyst_rejected" ? "Observação (opcional)" : "Motivo da rejeição"}</label>
      <textarea id={fieldId + "-note"} name="note" required={action !== "analyst_rejected"} maxLength={2000} className="w-full rounded border p-1" />
    </>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={saving} className="rounded bg-blue-700 px-2 py-1 text-white disabled:opacity-50">{saving ? "Salvando…" : labels[action]}</button>
      <button disabled={saving} type="button" className="underline" onClick={() => { setAction(null); setError(""); }}>Cancelar</button>
    </div>
  </form>;
}

export function CostReviewCell({ evaluation }: { evaluation: ReturnType<typeof evaluateActualCost> }) {
  if (evaluation.status === "unavailable") return <span className="text-slate-600">{costReviewLabel(evaluation)}</span>;
  const { status, review } = evaluation;
  return <>
    <span className={status === "rejected" || status === "analyst_rejected" ? "font-semibold text-red-800" : "font-medium"}>{costReviewStatusLabels[status]}</span>
    {review && <CostReviewHistory review={review} />}
  </>;
}
