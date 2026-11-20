"use client";

import type { ProjectBudget } from "../../lib/finance/types";
import type { ManualBudgetRequest } from "../../lib/finance/manual-project-budget";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ManualBudgetFields({ budget, request, onChange }: { budget: ProjectBudget | null; request: ManualBudgetRequest; onChange: (request: ManualBudgetRequest) => void }) {
  return <section className="space-y-3 rounded-lg border p-4 sm:col-span-2" aria-label="Orçamento do projeto">
    <h3 className="font-semibold">Orçamento do projeto</h3>
    <label className="block text-sm font-medium">Orçamento aprovado (R$)
      <input type="text" inputMode="decimal" required={!!budget} value={request.amount} placeholder="Ex.: 1234,56" onChange={(e) => onChange({ ...request, amount: e.target.value, correctionRequested: !!budget })} className="mt-1 block w-full rounded-lg border p-2" />
    </label>
    <p className="text-xs text-slate-500">As alterações serão registradas ao salvar o projeto.</p>
    <label className="block text-sm font-medium">Observação (opcional)
      <textarea value={request.justification} onChange={(e) => onChange({ ...request, justification: e.target.value })} className="mt-1 block w-full rounded-lg border p-2" />
    </label>
    {!budget?.corrections?.length && <div className="border-t pt-3"><h4 className="text-sm font-semibold">Log de alterações</h4><p className="mt-2 text-xs text-slate-500">Nenhuma alteração registrada.</p></div>}
    {!!budget?.corrections?.length && <div className="overflow-x-auto border-t pt-3" role="region" tabIndex={0} aria-label="Log de alterações do orçamento">
      <table className="w-full min-w-[550px] text-left text-xs">
        <caption className="mb-2 text-left font-semibold">Log de alterações</caption>
        <thead><tr>{["Data", "Valor anterior", "Novo valor", "Observação"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
        <tbody>{budget.corrections.map((entry, index) => <tr key={`${entry.recordedAt}:${index}`} className="border-t [&_td]:p-2"><td>{new Date(entry.recordedAt).toLocaleString("pt-BR")}</td><td>{entry.previousAmount === null ? "Primeiro cadastro" : money(entry.previousAmount)}</td><td>{money(entry.newAmount)}</td><td>{entry.justification}</td></tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
