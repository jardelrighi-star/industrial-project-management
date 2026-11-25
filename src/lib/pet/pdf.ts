import type { jsPDF } from "jspdf";
import type { PetDocument, Signer } from "./documents";
import { petTopics } from "./form";

const left = 6;
const width = 198;
const half = width / 2;
const header = 4.4;
const row = 3.5;
const printable = (value: string) => value.normalize("NFC").replaceAll("₂", "2");
const date = (value: string) => value.split("-").reverse().join("/");

export function writePetPdf(pdf: jsPDF, document: PetDocument, logo?: Uint8Array) {
  const opening = document.opening;
  const ending = document.ending ?? {};
  const number = String(opening.number ?? "");
  const value = (id: string) => {
    const answer = opening[id] ?? ending[id];
    return typeof answer === "string" ? answer : Array.isArray(answer) && answer.every((item) => typeof item === "string") ? answer.join(", ") : "";
  };
  const signature = (id: string) => {
    const answer = opening[id] ?? ending[id];
    return answer && typeof answer === "object" && !Array.isArray(answer) ? answer : undefined;
  };
  const extras: { label: string; text: string }[] = [];
  let y = 6;
  pdf.setProperties({ title: `PET ${number}`, subject: "Permissão de Entrada e Trabalho" });
  pdf.setLineWidth(0.16);
  pdf.setDrawColor(35, 47, 55);

  function lines(text: string, w: number, max: number, size: number, bold = false) {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const result: string[] = pdf.splitTextToSize(printable(text), w);
    if (result.length <= max) return result;
    const clipped = result.slice(0, max);
    let last = clipped[max - 1];
    while (last.length && pdf.getTextWidth(last + "…") > w) last = last.slice(0, -1);
    clipped[max - 1] = last + "…";
    return clipped;
  }

  function box(x: number, top: number, w: number, h: number, text = "", options: { blue?: boolean; bold?: boolean; size?: number; saveOverflow?: string } = {}) {
    if (options.blue) pdf.setFillColor(166, 207, 228);
    pdf.rect(x, top, w, h, options.blue ? "FD" : "S");
    if (!text) return;
    const size = options.size ?? 6.5;
    const leading = size * 0.39;
    const max = Math.max(1, Math.floor((h - 0.4) / leading));
    const fitted = lines(text, w - 2, max, size, options.bold);
    if (options.saveOverflow && fitted.at(-1)?.endsWith("…")) extras.push({ label: options.saveOverflow, text });
    pdf.text(fitted, x + 1, top + (h - (fitted.length - 1) * leading) / 2 + size * 0.12, { lineHeightFactor: leading / (size * 0.3528) });
  }

  function band(x: number, top: number, w: number, step: number, title = petTopics[step].title) {
    box(x, top, w, header, `${step}. ${title}`, { blue: true, bold: true, size: 7 });
  }

  function check(x: number, top: number, checked: boolean) {
    pdf.rect(x, top, 1.65, 1.65);
    if (checked) {
      pdf.setDrawColor(23, 87, 149);
      pdf.setLineWidth(0.32);
      pdf.line(x + 0.25, top + 0.85, x + 0.69, top + 1.35);
      pdf.line(x + 0.69, top + 1.35, x + 1.48, top + 0.24);
      pdf.setDrawColor(35, 47, 55);
      pdf.setLineWidth(0.16);
    }
  }

  const abbreviations: Record<string, string> = { Sim: "S", Não: "N", "Não se aplica": "NA" };

  function choices(x: number, top: number, w: number, h: number, label: string, options: readonly string[], answer: string, size = 6.1) {
    box(x, top, w, h);
    let xx = x + 1;
    for (const option of options) {
      check(xx, top + (h - 1.65) / 2, answer === option);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(5.2);
      const short = abbreviations[option] ?? option;
      pdf.text(short, xx + 2.05, top + h / 2 + 0.6);
      xx += short.length === 1 ? 4.15 : 5.45;
    }
    const available = x + w - xx - 0.6;
    let fontSize = size;
    let leading = fontSize * 0.39;
    let fitted = lines(label, available, Math.max(1, Math.floor((h - 0.15) / leading)), fontSize);
    while (fitted.at(-1)?.endsWith("…") && fontSize > 4.6) {
      fontSize -= 0.25;
      leading = fontSize * 0.39;
      fitted = lines(label, available, Math.max(1, Math.floor((h - 0.15) / leading)), fontSize);
    }
    pdf.text(fitted, xx + 0.1, top + (h - (fitted.length - 1) * leading) / 2 + 0.7, { lineHeightFactor: leading / (fontSize * 0.3528) });
  }

  function itemGrid(step: number, x: number, top: number, w: number, columns: number, height: number) {
    const fields = petTopics[step].fields.filter((field) => field.kind === "choice" && !field.when);
    const count = Math.ceil(fields.length / columns);
    for (let column = 0; column < columns; column++) {
      for (let index = 0; index < count; index++) {
        const field = step === 6 ? (column === 0 && index === 8 ? undefined : fields[column * 8 + index]) : fields[column * count + index];
        const xx = x + column * w / columns;
        const yy = top + index * height;
        if (field) choices(xx, yy, w / columns, height, field.label, field.options ?? [], value(field.id), 5.7);
        else box(xx, yy, w / columns, height);
      }
    }
    return count * height;
  }

  function labeled(x: number, top: number, w: number, h: number, label: string, answer: string) {
    box(x, top, w, h, `${label}: ${answer}`, { saveOverflow: label });
  }

  function ink(signer: Signer | undefined, x: number, top: number, w: number, h: number) {
    if (!signer) return;
    pdf.setDrawColor(23, 65, 111);
    pdf.setLineWidth(0.23);
    for (const stroke of signer.strokes) {
      for (let i = 1; i < stroke.length; i++) {
        const [x1, y1] = stroke[i - 1];
        const [x2, y2] = stroke[i];
        pdf.line(x + x1 * w / 1000, top + y1 * h / 1000, x + x2 * w / 1000, top + y2 * h / 1000);
      }
    }
    pdf.setDrawColor(35, 47, 55);
    pdf.setLineWidth(0.16);
  }

  function signedRow(x: number, top: number, w: number, h: number, label: string, signer?: Signer) {
    box(x, top, w * 0.65, h, `${label}: ${signer?.name ?? ""}`, { size: 6, saveOverflow: label });
    box(x + w * 0.65, top, w * 0.35, h);
    ink(signer, x + w * 0.65 + 1, top + 0.4, w * 0.35 - 2, h - 0.8);
  }

  box(left, y, 34, 10, logo ? "" : "Adfert", { bold: true, size: 11 });
  if (logo) pdf.addImage(logo, "PNG", left + 4, y + 0.8, 25.9, 8.4);
  box(left + 34, y, 106, 10, "PERMISSÃO DE ENTRADA E TRABALHO - PET", { bold: true, size: 11 });
  box(left + 140, y, 58, 10, "", { bold: true });
  pdf.setTextColor(150, 27, 32);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  const numberLine = lines(`Nº PET: ${number}`, 56, 1, 11, true)[0];
  pdf.text(numberLine, left + 142, y + 5.4);
  if (numberLine.endsWith("…")) extras.push({ label: "Nº PET", text: number });
  pdf.setTextColor(0);
  pdf.setFontSize(5.6);
  pdf.text(document.ending?.cancelled === "Sim" ? "Cancelada" : document.ending ? "Encerrada" : "Em aberto", left + 142, y + 8.4);
  y += 10;

  band(left, y, 108, 1, "Caracterização do trabalho (S–Sim / N–Não / NA–Não se aplica)");
  box(left, y + header, 108, header);
  labeled(left + 108, y, 90, header, "Nº OS", value("workOrder"));
  labeled(left + 108, y + header, 56, header, "Nº Projeto", value("project"));
  choices(left + 164, y + header, 34, header, "APR", ["Sim", "Não"], value("apr"));
  y += header * 2;
  const work = petTopics[1].fields.filter((field) => field.id.startsWith("work-"));
  for (let i = 0; i < work.length; i++) {
    const field = work[i];
    choices(left + Math.floor(i / 3) * width / 4, y + i % 3 * row, width / 4, row, field.label, field.options ?? [], value(field.id));
  }
  y += 3 * row;

  band(left, y, width, 2);
  y += header;
  const requisition = [
    ["Nome do requisitante", value("requester"), "Setor requisitante", value("department"), "Início", `${date(value("startDate"))}  ${value("startTime")}`],
    ["Nome do aprovador", value("approver"), "Local da atividade", value("location"), "Validade", `${date(value("validUntilDate"))}  ${value("validUntilTime")}`],
    ["Contratada", value("contracted"), "Empresa contratada", value("company"), "Quantidade de pessoas", value("peopleCount")],
    ["Homologada", value("approvedCompany"), "", "", "", ""],
  ];
  for (const [label, answer, middle, middleAnswer, end, endAnswer] of requisition) {
    for (const [x, w, name, content] of [[left, 72, label, answer], [left + 72, 73, middle, middleAnswer], [left + 145, 53, end, endAnswer]] as const) {
      if (name === "Contratada" || name === "Homologada") choices(x, y, w, row, name, ["Sim", "Não"], content);
      else if (name) labeled(x, y, w, row, name, content);
      else box(x, y, w, row);
    }
    y += row;
  }

  band(left, y, half, 3);
  band(left + half, y, half, 4);
  y += header;
  box(left, y, half, 4 * row, value("description"), { saveOverflow: "3. Descrição" });
  y += itemGrid(4, left + half, y, half, 2, row);

  band(left, y, half, 5);
  band(left + half, y, half, 6);
  y += header;
  const equipmentHeight = itemGrid(5, left, y, half, 2, 3.45);
  const hazardsHeight = itemGrid(6, left + half, y, half, 2, 3.45);
  box(left, y + equipmentHeight, half, hazardsHeight - equipmentHeight);
  y += hazardsHeight;

  band(left, y, width, 7);
  y += header;
  y += itemGrid(7, left, y, width, 4, row);

  band(left, y, width, 8, "Checklist de liberação de serviços (assinalar N implica condição impeditiva para aprovação)");
  y += header;
  const checklist = petTopics[8].fields.filter((field) => field.kind === "choice");
  const checklistRow = 4.35;
  for (const [index, item] of checklist.entries()) {
    const col = index >= 14 ? 1 : 0;
    choices(left + col * half, y + (col ? index - 14 : index + Number(index >= 4)) * checklistRow, half, checklistRow,
      item.label, item.options ?? [], value(item.id), 5.15);
  }
  const energyY = y + 4 * checklistRow;
  box(left, energyY, half, checklistRow, "Bloqueios:", { size: 5.5 });
  const energy = petTopics[8].fields.find((field) => field.id === "energyLocks")?.options ?? [];
  let energyX = left + 13;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(5.5);
  for (const option of energy) {
    const selected = opening.energyLocks;
    check(energyX, energyY + 1.3, Array.isArray(selected) && selected.some((item) => item === option));
    pdf.text(option, energyX + 2.1, energyY + 3.05);
    energyX += 4 + pdf.getTextWidth(option);
  }
  const measurementsX = left + half;
  let measurementsY = y + 5 * checklistRow;
  band(measurementsX, measurementsY, half, 9, "Medições · Espaço confinado");
  measurementsY += header;
  const measurementWidths = [19, 17.5, 12.5, 12.5, 12.5, 12.5, 12.5];
  const measurementNames = ["Medições", "Padrão", "Inicial", "Med 1", "Med 2", "Med 3", "Med 4"];
  const measurementRows = [
    ["Oxigênio", "19,5 a 23%"],
    ["Explosividade", "<4% LEL"],
    ["CO", "LT: 25 ppm"],
    ["H₂S", "LT: 2 ppm"],
  ];
  const measured = measurementRows.map(([label, standard], offset) => [
    label, standard, ...Array.from({ length: 5 }, (_, column) => value(`measure-${offset}-${column}`)),
  ]);
  for (const [index, entries] of [measurementNames, ...measured].entries()) {
    let xx = measurementsX;
    entries.forEach((entry, column) => {
      const w = measurementWidths[column];
      box(xx, measurementsY, w, 3.3, entry, { blue: index === 0 || column === 1, size: 5.6,
        saveOverflow: index && column >= 2 ? `Medição de ${entries[0]} · ${measurementNames[column]}` : undefined });
      xx += w;
    });
    measurementsY += 3.3;
  }
  labeled(measurementsX, measurementsY, half, row, "Data de calibração", date(value("calibration")));
  measurementsY += row;
  choices(measurementsX, measurementsY, half, row, "Necessidade de ventilação", ["Sim", "Não"], value("ventilation"));
  measurementsY += row;
  signedRow(measurementsX, measurementsY, half, 4.8, "Supervisor", signature("supervisor"));
  measurementsY += 4.8;
  const checklistEnd = y + 15 * checklistRow;
  if (measurementsY < checklistEnd) box(measurementsX, measurementsY, half, checklistEnd - measurementsY);
  else if (measurementsY > checklistEnd) box(left, checklistEnd, half, measurementsY - checklistEnd);
  y = Math.max(checklistEnd, measurementsY);

  box(left, y, width, 8, `10. ${petTopics[10].title}: ${petTopics[10].statement}`, { blue: true, size: 6.45 });
  y += 8;
  const workers = (opening.workers ?? []) as Signer[];
  const watchers = (opening.watchers ?? []) as Signer[];
  const slots = 7;
  const signHeight = 4;
  const tableWidths = [27, 42, 30];
  for (let col = 0; col < 2; col++) {
    let xx = left + col * half;
    for (const [i, label] of ["Empresa", "Nome do executante", "Assinatura"].entries()) {
      box(xx, y, tableWidths[i], header, col === 0 && i === 0 ? "11. Empresa" : label, { blue: true, bold: true });
      xx += tableWidths[i];
    }
    for (let i = 0; i < slots + 1; i++) {
      const person = col === 0 ? workers[i] : i < slots - 1 ? workers[slots + 1 + i] : watchers[i - slots + 1];
      const yy = y + header + i * signHeight;
      const columnX = left + col * half;
      box(columnX, yy, tableWidths[0], signHeight, person?.company ?? "", { size: 6, saveOverflow: "Empresa do executante" });
      const name = col === 1 && i >= slots - 1 ? `Vigia: ${person?.name ?? ""}` : person?.name ?? "";
      box(columnX + tableWidths[0], yy, tableWidths[1], signHeight, name, { size: 6, saveOverflow: "Participante" });
      const signatureX = columnX + tableWidths[0] + tableWidths[1];
      box(signatureX, yy, tableWidths[2], signHeight);
      ink(person, signatureX + 1, yy + 0.35, tableWidths[2] - 2, signHeight - 0.7);
    }
  }
  y += header + (slots + 1) * signHeight;
  box(left, y, width, 7, `12. ${petTopics[12].title}: ${petTopics[12].statement}`, { blue: true, size: 6.4 });
  y += 7;

  const approvalWidth = 70;
  const closingWidth = 80;
  const cancelWidth = width - approvalWidth - closingWidth;
  const closingX = left + approvalWidth;
  const cancelX = closingX + closingWidth;
  band(left, y, approvalWidth, 13);
  band(closingX, y, closingWidth, 14);
  band(cancelX, y, cancelWidth, 15, "Cancelada");
  y += header;
  const endingHeight = 21.4;
  for (const [index, role] of ["requester", "approver", "coapprover"].entries()) {
    const label = ["Ass. do requisitante", "Ass. do aprovador", "Ass. do co-aprovador"][index];
    signedRow(left, y + index * 4.8, approvalWidth, 4.8, label, signature(`approval-${role}`));
    signedRow(closingX, y + 7 + index * 4.8, closingWidth, 4.8, label, signature(`closure-${role}`));
  }
  box(left, y + 14.4, approvalWidth, 7, "Legenda: S–Sim  N–Não  NA–Não aplicável");
  labeled(closingX, y, closingWidth, row, "Fim / hora", `${date(value("endDate"))}  ${value("endTime")}`);
  choices(closingX, y + row, closingWidth, row, "Área limpa e organizada", ["Sim", "Não"], value("clean"));
  choices(cancelX, y, cancelWidth, row, "Cancelada", ["Sim", "Não"], value("cancelled"));
  labeled(cancelX, y + row, cancelWidth, endingHeight - row, "Motivo", value("cancellationReason"));
  y += endingHeight;

  labeled(left, y, width, 6, "Observações", value("notes"));
  y += 6;
  band(left, y, width, 16);
  y += header;
  for (const [index, item] of petTopics[16].fields.entries()) {
    choices(left + index * width / 4, y, width / 4, 7.2, item.label, item.options ?? [], value(item.id), 5.4);
  }
  y += 7.2;
  pdf.setFontSize(5.7);
  pdf.text("INDORAMA BRASIL LTDA. · CNPJ 42.602.384/0009-10 · R. Lineu Anterino Mariano, 175 · Distrito Industrial · CEP 38.402-346 · (34) 3222-0652", left + 1, y + 2.6);
  pdf.text("FOR.ST.010 – R.1 – 14/02/2024", left + 1, y + 5.1);

  for (const [id, label] of [
    ["environment-other", "4. Outros ambientes"], ["equipment-other", "5. Outros equipamentos"],
    ["hazard-other", "6. Outros perigos"], ["gloveClass", "7. Classe da luva de borracha"],
    ["uniformClass", "7. Classe do uniforme elétrico"], ["epi-other", "7. Outros EPIs"],
    ["clearance-other", "8. Outros itens do checklist"],
  ]) {
    if (value(id)) extras.push({ label, text: value(id) });
  }

  const extraPeople = [
    ...workers.slice(slots * 2).map((person) => ({ person, label: "Executante" })),
    ...watchers.slice(2).map((person) => ({ person, label: "Vigia" })),
  ];
  if (!extras.length && !extraPeople.length) return;

  function appendixPage() {
    pdf.addPage();
    y = 11;
    box(left, y, width, 9, `PET ${number} · Complemento do formulário`, { blue: true, size: 11, bold: true });
    y += 14;
  }

  function appendixText(text: string, bold = false) {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(9);
    const wrapped: string[] = pdf.splitTextToSize(printable(text), width - 4);
    for (const line of wrapped) {
      if (y > 280) {
        appendixPage();
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        pdf.setFontSize(9);
      }
      pdf.text(line, left + 2, y);
      y += 4.3;
    }
  }

  appendixPage();
  for (const item of extras) {
    if (y > 270) appendixPage();
    appendixText(item.label, true);
    appendixText(item.text);
    y += 2;
  }
  for (const { person, label } of extraPeople) {
    if (y > 249) appendixPage();
    appendixText([label, person.name, person.company].filter(Boolean).join(" · "), true);
    box(left + 2, y, 70, 15);
    ink(person, left + 3, y + 1, 68, 13);
    y += 20;
  }
}

export async function downloadPetPdf(document: PetDocument) {
  const [{ jsPDF }, logo] = await Promise.all([
    import("jspdf"),
    fetch("/pet/adfert.png").then(async (image) => image.ok ? new Uint8Array(await image.arrayBuffer()) : undefined)
      .catch(() => undefined),
  ]);
  const pdf = new jsPDF({ compress: true });
  writePetPdf(pdf, document, logo);
  const number = String(document.opening.number).replace(/[^0-9a-z_-]/gi, "-");
  pdf.save(`PET-${number || document.id}.pdf`);
}
