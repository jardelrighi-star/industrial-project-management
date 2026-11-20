"use client";

import { useEffect, useRef, useState } from "react";
import type { FinanceRepository } from "../../lib/finance/repository";
import { orderRequisitionCodes } from "../../lib/finance/calculations";
import { LocalStorageProjectRepository } from "../../lib/projects/repository";
import { readOrderWorkbook } from "../../lib/finance/order-workbook";
import { confirmOrderImport, previewOrderImport, type OrderPreview } from "../../lib/finance/order-import";

const projectsRepository = new LocalStorageProjectRepository();
const loadProjectCodes = async () => (await projectsRepository.load() ?? []).map((project) => project.code);
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const labels = { new: "Novo", updated: "Atualizar", duplicate: "Sem alteração", invalid: "Inconsistência", conflict: "Conflito" };

export default function SankhyaOrderImport({ projectCodes, repository, onImported }: { projectCodes: readonly string[]; repository: FinanceRepository; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(0);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const locked = useRef(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);

  async function select(file?: File) {
    if (!file || locked.current) return;
    locked.current = true;
    const id = ++request.current;
    setBusy("reading"); setPreview(null); setError(""); setNotice(""); setPage(0); setIssuesOnly(false);
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Selecione um arquivo Excel .xlsx.");
      if (file.size > 30 * 1024 * 1024) throw new Error("O arquivo excede o limite de 30 MB.");
      const workbook = await readOrderWorkbook(await file.arrayBuffer(), file.name);
      const next = previewOrderImport(workbook, projectCodes, await repository.load(), new Date().toISOString());
      if (id === request.current) setPreview(next);
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : "Não foi possível ler os pedidos.");
    } finally { locked.current = false; if (id === request.current) setBusy(null); }
  }

  async function confirm() {
    if (!preview || locked.current) return;
    locked.current = true; setBusy("saving"); setError(""); setNotice("");
    const id = request.current;
    try {
      const result = await confirmOrderImport(preview, projectCodes, repository, loadProjectCodes);
      if (id !== request.current) return;
      if (result.saved) {
        setNotice(`${result.preview.newCount} pedido(s) criado(s) e ${result.preview.updatedCount} atualizado(s). Os demais registros foram preservados.`);
        setPreview(null); onImported();
      } else {
        setPreview(result.preview); setPage(0);
        setNotice("Os dados mudaram desde a prévia. Revise os registros e confirme novamente.");
      }
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : "Não foi possível gravar os pedidos.");
    } finally { locked.current = false; if (id === request.current) setBusy(null); }
  }

  const rows = preview?.rows.filter((row) => !issuesOnly || row.status === "invalid" || row.status === "conflict") ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const formulaCount = preview?.workbook.rows.reduce((sum, row) => sum + row.cachedFormulaCount, 0) ?? 0;
  return <section className="rounded-xl border bg-white p-5 shadow-sm" aria-label="Importação de pedidos Sankhya">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">{open ? "Recolher importação de pedidos" : "Importar pedidos do Sankhya"}</button>
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">Selecione Pedidos_Pendentes.xlsx do Sankhya ou o Painel Capex com a aba PENTENDES DE ENTREGA. Cód. Projeto deve corresponder ao código cadastrado do projeto, com orçamento financeiro.</p>
      <p className="text-sm text-slate-600">Vlr Pend será o compromisso em aberto. Os itens serão somados por pedido e projeto. Valor total e faturado não são informados nesta exportação e não serão presumidos.</p>
      <p className="text-xs text-slate-500">SCs que já indicam este pedido não serão contadas novamente no comprometido. Pedidos ausentes na planilha são mantidos; a ausência não confirma faturamento ou cancelamento. Custos realizados e SCs não são alterados.</p>
      <label className="block text-sm font-medium">Arquivo de pedidos (.xlsx)
        <input type="file" accept=".xlsx" disabled={busy !== null} className="mt-2 block w-full rounded border p-2 text-sm" onChange={(event) => { void select(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      {busy === "reading" && <p role="status">Lendo pedidos e consolidando os itens…</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
      {preview && <>
        <h3 className="font-bold">Prévia de pedidos: {preview.workbook.sourceFile}</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-5">
          {[["Linhas lidas", preview.workbook.rows.length], ["Novos pedidos/projetos", preview.newCount], ["Atualizações", preview.updatedCount], ["Sem alteração", preview.duplicateCount], ["Grupos com problemas", preview.issueCount]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
        </dl>
        {formulaCount > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{formulaCount} célula(s) usam resultados de fórmulas salvos no Excel. Nenhuma fórmula foi executada. Confira projetos e valores; recalcule e salve o Excel se estiverem desatualizados.</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={issuesOnly} onChange={(event) => { setIssuesOnly(event.target.checked); setPage(0); }} />Mostrar somente inconsistências e conflitos</label>
        <div className="overflow-x-auto" role="region" aria-label="Prévia dos pedidos" tabIndex={0}>
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead><tr>{["Linhas / itens", "Projeto", "Pedido", "Fornecedor", "Objetivo", "Compromisso em aberto", "SC vinculada", "Situação"].map((label) => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
            <tbody>{rows.slice(page * 50, page * 50 + 50).map((row) => <tr key={row.rowNumbers[0]} className="border-t [&_td]:p-3 [&_td]:align-top">
              <td>{row.rowNumbers.join(", ")}<p className="mt-1 text-xs text-slate-500">{row.rowNumbers.length} item(ns)</p></td><td>{row.projectCode || "Ausente"}</td><td>{row.number || "Ausente"}{row.order?.sankhya?.internalOrderId && <div className="text-xs text-slate-500">Nº único {row.order.sankhya.internalOrderId}</div>}</td>
              <td>{row.order?.supplier || "Não informado"}</td><td className="max-w-sm whitespace-pre-wrap break-words">{row.order?.objective || "Não informado"}</td>
              <td className="whitespace-nowrap">{row.amount === null ? "Inválido" : money(row.amount)}{row.previous && <p className="mt-2 text-xs text-slate-500">Anterior: {money(row.previous.openBalance)}</p>}</td>
              <td>{(row.order && orderRequisitionCodes(row.order).join(", ")) || "Sem vínculo registrado"}</td><td><strong>{labels[row.status]}</strong><p className="mt-1 text-xs text-slate-500">{row.message}</p></td>
            </tr>)}{!rows.length && <tr><td colSpan={8} className="p-4 text-center">Nenhum registro neste filtro.</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" disabled={!page} onClick={() => setPage(page - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button>
          <span>Página {page + 1} de {pages} · {rows.length} grupos</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Próxima</button>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy !== null || preview.newCount + preview.updatedCount === 0} onClick={() => void confirm()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40">{busy === "saving" ? "Gravando…" : `Confirmar importação de ${preview.newCount + preview.updatedCount} pedido(s)`}</button>
          <button type="button" disabled={busy !== null} onClick={() => { request.current++; setPreview(null); setError(""); setNotice(""); }} className="rounded-lg border px-4 py-2 text-sm">Descartar prévia de pedidos</button>
        </div>
      </>}
    </div>}
  </section>;
}
