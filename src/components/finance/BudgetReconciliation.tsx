"use client";

import { useRef, useState } from "react";
import { LocalStorageProjectRepository, type ProjectRepository } from "../../lib/projects/repository";
import { LocalStorageFinanceRepository } from "../../lib/finance/repository";
import { confirmBudgetReconciliation, loadBudgetReconciliation, planBudgetReconciliation, type BudgetDecision, type BudgetPlan, type BudgetPreview, type BudgetSituation } from "../../lib/finance/budget-reconciliation";

const projects = new LocalStorageProjectRepository();
const finance = new LocalStorageFinanceRepository();
const money = (cents: number | null) => cents === null ? "Não cadastrado" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const situations: Record<BudgetSituation, string> = { legacy_only: "Somente legado", financial_only: "Somente financeiro (legado ausente ou zero não confirmado)", equal: "Valores iguais", divergent: "Valores divergentes", no_budget: "Sem orçamento aprovado registrado", invalid_legacy: "Valor legado inválido para migração" };

export default function BudgetReconciliation({ projectRepository = projects, financeRepository = finance, onConfirmed }: {
  projectRepository?: ProjectRepository; financeRepository?: LocalStorageFinanceRepository; onConfirmed: () => void;
}) {
  const [preview, setPreview] = useState<BudgetPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, BudgetDecision | "">>({});
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  async function load() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice(""); setPlan(null); setChoices({}); setPreview(null);
    try { setPreview(await loadBudgetReconciliation(projectRepository, financeRepository)); }
    catch { setError("Não foi possível ler as duas fontes. Os dados foram preservados. Tente gerar a prévia novamente."); }
    finally { lock.current = false; setBusy(false); }
  }

  function prepare() {
    if (!preview) return;
    setError("");
    try {
      setPlan(planBudgetReconciliation(preview, Object.entries(choices).filter(([, value]) => !!value).map(([projectCode, decision]) => ({ projectCode, decision: decision as BudgetDecision })), new Date().toISOString()));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Decisões inválidas."); }
  }

  async function confirm() {
    if (!plan || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await confirmBudgetReconciliation(plan, projectRepository, financeRepository);
      setPreview(null); setPlan(null); setChoices({});
      setNotice("Reconciliação gravada. O orçamento financeiro é a fonte oficial; valores legados foram preservados.");
      onConfirmed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de gravação. Gere uma nova prévia para verificar o estado atual e tentar novamente.");
      setPlan(null);
    } finally { lock.current = false; setBusy(false); }
  }

  return <section className="space-y-5" aria-label="Reconciliação dos orçamentos">
    <header><h1 className="text-2xl font-bold">Reconciliação dos orçamentos</h1>
      <p className="mt-2 text-sm text-slate-600">Compare o cadastro legado com o orçamento original aprovado financeiro. Nenhuma alteração ocorre até a confirmação. O cadastro legado permanecerá intacto e somente leitura.</p>
      <p className="mt-2 text-sm text-amber-800">Zero no legado não comprova aprovação. Divergências exigem escolha individual. Usar o legado substitui o original financeiro; ajustes, custos e demais vínculos são preservados e o orçamento atualizado é recalculado.</p>
    </header>
    <button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40">{busy ? "Processando…" : "Gerar nova prévia"}</button>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-blue-50 p-4 text-blue-900">{notice}</p>}
    {preview && !plan && <>
      <div className="overflow-x-auto rounded-xl border bg-white" tabIndex={0} role="region" aria-label="Comparação dos orçamentos">
        <table className="w-full min-w-[850px] text-left text-sm">
          <caption className="p-4 text-left font-bold">Prévia · {preview.rows.length} projeto(s)</caption>
          <thead><tr>{["COD_INDORAMA / Projeto", "Legado", "Original oficial", "Situação", "Decisão individual"].map((label) => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.projectCode} className="border-t [&_td]:p-3">
            <td>{row.projectCode}<br />{row.name}</td>
            <td>{row.legacyCents === null && row.legacyValue !== null ? `Inválido: ${row.legacyValue}` : money(row.legacyCents)}</td>
            <td>{money(row.officialCents)}</td>
            <td>{situations[row.situation]}{row.resolved && <p className="text-green-700">Decisão já confirmada</p>}{!row.canMigrate && row.legacyValue !== null && <p className="text-amber-800">Migração indisponível: verifique código e valor, sem renomear o projeto.</p>}</td>
            <td>{row.canMigrate && !row.resolved && ["legacy_only", "divergent", "no_budget"].includes(row.situation) ?
              <select aria-label={`Decisão para ${row.projectCode}`} disabled={busy} className="max-w-72 rounded border p-2" value={choices[row.projectCode] ?? ""} onChange={(e) => setChoices({ ...choices, [row.projectCode]: e.target.value as BudgetDecision | "" })}>
                <option value="">Manter pendente · sem gravação</option>
                {row.situation === "divergent" && <option value="keep_financial">Manter o orçamento financeiro</option>}
                {row.situation !== "no_budget" && <option value="use_legacy">Confirmar o legado como original aprovado</option>}
                {row.situation === "no_budget" && row.legacyCents === 0 && <option value="approve_zero">Confirmar explicitamente orçamento aprovado de R$ 0,00</option>}
              </select> : "Nenhuma ação necessária ou disponível"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <button type="button" disabled={busy} onClick={prepare} className="rounded-lg border bg-white px-4 py-2">Revisar decisões selecionadas</button>
    </>}
    {plan && <div className="space-y-4 rounded-xl border bg-white p-5">
      <h2 className="text-lg font-bold">Confirmar alterações</h2>
      <ul className="space-y-2">{plan.changes.map((change) => <li key={change.projectCode}>{change.projectCode}: original financeiro {money(change.before)} → {money(change.after)}. Atualizado: {money(plan.next.budgets.find((b) => b.projectCode === change.projectCode)!.updatedAmount)}. {change.decision === "keep_financial" ? "Registrar decisão de manter o financeiro." : "Registrar aprovação explícita do valor legado."}</li>)}</ul>
      <p className="text-sm text-slate-600">Somente a chave financeira será gravada. Projetos e valores legados não serão regravados. Se as fontes mudarem, será necessário gerar outra prévia.</p>
      <div className="flex gap-3">
        <button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40">Confirmar gravação de {plan.changes.length} decisão(ões)</button>
        <button type="button" disabled={busy} onClick={() => setPlan(null)} className="rounded-lg border px-4 py-2">Voltar sem gravar</button>
      </div>
    </div>}
  </section>;
}
