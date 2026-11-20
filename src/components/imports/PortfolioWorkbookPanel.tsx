"use client";

import { PORTFOLIO_FIELDS, type PortfolioField, type PortfolioMapping } from "../../lib/projects/portfolio-import";
import type { PortfolioWorkbook } from "../../lib/projects/portfolio-workbook";
import type { ReactNode } from "react";

/** File/mapping presentation is safe before selection, during reading, and after a failed read. */
export default function PortfolioWorkbookPanel({ workbook, busy, mapping, selectedFileName, onRetry, onFile, onMapping, onPrepare, mappingTools, mappingIssue }: {
  workbook?: PortfolioWorkbook | null; busy: boolean; mapping: PortfolioMapping;
  selectedFileName?: string; onRetry?: () => void;
  mappingTools?: ReactNode; mappingIssue?: string;
  onFile: (file: File | undefined) => void; onMapping: (mapping: PortfolioMapping) => void; onPrepare: () => void;
}) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  const ready = !busy && workbook != null && sheets.length > 0;
  const sheet = ready ? sheets.find((s) => s.name === mapping.sheet) : undefined;
  const header = sheet?.rows.find((r) => r.rowNumber === mapping.headerRow);

  return <>
    <label className="block text-sm font-medium">Arquivo da carteira (.xlsx)
      <input type="file" accept=".xlsx" disabled={busy} className="mt-2 block w-full rounded border p-2" onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
    {selectedFileName && <div className="text-sm"><p>Arquivo selecionado: <strong>{selectedFileName}</strong></p>{onRetry && <button type="button" disabled={busy} onClick={onRetry} className="mt-2 rounded-lg border px-3 py-2 disabled:opacity-40">Tentar ler este arquivo novamente</button>}</div>}
    {busy && <p role="status">Processando…</p>}
    {!busy && !ready && <p role="status" className="text-sm text-slate-500">{selectedFileName ? "O arquivo selecionado foi mantido. Tente ler novamente ou selecione outra cópia para visualizar as abas." : "Selecione um arquivo Excel para visualizar as abas e configurar o mapeamento."}</p>}
    {ready && <fieldset className="space-y-4">
      <legend className="font-bold">1. Confirmar layout e mapeamento · {workbook.sourceFile}</legend>
      {mappingTools}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Aba<select className="mt-1 block w-full rounded border p-2" value={mapping.sheet} onChange={(e) => onMapping({ sheet: e.target.value, headerRow: 1, columns: {} })}><option value="">Selecione a aba</option>{sheets.map((s) => <option key={s.name}>{s.name}</option>)}</select></label>
        <label className="text-sm">Linha do cabeçalho (0 = sem cabeçalho)<input type="number" min="0" max="20000" className="mt-1 block w-full rounded border p-2" value={mapping.headerRow} onChange={(e) => onMapping({ ...mapping, headerRow: Number(e.target.value), columns: {} })} /></label>
      </div>
      <p className="text-sm text-slate-500">Campos com * são obrigatórios. Colunas não mapeadas serão ignoradas. Campos opcionais ausentes ficam vazios; status inicial Planejado e avanço 0. Não mapeie percentuais em escala 0–1 como avanço 0–100.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(PORTFOLIO_FIELDS).map(([field, label]) => <label key={field} className="text-sm">{label}
        <select className="mt-1 block w-full rounded border p-2" value={mapping.columns[field as PortfolioField] ?? ""} onChange={(e) => {
          const columns = { ...mapping.columns };
          if (e.target.value) columns[field as PortfolioField] = Number(e.target.value); else delete columns[field as PortfolioField];
          onMapping({ ...mapping, columns });
        }}><option value="">Não mapeado</option>{sheet && Array.from({ length: sheet.columnCount }, (_, i) => i + 1).map((column) => <option key={column} value={column}>Coluna {column}: {header?.cells[column]?.value ?? "Sem título"}</option>)}</select>
      </label>)}</div>
      {sheet && <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Amostra da planilha"><table className="min-w-full text-left text-xs"><caption className="p-2 text-left">Amostra das primeiras 5 linhas após o cabeçalho (código numérico com máscara é exibido com os zeros)</caption><thead><tr><th className="p-2">Linha</th>{Array.from({ length: sheet.columnCount }, (_, i) => <th key={i} className="p-2">{i + 1}: {header?.cells[i + 1]?.value ?? ""}</th>)}</tr></thead><tbody>{sheet.rows.filter((r) => r.rowNumber > mapping.headerRow).slice(0, 5).map((r) => <tr key={r.rowNumber}><td className="p-2">{r.rowNumber}</td>{Array.from({ length: sheet.columnCount }, (_, i) => <td key={i} className="p-2">{r.cells[i + 1]?.issue ?? r.cells[i + 1]?.codeText ?? String(r.cells[i + 1]?.value ?? "")}</td>)}</tr>)}</tbody></table></div>}
      {mappingIssue && <p role="alert" className="text-sm text-amber-800">{mappingIssue}</p>}
      <button type="button" disabled={!!mappingIssue} onClick={onPrepare} className="rounded-lg border px-4 py-2 disabled:opacity-40">Confirmar mapeamento e gerar prévia</button>
    </fieldset>}
  </>;
}
