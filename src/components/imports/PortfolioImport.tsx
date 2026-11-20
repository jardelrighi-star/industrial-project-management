"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { assertPortfolioWorkbook, PortfolioWorkbookReadError, readPortfolioWorkbook, type PortfolioWorkbook } from "../../lib/projects/portfolio-workbook";
import { previewPortfolioImport, validatePortfolioMapping, type PortfolioMapping, type PortfolioPreview, type PortfolioReport, type PortfolioRow } from "../../lib/projects/portfolio-import";
import { PortfolioImportRepository } from "../../lib/projects/portfolio-repository";
import PortfolioWorkbookPanel from "./PortfolioWorkbookPanel";
import { initialPortfolioPanelState, portfolioPanelReducer, portfolioSelectionError } from "./portfolio-panel-state";
import { applyPortfolioMappingModel, createPortfolioMappingModel, guardPortfolioMapping, suggestPortfolioMapping, type PortfolioMappingModel } from "../../lib/projects/portfolio-mapping-models";
import { LocalStoragePortfolioModelRepository, type PortfolioModelRepository } from "../../lib/projects/portfolio-model-repository";
import PortfolioMappingTools from "./PortfolioMappingTools";

const repository = new PortfolioImportRepository();
const modelsRepository = new LocalStoragePortfolioModelRepository();
const emptyMapping: PortfolioMapping = { sheet: "", headerRow: 1, columns: {} };
const labels = { new: "Novo", existing: "Existente · ignorado", duplicate: "Duplicado · bloqueado", invalid: "Inválido" };
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Rows({ rows, page, report = false }: { rows: PortfolioRow[]; page: number; report?: boolean }) {
  return <div className="overflow-x-auto rounded-lg border" role="region" aria-label="Linhas da carteira" tabIndex={0}>
    <table className="w-full min-w-[800px] text-left text-sm">
      <thead><tr>{["Linha", "COD_INDORAMA", "Nome", "Orçamento aprovado", "Situação / motivo"].map((name) => <th scope="col" key={name} className="p-3">{name}</th>)}</tr></thead>
      <tbody>{rows.slice(page * 50, page * 50 + 50).map((row) => <tr key={row.rowNumber} className="border-t [&_td]:p-3 [&_td]:align-top">
        <td>{row.rowNumber}</td><td>{row.code || "Ausente"}</td><td>{row.name || "Ausente"}</td><td>{row.budget ? money(row.budget.originalApprovedAmount) : report ? "Não importado" : "Não será gravado"}</td><td><strong>{report && row.status === "new" ? "Importado" : labels[row.status]}</strong><p>{row.reason}</p></td>
      </tr>)}{!rows.length && <tr><td colSpan={5} className="p-4">Nenhuma linha.</td></tr>}</tbody>
    </table>
  </div>;
}

export default function PortfolioImport({ dataRepository = repository, modelRepository = modelsRepository, onImported = () => {} }: { dataRepository?: PortfolioImportRepository; modelRepository?: PortfolioModelRepository; onImported?: () => void }) {
  const [{ open, selectedFile, error, notice }, dispatchPanel] = useReducer(portfolioPanelReducer, initialPortfolioPanelState);
  const setError = (message: string) => dispatchPanel({ type: "error", message });
  const setNotice = (message: string) => dispatchPanel({ type: "notice", message });
  const [workbook, setWorkbook] = useState<PortfolioWorkbook | null>(null);
  const [mapping, setMapping] = useState<PortfolioMapping>(emptyMapping);
  const [models, setModels] = useState<PortfolioMappingModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelName, setModelName] = useState("");
  const [modelMessage, setModelMessage] = useState("");
  const [modelError, setModelError] = useState("");
  const [preview, setPreview] = useState<PortfolioPreview | null>(null);
  const [report, setReport] = useState<PortfolioReport | null>(null);
  const [pendingRecovery, setPendingRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [reportPage, setReportPage] = useState(0);
  const lock = useRef(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);

  function inspectRecovery() {
    try { setPendingRecovery(dataRepository.pendingRecovery()); }
    catch { setError("Não foi possível verificar a recuperação do armazenamento. Gere a prévia novamente após verificar o acesso aos dados."); }
  }

  async function select(file?: File) {
    if (!file || lock.current) return;
    const id = ++request.current;
    dispatchPanel({ type: "select", file });
    lock.current = true; setBusy(true); setPreview(null); setReport(null); setWorkbook(null); setMapping(emptyMapping);
    setModels([]); setSelectedModel(""); setModelName(""); setModelError(""); setModelMessage("");
    try {
      if (file.size > 30 * 1024 * 1024) throw new PortfolioWorkbookReadError("Arquivo acima de 30 MB.");
      const data = await readPortfolioWorkbook(await file.arrayBuffer(), file.name);
      assertPortfolioWorkbook(data);
      let saved: PortfolioMappingModel[] = [];
      let storageError = "";
      try { saved = await modelRepository.load(); }
      catch (cause) { storageError = cause instanceof Error ? cause.message : "Não foi possível ler os modelos salvos. Use o mapeamento manual."; }
      if (request.current === id) {
        const suggestion = suggestPortfolioMapping(data, saved);
        setWorkbook(data); setModels(saved); setMapping(suggestion.mapping ?? emptyMapping);
        setSelectedModel(suggestion.modelId); setModelMessage(suggestion.message); setModelError(storageError);
        inspectRecovery();
      }
    } catch (cause) { if (request.current === id) setError(portfolioSelectionError(cause)); }
    finally { lock.current = false; if (request.current === id) setBusy(false); }
  }

  async function prepare() {
    if (!workbook || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      setPreview(previewPortfolioImport(workbook, mapping, await dataRepository.load())); setPage(0); inspectRecovery();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar a prévia. Nenhum dado foi gravado."); }
    finally { lock.current = false; setBusy(false); }
  }

  async function confirm() {
    if (!preview || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await dataRepository.confirm(preview);
      if (!result.saved) {
        setPreview(result.preview); setPage(0);
        setNotice("Os dados mudaram. A prévia foi atualizada; revise e confirme novamente.");
      } else {
        setReport(result.report); setReportPage(0); setPreview(null); setWorkbook(null);
        setPendingRecovery(result.report.recoveryPending);
        setNotice("Lote confirmado. Projetos existentes foram ignorados; novos projetos têm autorização de execução pendente.");
        onImported();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha de gravação. Verifique a recuperação e gere outra prévia antes de tentar novamente."); inspectRecovery(); }
    finally { lock.current = false; setBusy(false); }
  }

  async function recover() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await dataRepository.recover(); setPendingRecovery(false); setNotice("Sincronização de compatibilidade concluída. Os projetos e orçamentos já estavam confirmados juntos."); onImported(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Recuperação pendente; novas gravações permanecem bloqueadas."); }
    finally { lock.current = false; setBusy(false); }
  }

  function useModel(id: string) {
    if (!workbook || lock.current) return;
    setPreview(null); setSelectedModel(id); setModelError(""); setModelMessage(""); setError("");
    if (!id) { setMapping(guardPortfolioMapping(workbook, mapping)); return; }
    const model = models.find((model) => model.id === id);
    try {
      if (!model) throw new Error("Modelo não encontrado. Selecione novamente o arquivo para atualizar a lista.");
      // Explicitly chosen sheet/header resolves ambiguity; otherwise search for a unique compatible location.
      let resolved: PortfolioMapping;
      try { resolved = applyPortfolioMappingModel(workbook, model); }
      catch { resolved = applyPortfolioMappingModel(workbook, model, mapping.sheet ? mapping : undefined); }
      setMapping(resolved); setModelMessage(`Modelo “${model.name}” aplicado. Revise as colunas antes de gerar a prévia.`);
    } catch (cause) {
      setMapping(emptyMapping);
      setModelError(cause instanceof Error ? cause.message : "Modelo incompatível com este arquivo.");
    }
  }

  function detectMapping() {
    if (!workbook || lock.current) return;
    const suggestion = suggestPortfolioMapping(workbook, models);
    setMapping(suggestion.mapping ?? emptyMapping); setSelectedModel(suggestion.modelId);
    setModelMessage(suggestion.message); setModelError(""); setPreview(null); setError("");
  }

  async function saveModel() {
    if (!workbook || lock.current) return;
    lock.current = true; setBusy(true); setModelError("");
    try {
      const model = createPortfolioMappingModel(workbook, mapping, modelName, crypto.randomUUID());
      await modelRepository.add(model);
      setModels((current) => [...current, model]); setSelectedModel(model.id); setModelName("");
      setMapping(applyPortfolioMappingModel(workbook, model, mapping)); setPreview(null);
      setModelMessage(`Modelo “${model.name}” salvo para reutilização. Nenhum projeto foi importado.`);
    } catch (cause) { setModelError(cause instanceof Error ? cause.message : "Não foi possível salvar o modelo."); }
    finally { lock.current = false; setBusy(false); }
  }

  const reportRows = report ? [...report.imported, ...report.notImported] : [];
  const rows = preview?.rows ?? reportRows;
  const currentPage = preview ? page : reportPage;
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const readyTotal = preview?.rows.filter((row) => row.status === "new").reduce((sum, row) => sum + row.budget!.originalApprovedAmount, 0) ?? 0;
  const changeMapping = (next: PortfolioMapping) => {
    setMapping(workbook ? guardPortfolioMapping(workbook, next) : next); setPreview(null); setError(""); setNotice("");
    setSelectedModel(""); setModelError(""); setModelMessage("Mapeamento ajustado manualmente. Salve com um novo nome para reutilizar essas escolhas.");
  };
  let mappingIssue = "";
  if (workbook) {
    try { validatePortfolioMapping(workbook, mapping); }
    catch (cause) { mappingIssue = cause instanceof Error ? cause.message : "Mapeamento incompleto."; }
  }
  const canSaveModel = !!workbook && !mappingIssue && !!guardPortfolioMapping(workbook, mapping).expectedHeaders;

  return <section className="rounded-xl border bg-white p-5 shadow-sm" aria-label="Importação da carteira de projetos">
    <button type="button" disabled={busy} aria-expanded={open} onClick={() => { dispatchPanel({ type: "toggle" }); setModelError(""); if (!open) inspectRecovery(); }} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40">{open ? "Recolher importação da carteira" : "Importar Carteira de Projetos"}</button>
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">Somente novos projetos. Nenhum cadastro, orçamento ou vínculo existente será atualizado. COD_INDORAMA deve ser texto; números exigem máscara explícita de zeros. O orçamento aprovado será registrado no financeiro, sem autorizar a execução. Valores monetários são em reais, convertidos para centavos com arredondamento de meio centavo para longe de zero.</p>
      {pendingRecovery && <div role="status" className="rounded-lg bg-amber-50 p-4 text-amber-900"><p>Um lote já está confirmado no registro transacional. Os dois repositórios fornecem o lote completo; falta sincronizar as chaves de compatibilidade. Novas gravações exigem concluir esta etapa.</p><button type="button" disabled={busy} onClick={() => void recover()} className="mt-2 rounded border px-3 py-2">Concluir sincronização pendente</button></div>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-blue-900">{notice}</p>}
      <PortfolioWorkbookPanel workbook={workbook} busy={busy} mapping={mapping} mappingIssue={mappingIssue} mappingTools={<PortfolioMappingTools models={models} selectedId={selectedModel} name={modelName} message={modelMessage} error={modelError} canSave={canSaveModel} onSelect={useModel} onName={setModelName} onSave={() => void saveModel()} onDetect={detectMapping} />} selectedFileName={selectedFile?.name} onRetry={selectedFile && !workbook && !report ? () => void select(selectedFile) : undefined} onFile={(file) => void select(file)} onMapping={changeMapping} onPrepare={() => void prepare()} />
      {preview && <>
        <h3 className="font-bold">2. Revisar prévia</h3>
        <p className="text-sm">{Object.entries(labels).map(([status, label]) => `${label}: ${preview.rows.filter((row) => row.status === status).length}`).join(" · ")}</p>
        <p className="text-sm">Total original aprovado a importar: {Number.isSafeInteger(readyTotal) ? money(readyTotal) : "Total acima do limite de exibição; revise os valores individuais."}</p>
        <Rows rows={rows} page={page} />
        <button type="button" disabled={busy || !preview.rows.some((row) => row.status === "new")} onClick={() => void confirm()} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40">Confirmar importação de {preview.rows.filter((row) => row.status === "new").length} projeto(s) novo(s)</button>
      </>}
      {report && <><h3 className="font-bold">Relatório da importação</h3><p>{report.imported.length} importado(s) · {report.notImported.length} não importado(s). A tabela inclui todos os códigos, nomes e motivos.</p><Rows rows={reportRows} page={reportPage} report /></>}
      {(preview || report) && <div className="flex items-center gap-3 text-sm"><button type="button" disabled={busy || !currentPage} onClick={() => preview ? setPage(page - 1) : setReportPage(reportPage - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button><span>Página {currentPage + 1} de {pages} · {rows.length} linhas</span><button type="button" disabled={busy || currentPage + 1 >= pages} onClick={() => preview ? setPage(page + 1) : setReportPage(reportPage + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Próxima</button></div>}
    </div>}
  </section>;
}
