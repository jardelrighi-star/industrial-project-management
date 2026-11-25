import type { jsPDF } from "jspdf";
import type { PetDocument, Signer } from "./documents";
import { petTopics } from "./form";

const margin = 15;
const bottom = 280;
const lineHeight = 4.6;
const width = 180;
const formatDate = (value: string) => value.split("-").reverse().join("/");
const printable = (value: string) => value.normalize("NFC").replaceAll("₂", "2");

export function writePetPdf(pdf: jsPDF, document: PetDocument) {
  const number = String(document.opening.number);
  let y = margin;

  function text(value: string, size: number, bold = false, inset = 0) {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines: string[] = pdf.splitTextToSize(printable(value), width - inset);
    for (const line of lines) {
      ensureSpace(lineHeight);
      pdf.text(line, margin + inset, y);
      y += lineHeight;
    }
  }

  function ensureSpace(space: number) {
    if (y + space <= bottom) return;
    pdf.addPage();
    y = margin;
    text(`PET ${number} · Continuação`, 10, true);
    y += 4;
  }

  function signerBlock(signer: Signer, label?: string) {
    const name = [label, signer.name, signer.company].filter(Boolean).join(" · ");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    const lines: string[] = pdf.splitTextToSize(printable(name), width - 3);
    ensureSpace(lines.length * lineHeight + 27);
    text(name, 10, false, 3);
    const x = margin + 3;
    const top = y - 1;
    const signatureWidth = 84;
    const signatureHeight = 19;
    pdf.setDrawColor(180, 190, 205);
    pdf.rect(x, top, signatureWidth, signatureHeight);
    pdf.setDrawColor(15, 23, 42);
    for (const stroke of signer.strokes) {
      for (let i = 1; i < stroke.length; i++) {
        const [fromX, fromY] = stroke[i - 1];
        const [toX, toY] = stroke[i];
        pdf.line(x + fromX * signatureWidth / 1000, top + fromY * signatureHeight / 1000,
          x + toX * signatureWidth / 1000, top + toY * signatureHeight / 1000);
      }
    }
    y += signatureHeight + 5;
  }

  pdf.setProperties({ title: `PET ${number}`, subject: "Permissão de Entrada e Trabalho" });
  text("Permissão de Entrada e Trabalho", 16, true);
  y += 3;
  text(`PET ${number}`, 13, true);
  text(document.ending?.cancelled === "Sim" ? "Cancelada" : document.ending ? "Encerrada" : "Em aberto", 10);
  y += 3;

  for (let step = 1; step <= (document.ending ? 16 : 13); step++) {
    const topic = petTopics[step];
    const answers = step <= 13 ? document.opening : document.ending;
    ensureSpace(20);
    pdf.setFillColor(229, 240, 251);
    pdf.rect(margin, y - 4, width, 7, "F");
    text(`${step}. ${topic.title}`, 11, true);
    y += 2;
    if (topic.statement) text(topic.statement, 9);
    let filled = false;
    for (const field of topic.fields) {
      const value = answers?.[field.id];
      if (value === undefined) continue;
      filled = true;
      ensureSpace(lineHeight * 2);
      if (typeof value === "string") {
        text(`${field.label}: ${field.kind === "date" ? formatDate(value) : value}`, 10);
      } else if (field.kind === "checks") {
        text(`${field.label}: ${(value as string[]).join(", ")}`, 10);
      } else if (Array.isArray(value)) {
        text(field.label, 10, true);
        for (const person of value as Signer[]) signerBlock(person);
      } else {
        signerBlock(value, field.label);
      }
    }
    if (!filled) text("Sem preenchimento para esta atividade.", 10);
    y += 4;
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`${page} / ${pages}`, 195, 289, { align: "right" });
  }
}

export async function downloadPetPdf(document: PetDocument) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ compress: true });
  writePetPdf(pdf, document);
  const number = String(document.opening.number).replace(/[^0-9a-z_-]/gi, "-");
  pdf.save(`PET-${number || document.id}.pdf`);
}
