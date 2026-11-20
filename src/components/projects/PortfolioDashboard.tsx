"use client";

import { useMemo } from "react";
import { officialBudget } from "../../lib/finance/budget-reconciliation";
import { calculateCommittedTotal } from "../../lib/finance/calculations";
import type { FinanceData } from "../../lib/finance/types";
import type { Project } from "../../lib/projects/types";

export type PortfolioFinancialState = { status: "loading" | "error" } | { status: "ready"; data: FinanceData };

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PortfolioDashboard({ projects, financialState, actualCostsByProject }: {
  projects: readonly Project[];
  financialState: PortfolioFinancialState;
  actualCostsByProject: ReadonlyMap<string, number>;
}) {
  const officialAmounts = financialState.status === "ready"
    ? projects.map((project) => officialBudget(project.code, financialState.data)).filter((value): value is number => value !== null)
    : [];
  const totalBudget = officialAmounts.reduce((sum, cents) => sum + cents, 0);
  const totalActual = projects.reduce((sum, project) => sum + (actualCostsByProject.get(project.code) ?? 0), 0);
  const totalCommitted = useMemo(() => {
    if (financialState.status !== "ready") return null;
    try { return calculateCommittedTotal(projects.map((project) => project.code), financialState.data); }
    catch { return null; }
  }, [projects, financialState]);
  const hasTotals = financialState.status === "ready";
  const missingTotal = financialState.status === "loading" ? "Carregando…" : "Indisponível";
  const budget = hasTotals && Number.isSafeInteger(totalBudget)
    ? officialAmounts.length ? money(totalBudget) : "Não cadastrado no financeiro"
    : "Indisponível";
  const cards = [
    ["Projetos cadastrados", projects.length, "Carteira total"],
    ["Em andamento", projects.filter((project) => project.status === "Em andamento").length, "Projetos ativos"],
    ["Orçamento original aprovado", budget, `${officialAmounts.length} de ${projects.length} projetos com orçamento oficial; os demais não compõem a soma`],
    ["Projetos com atenção", projects.filter((project) => project.status === "Atenção").length, "Requerem acompanhamento"],
  ];
  const financialCards = [
    { label: "Custos realizados", total: Number.isSafeInteger(totalActual) ? totalActual : null },
    { label: "Comprometido", total: totalCommitted },
    { label: "Saldo disponível", total: null, placeholder: "Aguardando integração" },
  ];

  return <>
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Visão geral da carteira de projetos industriais</p>
      </div>
      <div className="rounded-lg border bg-white px-4 py-2 text-sm">Unidade Industrial | 2026</div>
    </header>
    <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value, detail]) => <div key={label} className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="my-3 text-2xl font-bold">{value}</p>
        <p className="text-xs text-slate-400">{detail}</p>
      </div>)}
    </section>
    <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
      {financialCards.map(({ label, total, placeholder }) => <div key={label} className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">{label}</p>
        <p className={`mt-3 text-lg font-semibold ${hasTotals && total !== null ? "text-slate-800" : "text-slate-400"}`}>
          {hasTotals && total !== null ? money(total) : placeholder ?? missingTotal}
        </p>
      </div>)}
    </section>
  </>;
}
