"use client";

import { useEffect, useRef, useState } from "react";
import type { FinanceRepository } from "../../lib/finance/repository";
import { LocalStorageProjectRepository } from "../../lib/projects/repository";
import { readRequisitionWorkbook } from "../../lib/finance/requisition-workbook";
import { confirmRequisitionImport, previewRequisitionImport, type RequisitionPreview } from "../../lib/finance/requisition-import";

const projectsRepository = new LocalStorageProjectRepository();
const loadProjectCodes = async () => (await projectsRepository.load() ?? []).map((project) => project.code);
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const labels = { new: "Nova", updated: "Atualizar", duplicate: "Sem alteração", invalid: "Inconsistência", conflict: "Conflito" };
const approvals = { approved: "Aprovada", pending: "Planejada", rejected: "Rejeitada" };

export default function SankhyaRequisitionImport({ projectCodes, repository, onImported }: { projectCodes: readonly string[]; repository: FinanceRepository; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [preview, setPreview] = useState<RequisitionPreview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(0);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const request = useRef(0);
  const locked = useRef(false);
  useEffect(() => () => { request.current++; }, []);

  async function select(file?: File) {
    if (!file || locked.current) return;
    locked.current = true;
    const id = ++request.current;
    setBusy("reading"); setPreview(null); setError(""); setNotice(""); setPage(0); setIssuesOnly(false);
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Selecione um arquivo Excel .xlsx.");
      if (file.size > 30 * 1024 * 1024) throw new Error("O arquivo excede o limite de 30 MB.");
      const workbook = await readRequisitionWorkbook(await file.arrayBuffer(), file.name);
      const next = previewRequisitionImport(workbook, projectCodes, await repository.load(), new Date().toISOString());
      if (id === request.current) setPreview(next);
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : "Não foi possível ler as SCs.");
    } finally { locked.current = false; if (id === request.current) setBusy(null); }
  }

  async function confirm() {
    if (!preview || locked.current) return;
    locked.current = true; setBusy("saving"); setError(""); setNotice("");
    const id = request.current;
    try {
      const result = await confirmRequisitionImport(preview, projectCodes, repository, loadProjectCodes);
      if (id !== request.current) return;
      if (result.saved) {
        setNotice(`${result.preview.newCount} SC(s) criada(s) e ${result.preview.updatedCount} atualizada(s). As demais linhas não foram alteradas.`);
        setPreview(null); onImported();
      } else {
        setPreview(result.preview); setPage(0);
        setNotice("Os dados mudaram desde a prévia. Revise os registros e confirme novamente.");
      }
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : "Não foi possível gravar as SCs.");
    } finally { locked.current = false; if (id === request.current) setBusy(null); }
  }

  const rows = preview?.rows.filter((row) => !issuesOnly || row.status === "invalid" || row.status === "conflict") ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const formulaCount = preview?.workbook.rows.reduce((sum, row) => sum + row.cachedFormulaCount, 0) ?? 0;
  return <section className="rounded-xl border bg-white p-5 shadow-sm" aria-label="Importação de SCs Sankhya">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">{open ? "Recolher importação de SCs" : "Importar SCs do Sankhya"}</button>
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">Selecione SC_s_Pendentes.xlsx do Sankhya ou o Painel Capex com a aba SC PENDENTE. O código de projeto deve corresponder ao cadastro. Na exportação do Sankhya, os itens de cada SC são somados pelo campo Vlr Pendente.</p>
      <p className="text-sm text-slate-600">Confirmada = Sim: aprovada e compromete orçamento se não estiver vinculada a pedido. Confirmada = Não: planejada, sem compromisso financeiro. O projeto precisa ter orçamento cadastrado.</p>
      <p className="text-xs text-slate-500">Novas SCs serão incluídas; alterações de SCs já importadas serão apresentadas para atualização. SCs ausentes neste arquivo serão mantidas. A importação não altera pedidos nem custos realizados.</p>
      <label className="block text-sm font-medium">Arquivo de SCs (.xlsx)
        <input type="file" accept=".xlsx" disabled={busy !== null} className="mt-2 block w-full rounded border p-2 text-sm" onChange={(event) => { void select(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      {busy === "reading" && <p role="status">Lendo SCs e preparando a prévia…</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
      {preview && <>
        <h3 className="font-bold">Prévia de SCs: {preview.workbook.sourceFile}</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-5">
          {[["Linhas lidas", preview.workbook.rows.length], ["Grupos na prévia", preview.rows.length], ["Novas", preview.newCount], ["Atualizações", preview.updatedCount], ["Sem alteração", preview.duplicateCount], ["Inconsistências / conflitos", preview.issueCount]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
        </dl>
        {formulaCount > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{formulaCount} célula(s) usam resultados de fórmulas salvos no Excel. Nenhuma fórmula foi executada. Confira os projetos e valores na prévia; se estiverem desatualizados, recalcule e salve o arquivo no Excel antes de importar.</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={issuesOnly} onChange={(event) => { setIssuesOnly(event.target.checked); setPage(0); }} />Mostrar somente inconsistências e conflitos</label>
        <div className="overflow-x-auto" role="region" aria-label="Prévia das SCs" tabIndex={0}>
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead><tr>{["Linha", "Projeto", "SC", "Objetivo", "Valor", "Aprovação", "Pedido vinculado", "Situação"].map((label) => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
            <tbody>{rows.slice(page * 50, page * 50 + 50).map((row) => <tr key={row.rowNumber} className="border-t [&_td]:p-3 [&_td]:align-top">
              <td>{row.rowNumbers.join(", ")}</td><td>{row.projectCode || "Ausente"}</td><td>{row.code || "Ausente"}</td>
              <td className="max-w-sm whitespace-pre-wrap break-words">{row.requisition?.objective || "Não informado"}{row.previous && <p className="mt-2 text-xs text-slate-500">Anterior: {row.previous.objective || "Não informado"}</p>}</td>
              <td className="whitespace-nowrap">{row.amount === null ? "Inválido" : money(row.amount)}{row.previous && <p className="mt-2 text-xs text-slate-500">Anterior: {money(row.previous.amount)}</p>}</td>
              <td>{row.requisition ? approvals[row.requisition.approvalStatus] : "—"}{row.previous && <p className="mt-2 text-xs text-slate-500">Anterior: {approvals[row.previous.approvalStatus]}</p>}</td>
              <td>{row.requisition?.convertedOrderNumber ?? "Sem pedido"}{row.previous && <p className="mt-2 text-xs text-slate-500">Anterior: {row.previous.convertedOrderNumber ?? "Sem pedido"}</p>}</td>
              <td><strong>{labels[row.status]}</strong><p className="mt-1 text-xs text-slate-500">{row.message}</p></td>
            </tr>)}{!rows.length && <tr><td colSpan={8} className="p-4 text-center">Nenhuma linha neste filtro.</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" disabled={!page} onClick={() => setPage(page - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button>
          <span>Página {page + 1} de {pages} · {rows.length} linhas</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Próxima</button>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy !== null || preview.newCount + preview.updatedCount === 0} onClick={() => void confirm()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40">{busy === "saving" ? "Gravando…" : `Confirmar importação de ${preview.newCount + preview.updatedCount} SC(s)`}</button>
          <button type="button" disabled={busy !== null} onClick={() => { request.current++; setPreview(null); setError(""); setNotice(""); }} className="rounded-lg border px-4 py-2 text-sm">Descartar prévia de SCs</button>
        </div>
      </>}
    </div>}
  </section>;
}
