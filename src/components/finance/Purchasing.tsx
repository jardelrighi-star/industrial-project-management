"use client";

import SankhyaReportDetails from "./SankhyaReportDetails";
import { useEffect, useState, type FormEvent } from "react";
import { loadScContracts, saveScContract, type ScContract } from "../../lib/finance/sc-contract";
import { loadScOrderForecasts, saveScOrderForecast, scOrderKey, scsAwaitingOrders, type ScOrderForecast } from "../../lib/finance/sc-order-forecast";
import type { FinanceData, PurchaseRequisition } from "../../lib/finance/types";
import { readOnlineStorage } from "../../lib/online/client";
import { saveOnlineScContract, saveOnlineScOrderForecast } from "../../lib/online/operations";
import { onlineMode } from "../../lib/online/state";
import type { Project } from "../../lib/projects/types";

type ScRow = Pick<PurchaseRequisition, "projectCode" | "code" | "objective" | "reportFields">;
type Feedback = { message: string; error: boolean };
const fieldClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const saveClass = "rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50";

function SaveFeedback({ feedback }: { feedback: Feedback | null }) {
  return feedback && <p role={feedback.error ? "alert" : "status"} className={`text-xs ${feedback.error ? "text-red-800" : "text-green-800"}`}>{feedback.message}</p>;
}

function ForecastField({ sc, initialDate, legal }: { sc: ScRow; initialDate: string | null; legal: boolean }) {
  const [savedDate, setSavedDate] = useState(initialDate);
  const [draft, setDraft] = useState(initialDate ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const changed = draft !== (savedDate ?? "");
  const label = legal ? "Previsão de conclusão do contrato" : "Previsão de geração do pedido";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setFeedback(null);
    const reference = { projectCode: sc.projectCode, scNumber: sc.code, expectedDate: savedDate };
    const matches = (item: { projectCode: string; scNumber: string }) =>
      item.projectCode === sc.projectCode && item.scNumber === sc.code;
    try {
      let date: string | null;
      if (legal) {
        const change = { ...reference, operation: "completion" as const, completionDate: draft };
        const contracts = await (onlineMode ? saveOnlineScContract(change) : saveScContract(change));
        date = contracts.find(matches)?.completionDate ?? null;
      } else {
        const request = { ...reference, forecastDate: draft };
        const forecasts = await (onlineMode ? saveOnlineScOrderForecast(request) : saveScOrderForecast(request));
        date = forecasts.find(matches)?.forecastDate ?? null;
      }
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
      <input type="date" value={draft} disabled={saving} aria-label={`${label} da SC ${sc.code} do projeto ${sc.projectCode}`}
        onChange={(event) => { setDraft(event.target.value); setFeedback(null); }} className={fieldClass} />
      <button type="submit" disabled={!changed || saving} className={saveClass}>{saving ? "Salvando…" : "Salvar data"}</button>
    </div>
    <SaveFeedback feedback={feedback} />
  </form>;
}

function ContractRequirementField({ sc, initialRequired }: { sc: ScRow; initialRequired: boolean | null }) {
  const [saved, setSaved] = useState(initialRequired);
  const [choice, setChoice] = useState(initialRequired);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (choice === null || saved === choice || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      const change = { operation: "requirement" as const, projectCode: sc.projectCode, scNumber: sc.code, required: choice, expectedRequired: saved };
      await (onlineMode ? saveOnlineScContract(change) : saveScContract(change));
      setSaved(choice);
      setFeedback({ message: "Resposta salva.", error: false });
    } catch (cause) {
      setFeedback({ message: cause instanceof Error ? cause.message : "Não foi possível salvar a resposta.", error: true });
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={(event) => void submit(event)} className="space-y-1.5">
    <div className="flex flex-wrap items-center gap-2">
      <select value={choice === null ? "" : choice ? "yes" : "no"} disabled={saving}
        aria-label={`Necessita contrato? SC ${sc.code} do projeto ${sc.projectCode}`}
        onChange={(event) => { setChoice(event.target.value === "yes"); setFeedback(null); }} className={fieldClass}>
        <option value="" disabled>Selecione</option>
        <option value="yes">Sim</option>
        <option value="no">Não</option>
      </select>
      <button type="submit" disabled={choice === null || saved === choice || saving} className={saveClass}>
        {saving ? "Salvando…" : "Salvar resposta"}
      </button>
    </div>
    <SaveFeedback feedback={feedback} />
  </form>;
}

export default function Purchasing({ projects, finance, financeUnavailable, legal = false }: {
  projects: readonly Project[]; finance?: FinanceData; financeUnavailable: boolean; legal?: boolean;
}) {
  const [schedules, setSchedules] = useState<{ forecasts: ScOrderForecast[]; contracts: ScContract[] } | null>();
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(async () => {
      const storage = onlineMode ? await readOnlineStorage() : undefined;
      const contracts = loadScContracts(storage);
      const forecasts = legal ? [] : loadScOrderForecasts(storage);
      if (mounted) setSchedules({ forecasts, contracts });
    }).catch(() => {
      if (mounted) setSchedules(null);
    });
    return () => { mounted = false; };
  }, [legal]);

  const projectNames = new Map(projects.map((project) => [project.code, project.name]));
  const contracts = new Map(schedules?.contracts.map((row) => [scOrderKey(row.projectCode, row.scNumber), row]));
  const dates = new Map(schedules?.forecasts.map((row) => [scOrderKey(row.projectCode, row.scNumber), row.forecastDate]));
  let pending: ScRow[] = [];
  if (finance) {
    if (legal) {
      const objectives = new Map(finance.requisitions.map((sc) => [scOrderKey(sc.projectCode, sc.code), sc.objective]));
      pending = [...contracts.values()].filter((row) => row.required).map((row) => ({
        projectCode: row.projectCode, code: row.scNumber, objective: objectives.get(scOrderKey(row.projectCode, row.scNumber)) ?? "",
      }));
    } else {
      pending = scsAwaitingOrders(finance);
    }
    pending = pending.filter((sc) => projectNames.has(sc.projectCode));
  }

  return <section className="space-y-4" aria-labelledby="sc-schedule-heading">
    <header>
      <h1 id="sc-schedule-heading" className="text-2xl font-bold">{legal ? "Jurídico" : "Compras"}</h1>
      <p className="mt-1 text-sm text-slate-500">{legal
        ? "Informe a data prevista de conclusão dos contratos solicitados por Compras."
        : "Informe a previsão de geração do pedido e se a SC necessita de contrato."}</p>
    </header>
    {schedules === null || financeUnavailable ? <p role="alert" className="text-sm text-red-800">Não foi possível carregar os dados das solicitações.</p> :
      schedules === undefined || !finance ? <p role="status" className="text-sm text-slate-500">Carregando solicitações…</p> :
      pending.length === 0 ? <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">{legal
        ? "Nenhuma SC necessita de contrato nos projetos disponíveis."
        : "Nenhuma SC sem pedido nos projetos disponíveis."}</p> :
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm" role="region" aria-label={legal ? "Solicitações com contrato" : "Solicitações sem pedido"} tabIndex={0}>
        <table className={`w-full text-left text-sm ${legal ? "min-w-[710px]" : "min-w-[900px]"}`}>
          <thead className="bg-slate-50"><tr>
            <th scope="col" className="p-3">Projeto</th>
            <th scope="col" className="p-3">SC</th>
            {!legal && <th scope="col" className="p-3">Comprador</th>}
            <th scope="col" className="p-3">Objetivo da contratação</th>
            {!legal && <th scope="col" className="p-3">Necessita contrato?</th>}
            <th scope="col" className="p-3">{legal ? "Previsão de conclusão do contrato" : "Previsão de geração do pedido"}</th>
          </tr></thead>
          <tbody>{pending.map((sc) => {
            const key = scOrderKey(sc.projectCode, sc.code);
            const contract = contracts.get(key);
            return <tr key={key} className="border-t align-top">
              <td className="p-3">{sc.projectCode} - {projectNames.get(sc.projectCode)}</td>
              <th scope="row" className="p-3 font-medium">{sc.code}</th>
              {!legal && <td className="p-3">{sc.reportFields?.Comprador?.join(", ") || "Não informado"}</td>}
              <td className="max-w-sm whitespace-pre-wrap break-words p-3">{sc.objective || "—"}<SankhyaReportDetails fields={sc.reportFields} /></td>
              {!legal && <td className="p-3"><ContractRequirementField sc={sc} initialRequired={contract?.required ?? null} /></td>}
              <td className="p-3"><ForecastField sc={sc} initialDate={(legal ? contract?.completionDate : dates.get(key)) ?? null} legal={legal} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
  </section>;
}
