import { COST_HEADERS, COST_SHEET, type CostWorkbook } from "./sankhya-import";

export const SANKHYA_EXPORT_SHEET = "new sheet";

export function isSankhyaExportFooter(sheet: import("exceljs").Worksheet, row: import("exceljs").Row, identityColumn: number) {
  return row.number === sheet.lastRow?.number && row.getCell(identityColumn).value === null &&
    row.values instanceof Array && row.values.some((value) => value && typeof value === "object" && "formula" in value);
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [match[1], match[2]]));
}

/** Strip unrelated sheets/defined names before ExcelJS parses the workbook model. */
async function isolateCostSheet(buffer: ArrayBuffer, sheetName: string): Promise<ArrayBuffer> {
  const { default: JSZip } = await import("jszip");
  const source = await JSZip.loadAsync(buffer);
  const read = async (path: string) => {
    const file = source.file(path);
    if (!file) throw new Error(`Parte obrigatória ausente no Excel: ${path}`);
    // JSZip records uncompressed sizes in its ZIP directory; check before allocating.
    const size = (file as typeof file & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (size === undefined || size > 40 * 1024 * 1024) throw new Error(`Parte Excel excede o limite de leitura: ${path}`);
    return file.async("string");
  };
  const xml = await read("xl/workbook.xml");
  const sheets = [...xml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((m) => attributes(m[0]));
  const sheet = sheets.find((s) => s.name === sheetName) ?? sheets.find((s) => s.name === SANKHYA_EXPORT_SHEET);
  if (!sheet) throw new Error(`Aba obrigatória não encontrada: ${sheetName}`);
  const rels = await read("xl/_rels/workbook.xml.rels");
  const relation = [...rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map((m) => attributes(m[0])).find((r) => r.Id === sheet["r:id"]);
  if (!relation || relation.TargetMode === "External") throw new Error("Referência de aba inválida");
  const path = relation.Target.startsWith("/") ? relation.Target.slice(1) : `xl/${relation.Target}`;
  if (path.includes("..") || !path.startsWith("xl/worksheets/")) throw new Error("Caminho de aba inválido");
  const date1904 = /\bdate1904\s*=\s*["'](?:1|true)["']/.test(xml);
  const zip = new JSZip();
  const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const safeName = sheet.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  zip.file("xl/workbook.xml", `<workbook xmlns="${namespace}" xmlns:r="${relationships}"><workbookPr date1904="${date1904 ? 1 : 0}"/><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  const worksheet = await read(path);
  const sheetData = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(worksheet);
  if (!sheetData) throw new Error("Aba sem dados de células");
  // Discard drawings, tables, validations and other unrelated worksheet resources.
  zip.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="${namespace}"><sheetData>${sheetData[1].replace(/\s+s=["']\d+["']/g, "")}</sheetData></worksheet>`);
  // No cell styles: retain numeric serials, including the invalid serial 60.
  if (source.file("xl/sharedStrings.xml")) zip.file("xl/sharedStrings.xml", await read("xl/sharedStrings.xml"));
  return Uint8Array.from(await zip.generateAsync({ type: "uint8array" })).buffer;
}

/** Load only the selected ERP worksheet, without unrelated names, styles or resources. */
export async function loadSankhyaSheet(buffer: ArrayBuffer, sheetName: string) {
  if (buffer.byteLength > 30 * 1024 * 1024) throw new Error("O arquivo excede o limite de 30 MB");
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  await workbook.xlsx.load(await isolateCostSheet(buffer, sheetName));
  const sheet = workbook.getWorksheet(sheetName) ?? workbook.getWorksheet(SANKHYA_EXPORT_SHEET);
  if (!sheet) throw new Error(`Aba obrigatória não encontrada: ${sheetName}`);
  if (sheet.rowCount > 100003) throw new Error("A aba excede o limite de 100 mil linhas");
  return { workbook, sheet };
}

/** ExcelJS processes the workbook locally; formulas are never evaluated. */
export async function readCostWorkbook(buffer: ArrayBuffer, sourceFile: string): Promise<CostWorkbook> {
  const { workbook, sheet } = await loadSankhyaSheet(buffer, COST_SHEET);
  const directExport = sheet.name === SANKHYA_EXPORT_SHEET;
  const headers = directExport ? COST_HEADERS.filter((name) => name !== "COD_INDORAMA") : COST_HEADERS;
  const columns = new Map<string, number>();
  const scalar = (value: import("exceljs").CellValue): unknown => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      // No cached formulas: stale/absent results must not become confirmed costs.
      if ("formula" in value || "sharedFormula" in value || "error" in value) throw new Error("Célula com fórmula ou erro; exporte os valores calculados antes de importar");
      if ("richText" in value) return value.richText.map((part) => part.text).join("");
      if ("text" in value) return value.text;
      throw new Error("Tipo de célula não suportado");
    }
    return value;
  };
  sheet.getRow(3).eachCell((cell, index) => {
    const name = String(scalar(cell.value) ?? "").trim();
    if (!name) return;
    if (columns.has(name)) throw new Error(`Cabeçalho duplicado: ${name}`);
    columns.set(name, index);
  });
  const missing = headers.filter((name) => !columns.has(name));
  if (missing.length) throw new Error(`Cabeçalho da linha 3 incompleto: ${missing.join(", ")}`);
  const rows: CostWorkbook["rows"] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return;
    if (directExport && isSankhyaExportFooter(sheet, row, columns.get("NUNOTA")!)) return;
    const values: Record<string, unknown> = {};
    for (const name of headers) {
      const cell = row.getCell(columns.get(name)!);
      try { values[name] = scalar(cell.value); }
      catch (error) { throw new Error(`Linha ${rowNumber}, ${name}: ${error instanceof Error ? error.message : "célula inválida"}`); }
    }
    if (Object.values(values).every((value) => value === null || value === undefined || value === "")) return;
    rows.push({ rowNumber, values });
  });
  return { sourceFile, sourceSheet: sheet.name, date1904: !!workbook.properties.date1904, rows, projectField: directExport ? "AD_PROJ_IHBL" : "COD_INDORAMA" };
}
