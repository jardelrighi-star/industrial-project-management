"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { officialBudget } from "../../lib/finance/budget-reconciliation";
import { calculateCommittedBreakdown } from "../../lib/finance/calculations";
import { loadScContracts } from "../../lib/finance/sc-contract";
import { loadScOrderForecasts, scOrderKey, scsAwaitingOrders } from "../../lib/finance/sc-order-forecast";
import type { FinanceData } from "../../lib/finance/types";
import type { Project } from "../../lib/projects/types";
import { projectCalendarDate } from "../../lib/projects/project-date";
import { isScOpeningOverdue, loadProcurementPlan } from "../../lib/projects/procurement-plan";
import { readOnlineStorage } from "../../lib/online/client";
import { onlineMode } from "../../lib/online/state";

export type PortfolioFinancialState = { status: "loading" | "error" } | { status: "ready"; data: FinanceData };

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const filterClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base max-md:min-h-11 md:text-sm";
const compare = new Intl.Collator("pt-BR", { numeric: true }).compare;
const overdueScLabel = "SC em atraso";
const missingOrderForecastLabel = "SCs sem previsão de pedido";
type PlanningData = {
  procurement: ReturnType<typeof loadProcurementPlan>;
  orderForecasts: ReturnType<typeof loadScOrderForecasts>;
  contracts: ReturnType<typeof loadScContracts>;
};

function distinctOptions(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort(compare);
}

export default function PortfolioDashboard({ projects, financialState, actualCostsByProject }: {
  projects: readonly Project[];
  financialState: PortfolioFinancialState;
  actualCostsByProject: ReadonlyMap<string, number>;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [department, setDepartment] = useState("");
  const [owner, setOwner] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [planning, setPlanning] = useState<PlanningData | null>();
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const [showOverduePurchases, setShowOverduePurchases] = useState(false);

  useEffect(() => {
    let active = true;
    let request = 0;
    function refresh() {
      const current = ++request;
      void Promise.resolve().then(async () => {
        const storage = onlineMode ? await readOnlineStorage() : undefined;
        return {
          procurement: loadProcurementPlan(storage),
          orderForecasts: loadScOrderForecasts(storage),
          contracts: loadScContracts(storage),
        };
      }).then((data) => {
        if (active && request === current) setPlanning(data);
      }).catch(() => {
        if (active && request === current) setPlanning(null);
      });
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, []);
  const { departments, selectedDepartment, owners, selectedOwner, projectOptions, selectedProject, visibleProjects } = useMemo(() => {
    const departments = distinctOptions(projects.map((project) => project.department));
    const selectedDepartment = departments.includes(department) ? department : "";
    const inDepartment = projects.filter((project) => !selectedDepartment || project.department === selectedDepartment);
    const owners = distinctOptions(inDepartment.map((project) => project.owner));
    const selectedOwner = owners.includes(owner) ? owner : "";
    const projectOptions = inDepartment.filter((project) => !selectedOwner || project.owner === selectedOwner)
      .sort((first, second) => compare(first.code, second.code));
    const selectedProject = projectOptions.find((project) => project.code === projectCode);
    return {
      departments, selectedDepartment, owners, selectedOwner, projectOptions, selectedProject,
      visibleProjects: selectedProject ? [selectedProject] : projectOptions,
    };
  }, [projects, department, owner, projectCode]);
  const hasFilter = Boolean(selectedDepartment || selectedOwner || selectedProject);
  const visibleCodes = new Set(visibleProjects.map((project) => project.code));
  const plannedPurchases = planning?.procurement.purchases.filter((purchase) => visibleCodes.has(purchase.projectCode));
  const plannedTotal = plannedPurchases?.reduce((sum, purchase) => sum + purchase.estimatedCents, 0);
  const updatedBudgets = financialState.status === "ready"
    ? new Map(financialState.data.budgets.filter((budget) => visibleCodes.has(budget.projectCode))
      .map((budget) => [budget.projectCode, budget.updatedAmount]))
    : new Map<string, number>();
  const updatedTotal = [...updatedBudgets.values()].reduce((sum, cents) => sum + cents, 0);
  const validPlannedTotal = typeof plannedTotal === "number" && Number.isSafeInteger(plannedTotal);
  const plannedShare = validPlannedTotal && Number.isSafeInteger(updatedTotal) && updatedTotal > 0 &&
    plannedPurchases?.every((purchase) => purchase.estimatedCents === 0 || updatedBudgets.has(purchase.projectCode))
    ? plannedTotal / updatedTotal : null;
  const officialAmounts = financialState.status === "ready"
    ? visibleProjects.map((project) => officialBudget(project.code, financialState.data)).filter((value): value is number => value !== null)
    : [];
  const totalBudget = officialAmounts.reduce((sum, cents) => sum + cents, 0);
  const totalActual = visibleProjects.reduce((sum, project) => sum + (actualCostsByProject.get(project.code) ?? 0), 0);
  const committed = useMemo(() => {
    if (financialState.status !== "ready") return null;
    try { return calculateCommittedBreakdown(visibleProjects.map((project) => project.code), financialState.data); }
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
  const today = projectCalendarDate();
  const overdueCount = visibleProjects.filter((project) =>
    project.status !== "Concluído" && project.status !== "Cancelado" &&
    /^\d{4}-\d{2}-\d{2}$/.test(project.finish) && project.finish < today,
  ).length;
  const overduePurchases = plannedPurchases?.filter((purchase) => isScOpeningOverdue(purchase, today));
  let missingOrderForecasts: ReturnType<typeof scsAwaitingOrders> | undefined;
  let overdueOrderCount: number | null = null;
  if (financialState.status === "ready" && planning) {
    const orderForecastDates = new Map(planning.orderForecasts.map((row) => [scOrderKey(row.projectCode, row.scNumber), row.forecastDate]));
    missingOrderForecasts = [];
    overdueOrderCount = 0;
    for (const sc of scsAwaitingOrders(financialState.data)) {
      if (!visibleCodes.has(sc.projectCode)) continue;
      const date = orderForecastDates.get(scOrderKey(sc.projectCode, sc.code));
      if (!date) missingOrderForecasts.push(sc);
      else if (date < today) overdueOrderCount++;
    }
  }
  const plannedOpeningDatesBySc = new Map<string, Set<string>>();
  for (const purchase of plannedPurchases ?? []) {
    const scNumber = purchase.scNumber?.trim();
    const date = purchase.scOpeningForecast;
    if (!scNumber || !date) continue;
    const key = scOrderKey(purchase.projectCode, scNumber);
    const dates = plannedOpeningDatesBySc.get(key) ?? new Set<string>();
    dates.add(date);
    plannedOpeningDatesBySc.set(key, dates);
  }
  const requiredContracts = planning?.contracts.filter((contract) => visibleCodes.has(contract.projectCode) && contract.required);
  const missingContractForecastCount = requiredContracts?.filter((contract) => !contract.completionDate).length;
  const overdueContractCount = requiredContracts?.filter((contract) => contract.completionDate && contract.completionDate < today).length;
  const pendingStatus = planning === null || financialState.status === "error" ? "Indisponível" : "Carregando…";
  const planningStatus = planning === null ? "Indisponível" : "Carregando…";
  const overdueScValue = overduePurchases?.length ?? planningStatus;
  const cards = [
    ["Projetos cadastrados", visibleProjects.length, hasFilter ? "No filtro selecionado" : "Carteira total"],
    ["Status dos projetos", null, null],
    ["Projetos atrasados", overdueCount, "Prazo planejado vencido"],
    [overdueScLabel, overdueScValue, "Contratações sem SC vinculada e com prazo de abertura vencido"],
    [missingOrderForecastLabel, missingOrderForecasts?.length ?? pendingStatus, "Solicitações ainda sem pedido e sem data prevista"],
    ["Contratos sem previsão de conclusão", missingContractForecastCount ?? planningStatus, "SCs marcadas como necessitando contrato"],
    ["Pedidos em atraso", overdueOrderCount ?? pendingStatus, "SCs sem pedido com previsão vencida"],
    ["Contratos em atraso", overdueContractCount ?? planningStatus, "Contratos necessários com previsão vencida"],
  ] as const;
  const financialCards = [
    { label: "Custos realizados", total: Number.isSafeInteger(totalActual) ? totalActual : null },
    { label: "Comprometido", total: committed?.totalCommitted ?? null, breakdown: [
      { label: "SC", amount: committed?.approvedUnconvertedRequisitions },
      { label: "Pedidos", amount: committed?.uninvoicedOrderBalance },
    ] },
  ];

  return <>
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4 md:mb-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Visão geral da carteira de projetos industriais</p>
      </div>
      <div className="hidden rounded-lg border bg-white px-4 py-2 text-sm md:block">Unidade Industrial | 2026</div>
    </header>
    <div className="mb-6 rounded-xl border bg-white shadow-sm">
      <button type="button" aria-expanded={filtersOpen} aria-controls="dashboard-filters"
        onClick={() => setFiltersOpen((open) => !open)}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-sm font-semibold md:hidden">
        <span>Filtros{hasFilter && ` (${[selectedDepartment, selectedOwner, selectedProject].filter(Boolean).length} ativos)`}</span>
        <span aria-hidden="true">{filtersOpen ? "▴" : "▾"}</span>
      </button>
      <div id="dashboard-filters" role="group" aria-label="Filtros do Dashboard" className={`gap-4 p-4 md:grid md:grid-cols-3 ${filtersOpen ? "grid border-t md:border-0" : "hidden"}`}>
        <label className="min-w-0 text-sm font-medium">Departamento
          <select className={filterClass} value={selectedDepartment} onChange={(event) => {
            setDepartment(event.target.value);
            setOwner("");
            setProjectCode("");
          }}>
            <option value="">Todos os departamentos</option>
            {departments.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">Gestor do projeto
          <select className={filterClass} value={selectedOwner} onChange={(event) => {
            setOwner(event.target.value);
            setProjectCode("");
          }}>
            <option value="">Todos os gestores de projeto</option>
            {owners.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">Projeto
          <select className={filterClass} value={selectedProject?.code ?? ""} onChange={(event) => setProjectCode(event.target.value)}>
            <option value="">Todos os projetos</option>
            {projectOptions.map((project) => <option key={project.code} value={project.code}>{project.code} - {project.name}</option>)}
          </select>
        </label>
      </div>
    </div>
    <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">Orçamento original aprovado</p>
        <p className="mt-3 text-lg font-semibold">{budget}</p>
        <p className="mt-1 text-xs text-slate-500">{officialAmounts.length} de {visibleProjects.length} projetos com orçamento oficial</p>
      </div>
      {financialCards.map(({ label, total, breakdown }) => <div key={label}
        className={`rounded-xl border bg-white p-5 shadow-sm ${breakdown ? "flex flex-wrap items-start justify-between gap-x-4 gap-y-2" : ""}`}>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className={`mt-3 text-lg font-semibold ${hasTotals && total !== null ? "text-slate-800" : "text-slate-400"}`}>
            {hasTotals && total !== null ? money(total) : missingTotal}
          </p>
        </div>
        {breakdown && <dl aria-label="Composição do comprometido" className="space-y-1 text-xs">
          {breakdown.map(({ label, amount }) => <div key={label} className="flex justify-between gap-3">
            <dt className="text-slate-500">{label}</dt>
            <dd className="whitespace-nowrap font-semibold tabular-nums">{amount === undefined ? "—" : money(amount)}</dd>
          </div>)}
        </dl>}
      </div>)}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">Orçamento planejado</p>
        <p className={`mt-3 text-lg font-semibold ${validPlannedTotal ? "text-slate-800" : "text-slate-400"}`}>
          {validPlannedTotal ? money(plannedTotal) : planning === undefined ? "Carregando…" : "Indisponível"}
        </p>
        <p className={`mt-1 text-xs ${plannedShare !== null && plannedShare > 1 ? "font-semibold text-red-700" : "text-slate-500"}`}>
          {plannedShare === null ? "Percentual indisponível" : `${percent.format(plannedShare)} do orçamento atualizado`}
        </p>
      </div>
    </section>
    <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
      {cards.map(([label, value, detail]) => (label === missingOrderForecastLabel || label === overdueScLabel) ? <button
        key={label} type="button" aria-haspopup="dialog"
        onClick={() => {
          setShowOverduePurchases(label === overdueScLabel);
          detailsDialog.current?.showModal();
        }}
        className="cursor-pointer rounded-xl border bg-white p-5 text-left shadow-sm hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="block text-sm text-slate-500">{label}</span>
        <span className="my-3 block text-2xl font-bold">{value}</span>
        <span className="block text-xs text-slate-400">{detail}</span>
        <span className="mt-2 block text-xs font-medium text-slate-700 underline">{label === overdueScLabel ? "Ver itens do plano em atraso" : "Ver SCs sem previsão"}</span>
      </button> : <div key={label} className="rounded-xl border bg-white p-5 shadow-sm">
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
    <dialog ref={detailsDialog} aria-labelledby="overdue-purchases-heading"
      className="m-auto h-dvh max-h-dvh w-full max-w-full overflow-y-auto overscroll-contain bg-white px-4 pb-6 shadow-xl backdrop:bg-slate-950/60 md:h-auto md:max-h-[calc(100%-2rem)] md:w-[calc(100%-2rem)] md:max-w-2xl md:rounded-xl md:border md:p-6">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white py-3 md:static md:flex-wrap md:border-0 md:p-0">
        <h2 id="overdue-purchases-heading" className="text-lg font-bold">
          {showOverduePurchases ? "Itens do Plano de Aquisições em atraso" : missingOrderForecastLabel}
        </h2>
        <form method="dialog" className="shrink-0">
          <button type="submit" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 max-md:min-h-11">Fechar</button>
        </form>
      </div>
      {showOverduePurchases ? (overduePurchases === undefined ? <p className="mt-4 text-sm text-slate-600">{planningStatus}</p>
        : overduePurchases.length === 0 ? <p className="mt-4 text-sm text-slate-600">Nenhum item com abertura da SC em atraso no filtro atual.</p>
        : <ul className="mt-4 divide-y text-sm">
          {overduePurchases.map((purchase) => <li key={purchase.id} className="break-words py-3">
            <p className="font-semibold">{purchase.title || purchase.description}</p>
            {purchase.title && <p className="mt-1 text-slate-600">{purchase.description}</p>}
            <p className="mt-1 text-slate-600">Projeto {purchase.projectCode}</p>
            <p className="mt-1 text-red-700">Abertura da SC prevista para {purchase.scOpeningForecast?.split("-").reverse().join("/")}</p>
          </li>)}
        </ul>) : (missingOrderForecasts === undefined ? <p className="mt-4 text-sm text-slate-600">{pendingStatus}</p>
        : missingOrderForecasts.length === 0 ? <p className="mt-4 text-sm text-slate-600">Nenhuma SC sem previsão de pedido no filtro atual.</p>
        : <ul className="mt-4 divide-y text-sm">
          {missingOrderForecasts.map((sc) => {
            const key = scOrderKey(sc.projectCode, sc.code);
            const dates = [...(plannedOpeningDatesBySc.get(key) ?? [])].sort()
              .map((date) => date.split("-").reverse().join("/"));
            return <li key={key} className="break-words py-3">
              <p className="font-semibold">SC {sc.code} · Projeto {sc.projectCode}</p>
              <p className="mt-1 whitespace-pre-wrap">{sc.objective?.trim() || "Descrição não informada"}</p>
              <p className="mt-1 text-slate-600">Previsão de abertura da SC no plano: {dates.join(", ") || "Não informada"}</p>
            </li>;
          })}
        </ul>)}
    </dialog>
  </>;
}
