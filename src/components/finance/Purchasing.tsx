"use client";

import { useEffect, useState, type FormEvent } from "react";
import { loadScOrderForecasts, saveScOrderForecast, scOrderKey, scsAwaitingOrders, type ScOrderForecast } from "../../lib/finance/sc-order-forecast";
import type { FinanceData, PurchaseRequisition } from "../../lib/finance/types";
import { loadOnlineScOrderForecasts, saveOnlineScOrderForecast } from "../../lib/online/operations";
import { onlineMode } from "../../lib/online/state";
import type { Project } from "../../lib/projects/types";

function ForecastField({ sc, initialDate }: { sc: PurchaseRequisition; initialDate: string | null }) {
  const [savedDate, setSavedDate] = useState(initialDate);
  const [draft, setDraft] = useState(initialDate ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const changed = draft !== (savedDate ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setFeedback(null);
    const request = { projectCode: sc.projectCode, scNumber: sc.code, forecastDate: draft, expectedDate: savedDate };
    try {
      const forecasts = onlineMode ? await saveOnlineScOrderForecast(request) : await saveScOrderForecast(request);
      const date = forecasts.find((item) => item.projectCode === sc.projectCode && item.scNumber === sc.code)?.forecastDate ?? null;
      setSavedDate(date);
      setDraft(date ?? "");
      setFeedback({ message: date ? "Previsão salva." : "Previsão removida.", error: false });
    } catch (cause) {
      setFeedback({ message: cause instanceof Error ? cause.message : "Não foi possível salvar a previsão.", error: true });
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={(event) => void submit(event)} className="space-y-1.5">
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={draft} disabled={saving}
        aria-label={`Previsão de geração do pedido da SC ${sc.code} do projeto ${sc.projectCode}`}
        onChange={(event) => { setDraft(event.target.value); setFeedback(null); }}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
      <button type="submit" disabled={!changed || saving}
        className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "Salvando…" : "Salvar"}</button>
    </div>
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`text-xs ${feedback.error ? "text-red-800" : "text-green-800"}`}>{feedback.message}</p>}
  </form>;
}

export default function Purchasing({ projects, finance, financeUnavailable }: {
  projects: readonly Project[]; finance?: FinanceData; financeUnavailable: boolean;
}) {
  const [forecasts, setForecasts] = useState<ScOrderForecast[] | null>();
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => onlineMode ? loadOnlineScOrderForecasts() : loadScOrderForecasts()).then((rows) => {
      if (mounted) setForecasts(rows);
    }).catch(() => {
      if (mounted) setForecasts(null);
    });
    return () => { mounted = false; };
  }, []);

  const projectNames = new Map(projects.map((project) => [project.code, project.name]));
  const pending = finance ? scsAwaitingOrders(finance).filter((sc) => projectNames.has(sc.projectCode)) : [];
  const dates = new Map(forecasts?.map((row) => [scOrderKey(row.projectCode, row.scNumber), row.forecastDate]));

  return <section className="space-y-4" aria-labelledby="purchasing-heading">
    <header>
      <h1 id="purchasing-heading" className="text-2xl font-bold">Compras</h1>
      <p className="mt-1 text-sm text-slate-500">Informe a data prevista de geração do pedido para cada SC sem pedido.</p>
    </header>
    {forecasts === null || financeUnavailable ? <p role="alert" className="text-sm text-red-800">Não foi possível carregar as solicitações e previsões de pedidos.</p> :
      forecasts === undefined || !finance ? <p role="status" className="text-sm text-slate-500">Carregando solicitações e previsões…</p> :
      pending.length === 0 ? <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">Nenhuma SC sem pedido nos projetos disponíveis.</p> :
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm" role="region" aria-label="Solicitações sem pedido" tabIndex={0}>
        <table className="w-full min-w-[710px] text-left text-sm">
          <thead className="bg-slate-50"><tr>
            <th scope="col" className="p-3">Projeto</th>
            <th scope="col" className="p-3">SC</th>
            <th scope="col" className="p-3">Objetivo da contratação</th>
            <th scope="col" className="p-3">Previsão de geração do pedido</th>
          </tr></thead>
          <tbody>{pending.map((sc) => {
            const key = scOrderKey(sc.projectCode, sc.code);
            return <tr key={key} className="border-t align-top">
              <td className="p-3">{sc.projectCode} - {projectNames.get(sc.projectCode)}</td>
              <th scope="row" className="p-3 font-medium">{sc.code}</th>
              <td className="max-w-sm whitespace-pre-wrap break-words p-3">{sc.objective || "—"}</td>
              <td className="p-3"><ForecastField sc={sc} initialDate={dates.get(key) ?? null} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
  </section>;
}
