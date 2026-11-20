"use client";

import { useMemo, useState } from "react";
import { officialBudget } from "../../lib/finance/budget-reconciliation";
import { calculateCommittedTotal } from "../../lib/finance/calculations";
import type { FinanceData } from "../../lib/finance/types";
import type { Project } from "../../lib/projects/types";

export type PortfolioFinancialState = { status: "loading" | "error" } | { status: "ready"; data: FinanceData };

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const filterClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const compare = new Intl.Collator("pt-BR", { numeric: true }).compare;

function distinctOptions(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort(compare);
}

export default function PortfolioDashboard({ projects, financialState, actualCostsByProject }: {
  projects: readonly Project[];
  financialState: PortfolioFinancialState;
  actualCostsByProject: ReadonlyMap<string, number>;
}) {
  const [category, setCategory] = useState("");
  const [owner, setOwner] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const { categories, selectedCategory, owners, selectedOwner, projectOptions, selectedProject, visibleProjects } = useMemo(() => {
    const categories = distinctOptions(projects.map((project) => project.category));
    const selectedCategory = categories.includes(category) ? category : "";
    const inCategory = projects.filter((project) => !selectedCategory || project.category === selectedCategory);
    const owners = distinctOptions(inCategory.map((project) => project.owner));
    const selectedOwner = owners.includes(owner) ? owner : "";
    const projectOptions = inCategory.filter((project) => !selectedOwner || project.owner === selectedOwner)
      .sort((first, second) => compare(first.code, second.code));
    const selectedProject = projectOptions.find((project) => project.code === projectCode);
    return {
      categories, selectedCategory, owners, selectedOwner, projectOptions, selectedProject,
      visibleProjects: selectedProject ? [selectedProject] : projectOptions,
    };
  }, [projects, category, owner, projectCode]);
  const hasFilter = Boolean(selectedCategory || selectedOwner || selectedProject);
  const officialAmounts = financialState.status === "ready"
    ? visibleProjects.map((project) => officialBudget(project.code, financialState.data)).filter((value): value is number => value !== null)
    : [];
  const totalBudget = officialAmounts.reduce((sum, cents) => sum + cents, 0);
  const totalActual = visibleProjects.reduce((sum, project) => sum + (actualCostsByProject.get(project.code) ?? 0), 0);
  const totalCommitted = useMemo(() => {
    if (financialState.status !== "ready") return null;
    try { return calculateCommittedTotal(visibleProjects.map((project) => project.code), financialState.data); }
    catch { return null; }
  }, [visibleProjects, financialState]);
  const hasTotals = financialState.status === "ready";
  const missingTotal = financialState.status === "loading" ? "Carregando…" : "Indisponível";
  const budget = hasTotals && Number.isSafeInteger(totalBudget)
    ? officialAmounts.length ? money(totalBudget) : "Não cadastrado no financeiro"
    : "Indisponível";
  const countsByStatus = new Map<string, number>();
  for (const project of visibleProjects) {
    const status = project.status || "Não informado";
    countsByStatus.set(status, (countsByStatus.get(status) ?? 0) + 1);
  }
  const statuses = [...countsByStatus].sort(([first], [second]) => compare(first, second));
  const cards = [
    ["Projetos cadastrados", visibleProjects.length, hasFilter ? "No filtro selecionado" : "Carteira total"],
    ["Status dos projetos", null, null],
    ["Orçamento original aprovado", budget, `${officialAmounts.length} de ${visibleProjects.length} projetos com orçamento oficial`],
    ["Projetos com atenção", visibleProjects.filter((project) => project.status === "Atenção").length, "Requerem acompanhamento"],
  ] as const;
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
    <div role="group" aria-label="Filtros do Dashboard" className="mb-6 grid gap-4 rounded-xl border bg-white p-4 shadow-sm sm:grid-cols-3">
      <label className="text-sm font-medium">Categoria
        <select className={filterClass} value={selectedCategory} onChange={(event) => {
          setCategory(event.target.value);
          setOwner("");
          setProjectCode("");
        }}>
          <option value="">Todas as categorias</option>
          {categories.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">Responsável
        <select className={filterClass} value={selectedOwner} onChange={(event) => {
          setOwner(event.target.value);
          setProjectCode("");
        }}>
          <option value="">Todos os responsáveis</option>
          {owners.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">Projeto
        <select className={filterClass} value={selectedProject?.code ?? ""} onChange={(event) => setProjectCode(event.target.value)}>
          <option value="">Todos os projetos</option>
          {projectOptions.map((project) => <option key={project.code} value={project.code}>{project.code} - {project.name}</option>)}
        </select>
      </label>
    </div>
    <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value, detail]) => <div key={label} className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">{label}</p>
        {value === null ? <div className="mt-2 h-16 overflow-y-auto text-xs" role="region" aria-label={label} tabIndex={statuses.length > 4 ? 0 : undefined}>
          {statuses.length > 0 ? <dl className="pr-1">
            {statuses.map(([status, count]) => <div key={status} className="flex justify-between gap-2">
              <dt className="text-slate-600">{status}</dt>
              <dd className="font-semibold tabular-nums">{count}</dd>
            </div>)}
          </dl> : <p className="text-slate-500">Nenhum projeto no filtro.</p>}
        </div> : <>
          <p className="my-3 text-2xl font-bold">{value}</p>
          <p className="text-xs text-slate-400">{detail}</p>
        </>}
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
