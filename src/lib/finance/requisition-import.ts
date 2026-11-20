import type { FinanceData, PurchaseRequisition } from "./types";
import type { FinanceRepository } from "./repository";
import { normalizeFinanceData } from "./calculations";
import { parseBrlCents } from "./import-values";
import { SC_SHEET, type RequisitionWorkbook } from "./requisition-workbook";
import { SANKHYA_EXPORT_SHEET } from "./sankhya-workbook";

export type RequisitionImportRow = {
  rowNumber: number; rowNumbers: number[]; code: string; projectCode: string; amount: number | null;
  status: "new" | "updated" | "duplicate" | "invalid" | "conflict";
  message: string; requisition?: PurchaseRequisition; previous?: PurchaseRequisition;
};
export type RequisitionPreview = {
  workbook: RequisitionWorkbook; baseline: string; rows: RequisitionImportRow[];
  newCount: number; updatedCount: number; duplicateCount: number; issueCount: number;
};
const text = (value: unknown) => value === null || value === undefined ? "" : String(value).trim();
const key = (projectCode: string, code: string) => JSON.stringify([projectCode, code]);
const content = (r: PurchaseRequisition) => JSON.stringify([r.projectCode, r.code, r.objective, r.amount, r.approvalStatus, r.convertedOrderNumber]);
function identifier(value: unknown) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new Error("Identificador numérico inválido.");
  return text(value);
}

const confirmation = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Confirmada=Sim is approved; Não is planned and does not commit budget. */
export function previewRequisitionImport(workbook: RequisitionWorkbook, projectCodes: readonly string[], input: FinanceData, recordedAt: string): RequisitionPreview {
  const data = normalizeFinanceData(input);
  const projects = new Set(projectCodes);
  const budgets = new Set(data.budgets.map((budget) => budget.projectCode));
  const existingByKey = new Map(data.requisitions.map((r) => [key(r.projectCode, r.code), r]));
  const existingBySource = new Map(data.requisitions.map((r) => [JSON.stringify([r.traceability.sourceSystem, r.traceability.sourceRecordId]), r]));
  const directExport = workbook.sourceSheet === SANKHYA_EXPORT_SHEET;
  const projectField = directExport ? "Cód. Projeto" : "Nrº Projeto";
  const codeField = directExport ? "Nr.Unico" : "SC";
  const amountField = directExport ? "Vlr Pendente" : "Vlr. Nota";
  const groups = new Map<string, RequisitionWorkbook["rows"]>();
  for (const source of workbook.rows) {
    const project = text(source.values[projectField]);
    const code = text(source.values[codeField]);
    const id = directExport && project && code ? key(project, code) : String(source.rowNumber);
    const group = groups.get(id) ?? [];
    group.push(source);
    groups.set(id, group);
  }
  const rows: RequisitionImportRow[] = [...groups.values()].map((group) => {
    const source = group[0];
    const v = source.values;
    const row: RequisitionImportRow = { rowNumber: source.rowNumber, rowNumbers: group.map((item) => item.rowNumber), code: text(v[codeField]), projectCode: text(v[projectField]), amount: null, status: "invalid", message: "" };
    try {
      row.code = identifier(v[codeField]); row.projectCode = identifier(v[projectField]);
      if (!row.code || /^0+$/.test(row.code)) throw new Error("Número da SC ausente ou inválido.");
      if (!row.projectCode || /^0+$/.test(row.projectCode) || !projects.has(row.projectCode)) throw new Error(`Projeto não cadastrado para o código informado em ${projectField}.`);
      if (row.projectCode !== row.projectCode.toUpperCase()) throw new Error("Código do projeto não canônico.");
      if (!budgets.has(row.projectCode)) throw new Error("Cadastre o orçamento do projeto antes de importar suas SCs.");
      const confirmed = confirmation(v.Confirmada);
      if (!["sim", "nao"].includes(confirmed)) throw new Error("Confirmada deve ser Sim ou Não; aprovação não será presumida.");
      let total = 0;
      const objectives = new Set<string>();
      for (const item of group) {
        if (item.issue) throw new Error(`Linha ${item.rowNumber}: ${item.issue}`);
        identifier(item.values[projectField]);
        identifier(item.values[codeField]);
        if (confirmation(item.values.Confirmada) !== confirmed) throw new Error("Itens da SC com confirmações divergentes.");
        const amount = parseBrlCents(item.values[amountField]);
        if (amount < 0) throw new Error("O valor da SC não pode ser negativo.");
        total += amount;
        if (!Number.isSafeInteger(total)) throw new Error("Saldo da SC fora do limite suportado.");
        const objective = text(item.values["Observação"]);
        if (objective) objectives.add(objective);
      }
      row.amount = total;
      const previous = existingByKey.get(key(row.projectCode, row.code));
      const order = directExport ? previous?.convertedOrderNumber ?? "" : identifier(v["Nro. Pedido"]);
      const sourceRecordId = JSON.stringify(["sankhya-sc-v1", row.projectCode, row.code]);
      const requisition: PurchaseRequisition = {
        code: row.code, projectCode: row.projectCode, objective: [...objectives].sort().join("\n\n"), amount: row.amount,
        approvalStatus: confirmed === "sim" ? "approved" : "pending",
        convertedOrderNumber: !order || /^0+$/.test(order) ? null : order,
        sankhya: { confirmed: confirmed === "sim", sourceFile: workbook.sourceFile, sourceSheet: workbook.sourceSheet ?? SC_SHEET, sourceRow: source.rowNumber },
        traceability: { sourceSystem: "Sankhya", sourceRecordId, recordedAt, externalReference: row.code },
      };
      row.requisition = requisition;
      const sameSource = existingBySource.get(JSON.stringify(["Sankhya", sourceRecordId]));
      if (sameSource && sameSource !== previous) throw new Error("Identidade da origem vinculada a outra SC; reconciliação necessária.");
      if (previous && content(previous) === content(requisition)) {
        row.status = "duplicate"; row.message = "Já importada, sem alteração.";
      } else if (previous) {
        row.previous = previous;
        if (previous.traceability.sourceSystem !== "Sankhya" || previous.traceability.sourceRecordId !== sourceRecordId) {
          row.status = "conflict"; row.message = "SC de outra origem com conteúdo diferente; não será sobrescrita.";
        } else {
          row.status = "updated"; row.message = "Atualizar valor, objetivo, confirmação ou pedido conforme a prévia.";
        }
      } else { row.status = "new"; row.message = "Nova SC."; }
    } catch (cause) { row.message = cause instanceof Error ? cause.message : "SC inválida."; }
    return row;
  });
  const duplicates = new Map<string, RequisitionImportRow[]>();
  for (const row of rows) if (!directExport && row.code && row.projectCode) {
    const id = key(row.projectCode, row.code);
    const group = duplicates.get(id) ?? []; group.push(row); duplicates.set(id, group);
  }
  for (const group of duplicates.values()) if (group.length > 1) for (const row of group) {
    row.status = "conflict"; row.message = "SC repetida para o mesmo projeto no arquivo; nenhuma dessas linhas será importada.";
  }
  return { workbook, baseline: JSON.stringify(data), rows,
    newCount: rows.filter((r) => r.status === "new").length,
    updatedCount: rows.filter((r) => r.status === "updated").length,
    duplicateCount: rows.filter((r) => r.status === "duplicate").length,
    issueCount: rows.filter((r) => r.status === "invalid" || r.status === "conflict").length,
  };
}

/** Explicit preview confirmation; replaces only selected SCs, preserving other collections. */
export async function confirmRequisitionImport(preview: RequisitionPreview, projectCodes: readonly string[], repository: FinanceRepository, loadProjectCodes?: () => Promise<readonly string[]>): Promise<{ saved: boolean; preview: RequisitionPreview }> {
  const currentCodes = loadProjectCodes ? await loadProjectCodes() : projectCodes;
  const existing = await repository.load();
  const refreshed = previewRequisitionImport(preview.workbook, currentCodes, existing, new Date().toISOString());
  const decisions = (p: RequisitionPreview) => JSON.stringify(p.rows.map((r) => [r.rowNumber, r.status, r.requisition ? content(r.requisition) : null]));
  if (refreshed.baseline !== preview.baseline || decisions(refreshed) !== decisions(preview)) return { saved: false, preview: refreshed };
  const changes = refreshed.rows.filter((r) => r.status === "new" || r.status === "updated").map((r) => r.requisition!);
  if (!changes.length) return { saved: false, preview: refreshed };
  const replacements = new Map(changes.map((r) => [key(r.projectCode, r.code), r]));
  const next = normalizeFinanceData({ ...existing, requisitions: [
    ...existing.requisitions.map((r) => replacements.get(key(r.projectCode, r.code)) ?? r),
    ...changes.filter((r) => !existing.requisitions.some((old) => key(old.projectCode, old.code) === key(r.projectCode, r.code))),
  ] });
  if (repository.saveIfCurrent) await repository.saveIfCurrent(next, existing, loadProjectCodes ? async () => {
    const latest = new Set(await loadProjectCodes());
    if (changes.some((r) => !latest.has(r.projectCode))) throw new Error("O cadastro de projetos mudou. Gere uma nova prévia.");
  } : undefined);
  else await repository.save(next);
  return { saved: true, preview: refreshed };
}
