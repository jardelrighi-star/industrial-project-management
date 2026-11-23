
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FinanceProjectPanel from "../components/finance/FinanceProjectPanel";
import ProcurementPlan from "../components/projects/ProcurementPlan";
import PortfolioDashboard, { type PortfolioFinancialState } from "../components/projects/PortfolioDashboard";
import Purchasing from "../components/finance/Purchasing";
import ActualCostReviewQueue from "../components/finance/ActualCostReviewQueue";
import ActualCostReport from "../components/finance/ActualCostReport";
import ImportCenter from "../components/imports/ImportCenter";

import type { Project } from "../lib/projects/types";
import { LocalStorageProjectRepository } from "../lib/projects/repository";
import { LocalStorageFinanceRepository } from "../lib/finance/repository";
import { officialBudget } from "../lib/finance/budget-reconciliation";
import BudgetReconciliation from "../components/finance/BudgetReconciliation";
import { PROJECT_KEY, FINANCE_KEY, TRANSACTION_KEY } from "../lib/coordinated-storage";
import { ManualProjectBudgetRepository, planManualProjectSave, budgetInputValue, type ManualBudgetRequest, type ManualProjectSnapshot, type ManualProjectPlan } from "../lib/finance/manual-project-budget";
import ManualBudgetFields from "../components/finance/ManualBudgetFields";
import OnlineGate from "../components/OnlineGate";
import { canScheduleContracts, canScheduleOrders, onlineMode, type OnlineSession } from "../lib/online/state";

const projectRepository = new LocalStorageProjectRepository();
const financeRepository = new LocalStorageFinanceRepository();
const manualBudgetRepository = new ManualProjectBudgetRepository();
const emptyBudgetRequest: ManualBudgetRequest = { amount: "", correctionRequested: false, justification: "" };
const projectTabs = ["Resumo", "Plano de Aquisições", "Financeiro", "Cronograma", "Documentação", "ATAS"] as const;

const emptyProject: Project = {
  code: "",
  name: "",
  unit: "Unidade Industrial",
  department: "",
  type: "CAPEX",
  category: "Confiabilidade",
  owner: "",
  manager: "",
  start: "",
  finish: "",
  budget: 0,
  priority: "Média",
  status: "Planejado",
  progress: 0,
};

const money = (value: number) =>
  value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });

export default function Home() {
  return onlineMode ? <OnlineGate>{(session, logout) => <WorkspaceHome session={session} logout={logout} />}</OnlineGate> : <WorkspaceHome />;
}

function WorkspaceHome({ session, logout }: { session?: OnlineSession; logout?: () => void }) {
  const canAdminister = !session || session.role === "admin";
  const canAnalyze = canAdminister || session?.role === "analyst";
  const canManage = canAdminister || session?.role === "manager";
  const canAccessPurchasing = !session || canScheduleOrders(session.role);
  const canAccessLegal = !session || canScheduleContracts(session.role);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [budgetRevision, setBudgetRevision] = useState(0);
  const [financialState, setFinancialState] = useState<PortfolioFinancialState>({ status: "loading" });
  const savingRef = useRef(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [form, setForm] = useState<Project>(emptyProject);
  const [formBaseline, setFormBaseline] = useState<ManualProjectSnapshot | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [budgetRequest, setBudgetRequest] = useState<ManualBudgetRequest>(emptyBudgetRequest);
  const [pendingRecovery, setPendingRecovery] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const formRequest = useRef(0);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
const [selectedProjectCode, setSelectedProjectCode] = useState<string | null>(null);
const [activeTab, setActiveTab] = useState<(typeof projectTabs)[number]>("Resumo");
const [activeSection, setActiveSection] = useState("Dashboard");

const selectedProject = projects.find(
  (project) => project.code === selectedProjectCode
);
const formBudget = formBaseline?.finance.budgets.find((budget) => budget.projectCode === editingCode) ?? null;

function openDetails(project: Project) {
  setSelectedProjectCode(project.code);
  setActiveTab("Resumo");
}
  useEffect(() => {
    let active = true;
    void projectRepository.load().then((saved) => {
      if (!active) return;
      setProjects(saved ?? []);
      setPendingRecovery(manualBudgetRepository.pendingRecovery());
      setLoadError("");
      setLoaded(true);
    }).catch((cause: unknown) => {
      if (active) setLoadError(cause instanceof Error ? cause.message : "Não foi possível recuperar os dados locais.");
    });
    return () => { active = false; };
  }, [loadAttempt]);

  useEffect(() => {
    let active = true;
    void financeRepository.load().then((data) => {
      if (active) setFinancialState({ status: "ready", data });
    }).catch(() => { if (active) setFinancialState({ status: "error" }); });
    return () => { active = false; };
  }, [budgetRevision]);

  useEffect(() => {
    function refresh(event: StorageEvent) {
      if (event.key === null || event.key === PROJECT_KEY || event.key === TRANSACTION_KEY) {
        setLoadAttempt((value) => value + 1);
      }
      if (event.key === null || event.key === FINANCE_KEY || event.key === TRANSACTION_KEY) {
        setFinancialState({ status: "loading" });
        setBudgetRevision((value) => value + 1);
      }
    }
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  useEffect(() => {
    if (!session) return;
    const refresh = () => {
      setLoadAttempt((value) => value + 1);
      setBudgetRevision((value) => value + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [session]);

  function refreshBudgets() {
    setFinancialState({ status: "loading" });
    setBudgetRevision((value) => value + 1);
  }

  function budgetLabel(code: string) {
    if (financialState.status === "loading") return "Carregando orçamento…";
    if (financialState.status !== "ready") return "Orçamento indisponível";
    const cents = officialBudget(code, financialState.data);
    return cents === null ? "Não cadastrado no financeiro" : money(cents / 100);
  }

  const actualCostsByProject = useMemo(() => {
    const totals = new Map<string, number>();
    if (financialState.status === "ready") {
      for (const cost of financialState.data.actualCosts) {
        totals.set(cost.projectCode, (totals.get(cost.projectCode) ?? 0) + cost.amount);
      }
    }
    return totals;
  }, [financialState]);

  function actualCostLabel(code: string) {
    if (financialState.status === "loading") return "Carregando…";
    if (financialState.status !== "ready") return "Indisponível";
    return money((actualCostsByProject.get(code) ?? 0) / 100);
  }

  async function persistProjects(next: Project[]): Promise<boolean> {
    if (!loaded || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await projectRepository.save(next, projects);
      setProjects(next);
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Não foi possível salvar os projetos.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const filteredProjects = useMemo(() => {
    const term = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.code.toLowerCase().includes(term) ||
        p.name.toLowerCase().includes(term) ||
        p.owner.toLowerCase().includes(term)
    );
  }, [projects, search]);

  function openNew() {
    void openProjectForm(null);
  }

  function openEdit(project: Project) {
    void openProjectForm(project.code);
  }

  async function openProjectForm(code: string | null) {
    if (savingRef.current) return;
    const id = ++formRequest.current;
    setEditingCode(code); setForm(emptyProject); setFormBaseline(null);
    setBudgetRequest(emptyBudgetRequest); setMessage(""); setSaveError(""); setSavedNotice("");
    setFormOpen(true); setFormLoading(true);
    try {
      const baseline = await manualBudgetRepository.load();
      if (id !== formRequest.current) return;
      const existing = code === null ? null : baseline.projects.find((p) => p.code === code);
      if (code !== null && !existing) throw new Error("O projeto não está mais cadastrado. Atualize a tela.");
      setForm(existing ? { ...existing } : emptyProject);
      setFormBaseline(baseline);
      const budget = baseline.finance.budgets.find((b) => b.projectCode === code);
      setBudgetRequest({ ...emptyBudgetRequest, amount: budget ? budgetInputValue(budget.originalApprovedAmount) : "" });
      setPendingRecovery(manualBudgetRepository.pendingRecovery());
    } catch (cause) { if (id === formRequest.current) setMessage(cause instanceof Error ? cause.message : "Não foi possível ler o cadastro e o orçamento."); }
    finally { if (id === formRequest.current) setFormLoading(false); }
  }

  function closeProjectForm() {
    if (savingRef.current) return;
    formRequest.current++;
    setFormOpen(false);
  }

  async function applyManualPlan(plan: ManualProjectPlan, confirmed: boolean) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setSaveError("");
    try {
      const result = await manualBudgetRepository.save(plan, confirmed);
      setProjects(plan.projects); setFormOpen(false);
      setPendingRecovery(result.recoveryPending);
      setSavedNotice(result.recoveryPending ? "Projeto salvo. Há sincronização pendente." : "Projeto salvo.");
      setLoadAttempt((value) => value + 1); refreshBudgets();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Não foi possível salvar. Nenhuma alteração parcial foi aplicada.");
    } finally { savingRef.current = false; setSaving(false); }
  }

  async function recoverManualSave() {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setSaveError("");
    try {
      await manualBudgetRepository.recover(); setPendingRecovery(false);
      setSavedNotice("Sincronização concluída. Cadastro e orçamento já estavam confirmados juntos.");
      setLoadAttempt((value) => value + 1); refreshBudgets();
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Sincronização ainda pendente."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  async function saveProject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingRef.current || !loaded || !formBaseline) return;
    try {
      setMessage(""); setSaveError("");
      const plan = planManualProjectSave(formBaseline, form, editingCode, budgetRequest, new Date().toISOString());
      await applyManualPlan(plan, true);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Dados cadastrais inválidos.");
    }
  }

  async function deleteProject(code: string) {
    if (savingRef.current || !loaded) return;
    if (window.confirm(`Deseja excluir o projeto ${code}?`)) {
      await persistProjects(projects.filter((p) => p.code !== code));
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 md:flex">
      <aside className="w-full bg-slate-950 p-6 text-white md:min-h-screen md:w-64">
        <div className="mb-10">
          <div className="text-xl font-bold tracking-wide">INDUSTRIAL</div>
          <div className="text-sm text-blue-300">PROJECT MANAGEMENT</div>
          <div className="mt-2 text-xs text-slate-400">
            Engineering & Maintenance
          </div>
        </div>

        <div className="mb-3 text-xs uppercase tracking-widest text-slate-500">
          Menu principal
        </div>

        <nav className="space-y-2">
          {[
            ["▦", "Dashboard"],
            ["▤", "Projetos"],
            ["▣", "Compras"],
            ["§", "Jurídico"],
            ["⇩", "Importações"],
            ["▦", "Cronogramas"],
            ["R$", "Financeiro"],
            ["⇄", "Reconciliação"],
            ["✓", "Análise de custos"],
            ["▧", "Relatórios"],
            ["⚙", "Configurações"],
          ].filter(([, label]) => {
            if (label === "Importações" || label === "Reconciliação") return canAdminister;
            if (label === "Análise de custos") return canAnalyze;
            if (label === "Compras") return canAccessPurchasing;
            if (label === "Jurídico") return canAccessLegal;
            return true;
          }).map(([icon, label]) => (
            <button
              key={label}
              onClick={() => {
                if (["Dashboard", "Projetos", "Compras", "Jurídico", "Importações", "Reconciliação", "Análise de custos", "Relatórios"].includes(label)) {
                  setActiveSection(label);
                  setSelectedProjectCode(null);
                  setFormOpen(false);
                } else alert("Este módulo será desenvolvido em uma próxima etapa.");
              }}
              aria-current={activeSection === label ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm ${
                activeSection === label
                  ? "bg-blue-600 text-white"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        {session && <div className="mt-6 space-y-2 border-t border-slate-800 pt-4 text-sm">
          <p className="break-all text-slate-300">{session.email}</p>
          <button type="button" onClick={logout} className="font-medium text-blue-300 hover:underline">Sair</button>
        </div>}
        <div className="mt-16 border-t border-slate-800 pt-5 text-xs text-slate-500">
          Industrial Project Management
          <br />
          Versão 0.2
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-5 md:p-8">
        {loadError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
          <p>{loadError}</p>
          <button type="button" className="mt-3 rounded-lg border px-4 py-2" onClick={() => { setLoadError(""); setLoadAttempt((value) => value + 1); }}>Tentar novamente</button>
        </div>}
        {!loaded && !loadError && <p role="status">Carregando carteira de projetos…</p>}
        {saveError && !formOpen && <p role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">{saveError}</p>}
        {savedNotice && <p role="status" className="mb-5 rounded-lg bg-blue-50 p-4 text-blue-900">{savedNotice}</p>}
        {pendingRecovery && <div role="status" className="mb-5 rounded-lg bg-amber-50 p-4 text-amber-900">Há uma gravação já confirmada com sincronização de compatibilidade pendente. Os repositórios consultam os dados completos. <button type="button" disabled={saving} onClick={() => void recoverManualSave()} className="underline">Concluir sincronização</button></div>}
        {financialState.status === "error" && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-4 text-red-800">Não foi possível consultar o orçamento financeiro. Nenhum valor legado será utilizado. <button type="button" onClick={refreshBudgets} className="underline">Tentar novamente</button></div>}
        {activeSection === "Reconciliação" && loaded && <BudgetReconciliation onConfirmed={refreshBudgets} />}
        {activeSection === "Análise de custos" && loaded && <ActualCostReviewQueue />}
        {activeSection === "Compras" && canAccessPurchasing && loaded && (
          <Purchasing projects={projects} finance={financialState.status === "ready" ? financialState.data : undefined}
            financeUnavailable={financialState.status === "error"} />
        )}
        {activeSection === "Jurídico" && canAccessLegal && loaded && (
          <Purchasing legal projects={projects} finance={financialState.status === "ready" ? financialState.data : undefined}
            financeUnavailable={financialState.status === "error"} />
        )}
        {activeSection === "Relatórios" && loaded && <ActualCostReport />}
        {activeSection === "Importações" && loaded && canAdminister && <ImportCenter projectCodes={projects.map((project) => project.code)} onImported={() => { setLoadAttempt((value) => value + 1); refreshBudgets(); }} />}
        {loaded && activeSection === "Dashboard" && (
          <PortfolioDashboard projects={projects} financialState={financialState} actualCostsByProject={actualCostsByProject} />
        )}
        {loaded && activeSection === "Projetos" && !selectedProject && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Projetos</h1>
              <p className="text-sm text-slate-500">
                Cadastro e acompanhamento dos projetos
              </p>
            </div>
            {canAdminister && <button
              onClick={openNew}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Novo projeto
            </button>}
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por código, projeto ou gestor do projeto..."
            className="mb-5 w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
          />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
 <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
  <tr>
    <th className="p-3">Código</th>
    <th className="p-3">Projeto</th>
    <th className="p-3">Gestor do projeto</th>
    <th className="p-3">Orçamento</th>
    <th className="p-3">Realizado</th>
    <th className="p-3">Avanço físico</th>
    <th className="p-3">Status</th>
    <th className="p-3">Ações</th>
  </tr>
</thead>
              <tbody>
                {filteredProjects.map((project) => (
                  <tr key={project.code} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="p-3 text-xs text-slate-500">{project.code}</td>
<td className="p-3 font-medium">
  <button
    onClick={() => openDetails(project)}
    className="text-blue-600 hover:underline"
  >
    {project.name}
  </button>
</td>                    <td className="p-3">{project.owner || "-"}</td>
                    <td className="p-3">{budgetLabel(project.code)}</td>
                    <td className="whitespace-nowrap p-3">{actualCostLabel(project.code)}</td>
                    <td className="p-3">
                      <div className="mb-1">{project.progress}%</div>
                      <div className="h-2 w-24 rounded-full bg-slate-200">
                        <div
                          className="h-2 rounded-full bg-blue-600"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${
                        project.status === "Atenção"
                          ? "bg-amber-100 text-amber-700"
                          : project.status === "Concluído"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-green-100 text-green-700"
                      }`}>
                        {project.status}
                      </span>
                    </td>
                    <td className="p-3">
   <div className="flex gap-3">
  <button
    onClick={() => openDetails(project)}
    className="text-blue-600 hover:underline"
  >
    Abrir
  </button>

  {canAdminister && <><button
    onClick={() => openEdit(project)}
    className="text-blue-600 hover:underline"
  >
    Editar
  </button>

  <button
    onClick={() => deleteProject(project.code)}
    className="text-red-600 hover:underline"
  >
    Excluir
  </button></>}
</div>
                    </td>
                  </tr>
                ))}
                {filteredProjects.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400">
                      Nenhum projeto encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            {filteredProjects.length} projeto(s) encontrado(s)
          </p>
        </section>
        )}
        {activeSection === "Projetos" && selectedProject && (
  <div>
    <div className="mb-6">
      <button
        onClick={() => setSelectedProjectCode(null)}
        className="mb-4 text-sm text-blue-600 hover:underline"
      >
        ← Voltar aos projetos
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {selectedProject.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {selectedProject.code} | {selectedProject.unit}
          </p>
        </div>

        {canAdminister && <button
          onClick={() => openEdit(selectedProject)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white"
        >
          Editar projeto
        </button>}
      </div>
    </div>

    <div className="mb-6 flex flex-wrap gap-2 border-b">
      {projectTabs.map((tab) => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          aria-pressed={activeTab === tab}
          className={`border-b-2 px-4 py-3 text-sm font-medium ${
            activeTab === tab
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>

    {activeTab === "Resumo" && (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          ["Gestor do projeto", selectedProject.owner],
          ["Gerente", selectedProject.manager],
          ["Departamento", selectedProject.department],
          ["Tipo", selectedProject.type],
          ["Categoria", selectedProject.category],
          ["Prioridade", selectedProject.priority],
          ["Data inicial", selectedProject.start],
          ["Data final planejada", selectedProject.finish],
          ["Status", selectedProject.status],
          ["Orçamento original aprovado", budgetLabel(selectedProject.code)],
          ["Avanço físico", `${selectedProject.progress}%`],
          ["Autorização para execução", selectedProject.executionAuthorization?.status === "pending" ? "Pendente · sem aprovação externa registrada" : "Não informada"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-2 font-semibold">{value || "-"}</p>
          </div>
        ))}
      </div>
    )}

    {activeTab === "Cronograma" && (
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-bold">Cronograma do projeto</h2>
        <p className="text-sm text-slate-500">
          Nesta etapa, vamos desenvolver a importação do cronograma do Microsoft Project,
          com atividades, atribuições, prazos, avanço e acompanhamento de atrasos.
        </p>
        <p className="mt-4 text-sm text-slate-400">
          Aguardando importação do cronograma.
        </p>
      </div>
    )}

    {activeTab === "Financeiro" && (
      <FinanceProjectPanel projectCode={selectedProject.code} canReview={canManage} />
    )}

    {activeTab === "Plano de Aquisições" && (
      <ProcurementPlan key={selectedProject.code} projectCode={selectedProject.code}
        canManage={canManage}
        budgetCents={financialState.status === "ready"
          ? financialState.data.budgets.find((budget) => budget.projectCode === selectedProject.code)?.updatedAmount ?? null
          : undefined}
        requisitions={financialState.status === "ready" ? financialState.data.requisitions : undefined}
        orders={financialState.status === "ready" ? financialState.data.orders : undefined} />
    )}

    {activeTab === "Documentação" && (
      <section className="rounded-xl border bg-white p-6 shadow-sm" aria-labelledby="project-documentation-heading">
        <h2 id="project-documentation-heading" className="mb-2 text-lg font-bold">Documentação</h2>
        <p className="text-sm text-slate-500">Nenhum documento cadastrado para este projeto.</p>
      </section>
    )}

    {activeTab === "ATAS" && (
      <section className="rounded-xl border bg-white p-6 shadow-sm" aria-labelledby="project-minutes-heading">
        <h2 id="project-minutes-heading" className="mb-2 text-lg font-bold">ATAS</h2>
        <p className="text-sm text-slate-500">Nenhuma ata cadastrada para este projeto.</p>
      </section>
    )}
  </div>
)}
{formOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
            <div className="my-auto w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">
                    {editingCode ? "Editar projeto" : "Novo projeto"}
                  </h2>
                  <p className="text-sm text-slate-500">
                    Informe os dados gerais do projeto
                  </p>
                </div>
                <button
                  disabled={saving}
                  onClick={closeProjectForm}
                  className="text-2xl text-slate-400 hover:text-slate-800"
                >
                  ×
                </button>
              </div>

              {message && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {message}
                </div>
              )}
              {saveError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
              {formLoading && <p role="status" className="mb-4 text-sm">Carregando cadastro e orçamento oficiais…</p>}
              <button type="button" disabled={saving || formLoading} onClick={() => void openProjectForm(editingCode)} className="mb-4 text-xs text-blue-700 underline">Recarregar formulário (descarta alterações não salvas)</button>

              <form onSubmit={saveProject}>
                <fieldset disabled={saving || formLoading || !formBaseline}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="text-sm font-medium">
                    Código Sankhya *
                    <input
                      required
                      disabled={!!editingCode}
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      className={inputClass}
                      placeholder="Ex.: CAP-2026-005"
                    />
                  </label>

                  <label className="text-sm font-medium">
                    Nome do projeto *
                    <input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className={inputClass}
                      placeholder="Nome do projeto"
                    />
                  </label>

                  <label className="text-sm font-medium">
                    Unidade industrial
                    <input
                      value={form.unit}
                      onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      className={inputClass}
                    />
                  </label>

                  <label className="text-sm font-medium">
                    Departamento
                    <input
                      value={form.department}
                      onChange={(e) => setForm({ ...form, department: e.target.value })}
                      className={inputClass}
                      placeholder="Ex.: Engenharia"
                    />
                  </label>

                  <label className="text-sm font-medium">
                    Tipo
                    <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputClass}>
                      <option>CAPEX</option>
                      <option>Manutenção</option>
                      <option>Melhoria</option>
                    </select>
                  </label>

                  <label className="text-sm font-medium">
                    Categoria
                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass}>
                      <option>Segurança</option>
                      <option>Confiabilidade</option>
                      <option>Expansão</option>
                      <option>Produtividade</option>
                      <option>Automação</option>
                      <option>Compliance legal</option>
                    </select>
                  </label>

                  <label className="text-sm font-medium">
                    Gestor do projeto
                    <input
                      value={form.owner}
                      onChange={(e) => setForm({ ...form, owner: e.target.value })}
                      className={inputClass}
                    />
                  </label>

                  <label className="text-sm font-medium">
                    Gerente
                    <input
                      value={form.manager}
                      onChange={(e) => setForm({ ...form, manager: e.target.value })}
                      className={inputClass}
                    />
                  </label>

                  <label className="text-sm font-medium">
                    Data inicial
                    <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className={inputClass} />
                  </label>

                  <label className="text-sm font-medium">
                    Data final planejada
                    <input type="date" value={form.finish} onChange={(e) => setForm({ ...form, finish: e.target.value })} className={inputClass} />
                  </label>

                  <ManualBudgetFields budget={formBudget} request={budgetRequest} onChange={setBudgetRequest} />

                  <label className="text-sm font-medium">
                    Prioridade
                    <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={inputClass}>
                      <option>Alta</option>
                      <option>Média</option>
                      <option>Baixa</option>
                    </select>
                  </label>

                  <label className="text-sm font-medium">
                    Status
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputClass}>
                      <option>Planejado</option>
                      <option>Em andamento</option>
                      <option>Atenção</option>
                      <option>Concluído</option>
                      <option>Cancelado</option>
                    </select>
                  </label>

                  <label className="text-sm font-medium">
                    Avanço físico (%)
                    <input type="number" min="0" max="100" value={form.progress} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} className={inputClass} />
                  </label>
                </div>

                <div className="mt-7 flex flex-wrap justify-end gap-3 border-t pt-5">
                  <button
                    type="button"
                    onClick={closeProjectForm}
                    className="rounded-lg border px-5 py-2.5 text-sm hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    {saving ? "Salvando…" : "Salvar projeto"}
                  </button>
                </div>
                </fieldset>

              </form>
            </div>
          </div>
        )}

        <footer className="mt-8 text-center text-xs text-slate-400">
          Industrial Project Management © 2026
        </footer>
      </main>
    </div>
  );
}
