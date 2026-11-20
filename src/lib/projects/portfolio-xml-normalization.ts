import { SaxesParser, type SaxesTagNS } from "saxes";
import { PortfolioWorkbookReadError } from "./portfolio-workbook-errors";

export const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOCUMENT_RELS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
type Edit = { start: number; end: number; text: string };
type XmlInfo = { root: { local: string; uri: string }; tags: { local: string; uri: string; attributes: Record<string, string> }[] };

function fail(message: string, cause?: unknown): never {
  throw new PortfolioWorkbookReadError(message, { cause });
}

function attributes(tag: SaxesTagNS): Record<string, string> {
  return Object.fromEntries(Object.values(tag.attributes).filter((attribute) => attribute.uri !== XMLNS_NS).map((attribute) => [`{${attribute.uri}}${attribute.local}`, attribute.value]));
}

/** SAX positions identify real element names, never text, CDATA, comments or attribute values. */
export function normalizePortfolioXml(xml: string, targetNamespace?: string): { xml: string; info: XmlInfo } {
  const parser = new SaxesParser({ xmlns: true });
  const edits: Edit[] = [];
  const stack: { originalDefault: string; outputDefault: string }[] = [];
  const tags: XmlInfo["tags"] = [];
  let root: XmlInfo["root"] | undefined;
  let nameStart = -1;
  let encoding = "utf-8";
  parser.on("xmldecl", (declaration) => { encoding = declaration.encoding?.toLowerCase() ?? "utf-8"; });
  parser.on("doctype", () => fail("O Excel contém DTD XML, uma estrutura não suportada para leitura segura."));
  parser.on("opentagstart", (tag) => {
    nameStart = xml.lastIndexOf("<", parser.position - 1) + 1;
    if (nameStart < 1 || xml.slice(nameStart, nameStart + tag.name.length) !== tag.name) fail("Não foi possível localizar com segurança um elemento XML do Excel.");
  });
  parser.on("opentag", (tag) => {
    root ??= { local: tag.local, uri: tag.uri };
    // Keep only metadata needed for package validation, not a second in-memory workbook tree.
    if (tag.local === "Relationship" || tag.local === "sheet" || tag.local === "Override") tags.push({ local: tag.local, uri: tag.uri, attributes: attributes(tag) });
    const normalize = tag.uri === targetNamespace && tag.prefix !== "";
    const ownDefault = tag.attributes.xmlns;
    const originalDefault = ownDefault?.value ?? stack[stack.length - 1]?.originalDefault ?? "";
    const inheritedOutputDefault = stack[stack.length - 1]?.outputDefault ?? "";
    let outputDefault = ownDefault ? ownDefault.value : inheritedOutputDefault;
    // Unchanged foreign elements retain their original default namespace scope too.
    const requiredDefault = normalize || (!tag.prefix && tag.uri === targetNamespace) ? tag.uri : originalDefault;
    if (targetNamespace && outputDefault !== requiredDefault) {
      if (ownDefault) fail("O Excel possui declarações de namespace conflitantes. Salve uma nova cópia .xlsx para preservar seus atributos.");
      const hasQNameAttribute = Object.values(tag.attributes).some((attribute) => attribute.uri === "http://www.w3.org/2001/XMLSchema-instance" && attribute.local === "type" && !attribute.value.includes(":"));
      if (hasQNameAttribute) fail("O Excel contém tipos XML cujo namespace não pode ser normalizado com segurança.");
      // Namespace URIs originated in parsed declarations. Do not insert XML metacharacters unescaped.
      const escaped = requiredDefault.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
      edits.push({ start: nameStart + tag.name.length, end: nameStart + tag.name.length, text: ` xmlns="${escaped}"` });
      outputDefault = requiredDefault;
    }
    if (normalize) edits.push({ start: nameStart, end: nameStart + tag.name.length, text: tag.local });
    stack.push({ originalDefault, outputDefault });
  });
  parser.on("closetag", (tag) => {
    stack.pop();
    if (tag.isSelfClosing || tag.uri !== targetNamespace || !tag.prefix) return;
    const start = xml.lastIndexOf("</", parser.position - 1) + 2;
    if (start < 2 || xml.slice(start, start + tag.name.length) !== tag.name) fail("Não foi possível localizar com segurança o fechamento XML do Excel.");
    edits.push({ start, end: start + tag.name.length, text: tag.local });
  });
  try { parser.write(xml).close(); }
  catch (cause) {
    if (cause instanceof PortfolioWorkbookReadError) throw cause;
    fail("O arquivo contém XML inválido. Abra-o no Excel e salve uma nova cópia .xlsx.", cause);
  }
  if (!root) fail("Uma parte XML do Excel está vazia.");
  if (!edits.length) return { xml, info: { root, tags } };
  if (!["utf-8", "utf8", "us-ascii", "ascii"].includes(encoding)) fail("A codificação XML não pode ser normalizada com segurança. Salve uma cópia .xlsx UTF-8.");
  const chunks: string[] = [];
  let cursor = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (edit.start < cursor) fail("A normalização XML não pôde preservar a estrutura do arquivo.");
    chunks.push(xml.slice(cursor, edit.start), edit.text); cursor = edit.end;
  }
  chunks.push(xml.slice(cursor));
  const result = chunks.join("");
  assertEquivalentXml(xml, result);
  return { xml: result, info: { root, tags } };
}

/** Compare expanded element/attribute names, attribute values and every content event after editing. */
function assertEquivalentXml(before: string, after: string): void {
  const events: string[] = [];
  function parse(xml: string, compare: boolean) {
    const parser = new SaxesParser({ xmlns: true });
    let index = 0;
    const emit = (value: unknown) => {
      const event = JSON.stringify(value);
      if (compare) { if (events[index++] !== event) fail("A normalização alteraria o conteúdo do Excel; operação cancelada."); }
      else events.push(event);
    };
    parser.on("opentag", (tag) => emit(["open", tag.uri, tag.local, Object.entries(attributes(tag)).sort(([a], [b]) => a.localeCompare(b))]));
    parser.on("closetag", (tag) => emit(["close", tag.uri, tag.local]));
    for (const event of ["text", "cdata", "comment"] as const) parser.on(event, (value) => emit([event, value]));
    parser.on("processinginstruction", (value) => emit(["pi", value]));
    parser.on("xmldecl", (value) => emit(["declaration", value]));
    parser.write(xml).close();
    if (compare && index !== events.length) fail("A normalização alteraria a estrutura do Excel; operação cancelada.");
  }
  parse(before, false); parse(after, true);
}

function resolveTarget(relsPath: string, target: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(target.split("#")[0]); }
  catch (cause) { fail("O Excel contém um caminho de relacionamento inválido.", cause); }
  if (!decoded || decoded.includes("\\") || decoded.includes(":")) fail("O Excel contém um caminho de relacionamento não suportado.");
  const source = relsPath === "_rels/.rels" ? "" : relsPath.replace("/_rels/", "/").slice(0, -5);
  const parts = decoded.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) fail("Um relacionamento aponta para fora do arquivo Excel."); parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}

function zipEntryCount(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65557); offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50 || offset + 22 + view.getUint16(offset + 20, true) !== buffer.byteLength) continue;
    const count = view.getUint16(offset + 10, true);
    if (view.getUint16(offset + 4, true) || view.getUint16(offset + 6, true) || view.getUint16(offset + 8, true) !== count || count === 0xffff) fail("O ZIP do Excel usa volumes múltiplos ou ZIP64 não suportado por esta leitura limitada.");
    if (view.getUint32(offset + 16, true) + view.getUint32(offset + 12, true) > offset) fail("O diretório ZIP do Excel está corrompido.");
    return count;
  }
  fail("O arquivo não possui um diretório ZIP válido de Excel.");
}

/** Validate the package first; return the original ArrayBuffer unchanged for already-compatible workbooks. */
export type PreparedPortfolioWorkbook = { buffer: ArrayBuffer; normalizedParts: string[]; tableAliases: Record<string, string> };
export async function normalizePortfolioWorkbookZip(buffer: ArrayBuffer): Promise<PreparedPortfolioWorkbook> {
  const { default: JSZip } = await import("jszip");
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try { zip = await JSZip.loadAsync(buffer); }
  catch (cause) { fail("O arquivo não é um Excel .xlsx válido ou está corrompido.", cause); }
  if (Object.keys(zip.files).length !== zipEntryCount(buffer)) fail("O ZIP do Excel contém nomes de partes duplicados ou um diretório inconsistente.");
  const files = Object.values(zip.files).filter((file) => !file.dir);
  if (files.length > 2000) fail("Arquivo Excel possui partes em excesso.");
  let size = 0;
  for (const file of files) {
    const item = file as typeof file & { unsafeOriginalName?: string; _data?: { uncompressedSize?: number } };
    if (file.name.startsWith("/") || file.name.includes("\\") || file.name.split("/").includes("..") || (item.unsafeOriginalName !== undefined && item.unsafeOriginalName !== file.name)) fail("O ZIP do Excel contém um caminho de parte inválido.");
    if (item._data?.uncompressedSize === undefined) fail("Não foi possível verificar o tamanho do Excel.");
    size += item._data.uncompressedSize;
    if (size > 60 * 1024 * 1024) fail("Conteúdo descompactado acima de 60 MB.");
  }
  // Check checksums only after imposing decompression limits.
  try { await JSZip.loadAsync(buffer, { checkCRC32: true }); }
  catch (cause) { fail("O ZIP do Excel está corrompido: falha na verificação de integridade.", cause); }
  for (const name of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"]) if (!zip.file(name)) fail(`Estrutura Excel incompleta: parte obrigatória ${name} ausente.`);
  const metadata = new Map<string, XmlInfo>();
  const changed = new Map<string, string>();
  for (const file of files) {
    if (!file.name.endsWith(".xml") && !file.name.endsWith(".rels")) continue;
    let xml: string;
    try { xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.async("uint8array")); }
    catch (cause) { fail("O Excel contém XML com codificação não suportada. Salve uma cópia em formato .xlsx UTF-8.", cause); }
    const eligible = file.name === "xl/workbook.xml" || file.name === "xl/styles.xml" || file.name === "xl/sharedStrings.xml" || /^xl\/(worksheets|tables)\/[^/]+\.xml$/.test(file.name);
    const namespace = file.name.endsWith(".rels") ? RELS_NS : eligible ? SPREADSHEET_NS : undefined;
    const normalized = normalizePortfolioXml(xml, namespace);
    metadata.set(file.name, normalized.info);
    if (normalized.xml !== xml) changed.set(file.name, normalized.xml);
  }
  const expect = (name: string, local: string, uri: string) => {
    const root = metadata.get(name)?.root;
    if (!root || root.local !== local || root.uri !== uri) fail(`Estrutura XML não suportada na parte ${name}.`);
  };
  expect("[Content_Types].xml", "Types", CONTENT_TYPES_NS);
  expect("xl/workbook.xml", "workbook", SPREADSHEET_NS);
  const relations = new Map<string, Map<string, { target: string; type: string }>>();
  const tableAliases: Record<string, string> = Object.create(null);
  for (const [name, info] of metadata) {
    if (!name.endsWith(".rels")) continue;
    expect(name, "Relationships", RELS_NS);
    const entries = new Map<string, { target: string; type: string }>();
    const ids = new Set<string>();
    for (const tag of info.tags.filter((tag) => tag.uri === RELS_NS && tag.local === "Relationship")) {
      const id = tag.attributes["{}Id"], target = tag.attributes["{}Target"], type = tag.attributes["{}Type"];
      if (!id || !target || !type || ids.has(id)) fail(`Relacionamento ausente ou duplicado em ${name}.`);
      ids.add(id);
      if (tag.attributes["{}TargetMode"] && !["Internal", "External"].includes(tag.attributes["{}TargetMode"])) fail(`Modo de relacionamento inválido em ${name}.`);
      if (tag.attributes["{}TargetMode"] === "External") continue;
      const path = resolveTarget(name, target);
      if (!zip.file(path)) fail(`Um relacionamento do Excel aponta para uma parte ausente: ${path}.`);
      if (type === `${DOCUMENT_RELS_NS}/table`) {
        const match = /^xl\/tables\/(table\d+\.xml)$/.exec(path);
        if (!match) fail("O caminho de uma tabela Excel não é suportado sem alterar a estrutura original.");
        const lookupKey = `../tables/${match[1]}`;
        if (target !== lookupKey) tableAliases[target] = lookupKey;
      }
      entries.set(id, { target: path, type });
    }
    relations.set(name, entries);
  }
  if (![...relations.get("_rels/.rels")!.values()].some((relation) => relation.target === "xl/workbook.xml" && relation.type === `${DOCUMENT_RELS_NS}/officeDocument`)) fail("Relacionamento principal da pasta de trabalho ausente.");
  const sheets = metadata.get("xl/workbook.xml")!.tags.filter((tag) => tag.uri === SPREADSHEET_NS && tag.local === "sheet");
  if (!sheets.length) fail("A pasta de trabalho não contém abas.");
  for (const sheet of sheets) {
    const relation = relations.get("xl/_rels/workbook.xml.rels")!.get(sheet.attributes[`{${DOCUMENT_RELS_NS}}id`]);
    if (!relation || relation.type !== `${DOCUMENT_RELS_NS}/worksheet`) fail("Uma aba do Excel não possui relacionamento válido.");
    expect(relation.target, "worksheet", SPREADSHEET_NS);
  }
  if (!changed.size) return { buffer, normalizedParts: [], tableAliases };
  if (files.some((file) => file.name.startsWith("_xmlsignatures/"))) fail("O Excel possui assinatura digital. A normalização invalidaria a assinatura; salve uma cópia sem assinatura.");
  for (const [name, xml] of changed) {
    const part = zip.file(name)!;
    zip.file(name, xml, { createFolders: false, date: part.date, comment: part.comment ?? undefined, unixPermissions: part.unixPermissions, dosPermissions: part.dosPermissions });
  }
  return { buffer: Uint8Array.from(await zip.generateAsync({ type: "uint8array" })).buffer, normalizedParts: [...changed.keys()], tableAliases };
}
