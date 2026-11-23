"use client";

import { useEffect, useRef, useState } from "react";
import type { FinanceRepository } from "../../lib/finance/repository";
import { confirmCostImport, previewCostImport, type CostImportPreview } from "../../lib/finance/sankhya-import";
import { readCostWorkbook } from "../../lib/finance/sankhya-workbook";

const money = (value: number) => (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const labels = { ready: "V?lido", invalid: "Inconsist?ncia" };

export default function SankhyaCostImport({ projectCodes, repository, onImported }: { projectCodes: readonly string[]; repository: FinanceRepository; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reading" | "preview" | "saving">("idle");
  const [preview, setPreview] = useState<CostImportPreview | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const request = useRef(0);
  const saving = useRef(false);
  useEffect(() => () => { request.current++; }, []);

  async function selectFile(file: File | undefined) {
    if (!file) return;
    const id = ++request.current;
    setPreview(null); setError(""); setNotice(""); setPhase("reading"); setPage(0); setIssuesOnly(false);
    try {
      if (!/\.xlsx?$/i.test(file.name)) throw new Error("Selecione um arquivo Excel .xls ou .xlsx");
      if (file.size > 30 * 1024 * 1024) throw new Error("O arquivo excede o limite de 30 MB");
      const workbook = await readCostWorkbook(await file.arrayBuffer(), file.name);
      const data = await repository.load();
      const next = previewCostImport(workbook, projectCodes, data, new Date().toISOString());
      if (request.current === id) { setPreview(next); setPhase("preview"); }
    } catch (cause) {
      if (request.current === id) { setError(cause instanceof Error ? cause.message : "Não foi possível ler o arquivo"); setPhase("idle"); }
    }
  }
  async function confirm() {
    if (!preview || !preview.readyCount || saving.current) return;
    saving.current = true;
    setPhase("saving"); setError(""); setNotice("");
    try {
      const result = await confirmCostImport(preview, projectCodes, repository);
      if (result.saved) {
        setNotice(`${result.preview.readyCount} lançamento(s) importado(s), total ${money(result.preview.readyTotal)}. Os demais registros não foram importados.`);
        setPreview(null); setPhase("idle"); onImported();
      } else {
        setPreview(result.preview); setPhase("preview"); setPage(0);
        setNotice("Os dados mudaram desde a prévia. Revise a versão atualizada e confirme novamente os lançamentos válidos.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao gravar a importação"); setPhase("preview"); }
    finally { saving.current = false; }
  }
  const rows = preview?.rows.filter((r) => !issuesOnly || r.status === "invalid") ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  return (
    <section className="mb-6 rounded-xl border bg-white p-5 shadow-sm" aria-label="Importação de custos Sankhya">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">{open ? "Recolher importação" : "Importar custos realizados do Sankhya"}</button>
      {open && <div className="mt-4 space-y-4">
        <p className="text-sm text-slate-600">Na exportação direta, o vínculo exige um AD_PROJ_IHBL válido e cadastrado na carteira. O Painel Capex usa COD_INDORAMA.</p>
        <label className="block text-sm font-medium">Arquivo Excel (.xls ou .xlsx)
          <input type="file" accept=".xls,.xlsx" disabled={phase === "saving"} className="mt-2 block w-full rounded border p-2 text-sm" onChange={(event) => { void selectFile(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {phase === "reading" && <p role="status">Lendo arquivo e preparando a prévia…</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
        {preview && <>
          <h3 className="font-bold">Prévia: {preview.workbook.sourceFile}</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {[["Linhas lidas", preview.rows.length], ["Válidas para importar", preview.readyCount], ["Lançamentos anteriores", preview.previousCount], ["Inconsistências", preview.issueCount], ["Total dos valores legíveis", money(preview.readTotal)], ["Total a importar", money(preview.readyTotal)]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
          </dl>
          <p className="text-sm text-amber-800">Use uma exportação completa. A confirmação substitui todos os custos realizados anteriores da carteira pelas linhas válidas deste arquivo. Cada linha válida conta como um lançamento.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={issuesOnly} onChange={(e) => { setIssuesOnly(e.target.checked); setPage(0); }} />Mostrar somente inconsistências</label>
          <div className="overflow-x-auto" role="region" aria-label="Prévia dos custos" tabIndex={0}>
            <table className="w-full min-w-[1000px] text-left text-sm">
              <caption className="sr-only">Prévia dos lançamentos de custos e inconsistências</caption>
              <thead className="bg-slate-50"><tr>{["Linha", preview.workbook.projectField ?? "COD_INDORAMA", "Nota / NUNOTA", "Descrição", "Fornecedor", "Data", "Valor", "Situação"].map((h) => <th key={h} scope="col" className="p-3">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(page * 50, page * 50 + 50).map((r) => <tr key={r.rowNumber} className="border-b [&_td]:p-3 [&_td]:align-top">
                <td>{r.rowNumber}</td><td>{r.projectCode || "Ausente"}</td><td>{r.document || "Ausente"}<br /><span className="text-xs text-slate-500">{r.cost?.sankhya?.internalNoteId ?? "—"}</span></td>
                <td>{[r.cost?.description, r.cost?.assetDescription].filter(Boolean).join(" · ") || "—"}</td><td>{r.supplier || "—"}</td><td>{r.cost?.date.split("-").reverse().join("/") ?? "—"}</td><td className="whitespace-nowrap">{r.amount === null ? "Inválido" : money(r.amount)}</td>
                <td><strong>{labels[r.status]}</strong><p className="mt-1 text-xs text-slate-500">{r.message}</p></td>
              </tr>)}{!rows.length && <tr><td colSpan={8} className="p-4 text-center">Nenhuma linha neste filtro.</td></tr>}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="button" disabled={!page} onClick={() => setPage(page - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button>
            <span>Página {page + 1} de {pages} · {rows.length} linhas</span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Próxima</button>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={!preview.readyCount || phase === "saving"} onClick={() => void confirm()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{phase === "saving" ? "Gravando…" : `Substituir custos por ${preview.readyCount} lançamento(s) válido(s)`}</button>
            <button type="button" disabled={phase === "saving"} onClick={() => { request.current++; setPreview(null); setError(""); setNotice(""); setPhase("idle"); }} className="rounded-lg border px-4 py-2 text-sm">Descartar prévia</button>
          </div>
        </>}
      </div>}
    </section>
  );
}
