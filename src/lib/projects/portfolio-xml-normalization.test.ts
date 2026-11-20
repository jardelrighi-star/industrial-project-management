import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import JSZip from "jszip";
import { Workbook } from "exceljs";
import { normalizePortfolioWorkbookZip, normalizePortfolioXml, SPREADSHEET_NS } from "./portfolio-xml-normalization";
import { loadPortfolioExcelWorkbook } from "./portfolio-exceljs-compatibility";
import { PortfolioWorkbookReadError } from "./portfolio-workbook-errors";
import { readPortfolioWorkbook } from "./portfolio-workbook";

async function richWorkbook() {
  const workbook = new Workbook();
  workbook.properties.date1904 = true;
  const sheet = workbook.addWorksheet("Carteira CAPEX");
  sheet.addRow(["COD_INDORAMA", "Texto", "Número", "Data", "Booleano", "Fórmula"]);
  sheet.addRow(["0001", "Texto literal <x:worksheet> & ç 😀", 1234.56, new Date("2026-01-02T00:00:00Z"), true, { formula: 'IF(1<2,"<x:worksheet>","x:r")', result: "<x:worksheet>" }]);
  sheet.getCell("C2").numFmt = "#,##0.00";
  sheet.getCell("D2").numFmt = "yyyy-mm-dd";
  sheet.getCell("G2").value = 7; sheet.getCell("G2").numFmt = "00000";
  sheet.getCell("H2").value = { richText: [{ text: "Texto ", font: { bold: true } }, { text: "x:literal" }] };
  sheet.getCell("I2").value = { error: "#DIV/0!" };
  sheet.getCell("J2").value = { text: "Link", hyperlink: "https://example.com/?a=x:worksheet&b=1" };
  sheet.mergeCells("A4:B4"); sheet.getCell("A4").value = "Mesclado";
  workbook.addWorksheet("Outra aba").addRow(["Intacta"]);
  return Uint8Array.from(new Uint8Array(await workbook.xlsx.writeBuffer())).buffer;
}

test("already-compatible ZIP is returned by identity without recompression or any byte changes", async () => {
  const input = await richWorkbook();
  const before = createHash("sha256").update(new Uint8Array(input)).digest("hex");
  const result = await normalizePortfolioWorkbookZip(input);
  assert.equal(result.buffer, input);
  assert.deepEqual(result.normalizedParts, []);
  assert.deepEqual(Object.keys(result.tableAliases), []);
  assert.equal(createHash("sha256").update(new Uint8Array(result.buffer)).digest("hex"), before);
});

test("only real SpreadsheetML element tokens change; literals, CDATA, comments, entities and attributes remain verbatim", () => {
  const xml = `<?xml version="1.0"?><x:worksheet xmlns:x="${SPREADSHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" note="&lt;x:row&gt; &amp; x:cell" r:id="same-id"><!-- <x:row/> --><x:sheetData><x:row r='1'><x:c r='A1' t='inlineStr'><x:is><x:t xml:space="preserve"><![CDATA[ <x:row> & 😀 ]]></x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`;
  const result = normalizePortfolioXml(xml, SPREADSHEET_NS).xml;
  assert.match(result, /<worksheet xmlns=/);
  assert.ok(result.includes('note="&lt;x:row&gt; &amp; x:cell" r:id="same-id"'));
  assert.ok(result.includes("<!-- <x:row/> -->"));
  assert.ok(result.includes("<![CDATA[ <x:row> & 😀 ]]>"));
  assert.ok(result.includes("<row r='1'><c r='A1' t='inlineStr'>"));
  assert.ok(result.includes('<t xml:space="preserve">'));
  assert.equal(normalizePortfolioXml(result, SPREADSHEET_NS).xml, result);
});

test("foreign namespace elements and attributes retain names and original default namespace scopes", () => {
  const xml = `<x:worksheet xmlns:x="${SPREADSHEET_NS}" xmlns:e="urn:extension"><e:item e:attribute="x:literal"><unqualified>value</unqualified></e:item><x:sheetData/></x:worksheet>`;
  const result = normalizePortfolioXml(xml, SPREADSHEET_NS).xml;
  assert.ok(result.includes('<e:item xmlns="" e:attribute="x:literal">'));
  assert.ok(result.includes("<unqualified>value</unqualified>"));
  const compatible = `<worksheet xmlns="${SPREADSHEET_NS}" xmlns:e="urn:extension"><e:item><row/></e:item></worksheet>`;
  assert.equal(normalizePortfolioXml(compatible, SPREADSHEET_NS).xml, compatible);
});

test("malformed XML, unbound prefixes, DTD, conflicting defaults and unsafe QName scopes are rejected", () => {
  for (const xml of [
    `<x:worksheet xmlns:x="${SPREADSHEET_NS}"><x:row></x:worksheet>`,
    "<x:worksheet/>",
    `<!DOCTYPE worksheet [<!ENTITY value "test">]><worksheet xmlns="${SPREADSHEET_NS}"/>`,
    `<x:worksheet xmlns:x="${SPREADSHEET_NS}" xmlns="urn:other"/>`,
    `<x:worksheet xmlns:x="${SPREADSHEET_NS}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" i:type="UnqualifiedType"/>`,
  ]) assert.throws(() => normalizePortfolioXml(xml, SPREADSHEET_NS), PortfolioWorkbookReadError);
});

test("rich workbook values, cached formulas, cell types, styles, hyperlinks and merged ranges survive normalization", async () => {
  const original = await richWorkbook();
  const baseline = new Workbook(); await baseline.xlsx.load(original);
  const zip = await JSZip.loadAsync(original);
  // Controlled generated fixture only; production edits are driven by namespace-aware parser offsets.
  for (const file of Object.values(zip.files)) {
    if (!/^xl\/(workbook|styles|sharedStrings|worksheets\/sheet\d+)\.xml$/.test(file.name)) continue;
    const xml = (await file.async("string")).replace("xmlns=", `xmlns:x="${SPREADSHEET_NS}" xmlns=`).replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g, "<$1x:$2");
    zip.file(file.name, xml);
  }
  const prefixed = Uint8Array.from(await zip.generateAsync({ type: "uint8array" })).buffer;
  const prepared = await normalizePortfolioWorkbookZip(prefixed);
  const loaded = await loadPortfolioExcelWorkbook(prepared);
  assert.equal(loaded.properties.date1904, baseline.properties.date1904);
  assert.deepEqual(loaded.worksheets.map((sheet) => sheet.name), baseline.worksheets.map((sheet) => sheet.name));
  const before = baseline.getWorksheet("Carteira CAPEX")!, after = loaded.getWorksheet("Carteira CAPEX")!;
  for (const address of ["A2", "B2", "C2", "D2", "E2", "F2", "G2", "H2", "I2", "J2"]) {
    assert.deepEqual(after.getCell(address).value, before.getCell(address).value, address);
    assert.equal(after.getCell(address).type, before.getCell(address).type, address);
    assert.equal(after.getCell(address).numFmt, before.getCell(address).numFmt, address);
  }
  assert.deepEqual(after.model.merges, before.model.merges);
  // Domain restrictions are unchanged: formulas and Excel errors still cannot be imported as values.
  const domain = await readPortfolioWorkbook(prefixed, "rich-prefixed.xlsx");
  const row = domain.sheets[0].rows.find((r) => r.rowNumber === 2)!;
  assert.match(row.cells[6].issue!, /Fórmula/);
  assert.match(row.cells[9].issue!, /erro/);
  assert.equal(row.cells[7].codeText, "00007");
});

test("invalid package parts, missing worksheet targets and corrupt XML are rejected without output", async () => {
  const source = await richWorkbook();
  for (const mode of ["missing-workbook", "missing-worksheet", "bad-xml", "missing-rels"] as const) {
    const zip = await JSZip.loadAsync(source);
    if (mode === "missing-workbook") zip.remove("xl/workbook.xml");
    if (mode === "missing-worksheet") zip.remove("xl/worksheets/sheet1.xml");
    if (mode === "bad-xml") zip.file("xl/styles.xml", "<styleSheet><broken></styleSheet>");
    if (mode === "missing-rels") zip.remove("xl/_rels/workbook.xml.rels");
    await assert.rejects(normalizePortfolioWorkbookZip(Uint8Array.from(await zip.generateAsync({ type: "uint8array" })).buffer), PortfolioWorkbookReadError);
  }
});

test("signed prefixed workbooks are rejected instead of invalidating their signature", async () => {
  const zip = await JSZip.loadAsync(await richWorkbook());
  const xml = (await zip.file("xl/workbook.xml")!.async("string")).replace("xmlns=", `xmlns:x="${SPREADSHEET_NS}" xmlns=`).replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)\b/g, "<$1x:$2");
  zip.file("xl/workbook.xml", xml);
  zip.file("_xmlsignatures/sig1.xml", '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>');
  await assert.rejects(normalizePortfolioWorkbookZip(Uint8Array.from(await zip.generateAsync({ type: "uint8array" })).buffer), /assinatura digital/);
});

test("ZIP integrity failures and duplicate or unsafe part names cannot be normalized", async () => {
  const original = await richWorkbook();
  const crcZip = await JSZip.loadAsync(original);
  const stored = await crcZip.generateAsync({ type: "uint8array", compression: "STORE" });
  const needle = new TextEncoder().encode("<styleSheet");
  let index = -1;
  for (let start = 0; start < stored.length - needle.length; start++) {
    if (needle.every((byte, i) => stored[start + i] === byte)) { index = start; break; }
  }
  assert.ok(index >= 0);
  stored[index + 1] ^= 1;
  await assert.rejects(normalizePortfolioWorkbookZip(Uint8Array.from(stored).buffer), /integridade/);

  const unsafe = await JSZip.loadAsync(original);
  unsafe.file("../escape.xml", "<escape/>");
  await assert.rejects(normalizePortfolioWorkbookZip(Uint8Array.from(await unsafe.generateAsync({ type: "uint8array" })).buffer), /caminho|duplicados/);

  const duplicate = await JSZip.loadAsync(original);
  duplicate.file("duplicate-a.bin", "A"); duplicate.file("duplicate-b.bin", "B");
  const bytes = await duplicate.generateAsync({ type: "uint8array", compression: "STORE" });
  const name = new TextEncoder().encode("duplicate-b.bin");
  // Deliberately produce duplicate local/central ZIP names in a synthetic malformed package.
  for (let start = 0; start <= bytes.length - name.length; start++) {
    if (name.every((byte, i) => bytes[start + i] === byte)) bytes[start + "duplicate-".length] = "a".charCodeAt(0);
  }
  await assert.rejects(normalizePortfolioWorkbookZip(Uint8Array.from(bytes).buffer), /duplicados/);
});

test("real reference keeps every relationship and untouched part byte-for-byte, including its table Target", { skip: !existsSync("references/carteira_capex_ficticia_teste.xlsx") }, async () => {
  const path = "references/carteira_capex_ficticia_teste.xlsx";
  const fileBefore = readFileSync(path);
  const prepared = await normalizePortfolioWorkbookZip(Uint8Array.from(fileBefore).buffer);
  assert.ok(prepared.normalizedParts.includes("xl/tables/table1.xml"));
  assert.equal(prepared.tableAliases["/xl/tables/table1.xml"], "../tables/table1.xml");
  const original = await JSZip.loadAsync(fileBefore), output = await JSZip.loadAsync(prepared.buffer);
  assert.deepEqual(Object.keys(output.files).sort(), Object.keys(original.files).sort());
  for (const part of Object.values(original.files).filter((part) => !part.dir && !prepared.normalizedParts.includes(part.name))) {
    assert.deepEqual(await output.file(part.name)!.async("uint8array"), await part.async("uint8array"), part.name);
  }
  const excel = await loadPortfolioExcelWorkbook(prepared);
  const table = excel.getWorksheet("Carteira CAPEX")!.getTable("CarteiraProjetosTeste");
  assert.ok(table);
  assert.equal(table.getColumn(0).name, "COD_INDORAMA");
  assert.equal(table.getColumn(12).name, "Status");
  const parsed = await readPortfolioWorkbook(Uint8Array.from(fileBefore).buffer, path);
  assert.equal(parsed.sheets[0].name, "Carteira CAPEX");
  assert.equal(parsed.sheets[0].rows[0].rowNumber, 1);
  assert.equal(parsed.sheets[0].rows.filter((row) => row.rowNumber > 1).length, 10);
  assert.deepEqual(readFileSync(path), fileBefore);
});
