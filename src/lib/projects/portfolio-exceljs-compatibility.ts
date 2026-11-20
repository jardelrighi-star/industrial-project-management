import type { PreparedPortfolioWorkbook } from "./portfolio-xml-normalization";
import { PortfolioWorkbookReadError } from "./portfolio-workbook-errors";

type ReconciliationModel = { tables?: Record<string, unknown> };
type Reconcile = (model: ReconciliationModel, options: unknown) => void;

/** ExcelJS 4.4.0 uses literal table Target keys. Resolve equivalent validated paths without editing relationships. */
export async function loadPortfolioExcelWorkbook(prepared: PreparedPortfolioWorkbook) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  if (!Object.keys(prepared.tableAliases).length) {
    await workbook.xlsx.load(prepared.buffer);
    return workbook;
  }
  const xlsx = workbook.xlsx as typeof workbook.xlsx & { reconcile?: Reconcile };
  const original = xlsx.reconcile;
  if (typeof original !== "function") throw new PortfolioWorkbookReadError("Esta versão do ExcelJS não oferece o adaptador de relacionamentos necessário. Nenhum conteúdo foi alterado.");
  // Scope the adapter to this reader instance; never patch a prototype or the installed library.
  xlsx.reconcile = function (model, options) {
    const tables = model.tables;
    if (!tables || typeof tables !== "object") throw new PortfolioWorkbookReadError("O ExcelJS não retornou uma coleção de tabelas compatível.");
    model.tables = new Proxy(tables, {
      get(target, property, receiver) {
        const alias = typeof property === "string" && Object.hasOwn(prepared.tableAliases, property) ? prepared.tableAliases[property] : property;
        return Reflect.get(target, alias, receiver);
      },
    });
    try { original.call(this, model, options); }
    finally { model.tables = tables; }
  };
  try { await xlsx.load(prepared.buffer); }
  finally { xlsx.reconcile = original; }
  return workbook;
}
