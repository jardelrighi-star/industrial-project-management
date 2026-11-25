import { petTopics, type Field } from "./form";

export type Point = [number, number];
export type Strokes = Point[][];
export type Signer = { name: string; strokes: Strokes; company?: string };
export type Answer = string | string[] | Signer | Signer[];
export type Answers = Record<string, Answer>;

export type PetDocument = {
  id: string;
  ownerId: string;
  opening: Answers;
  ending?: Answers;
  createdAt: string;
  endedAt?: string;
};

export const PET_KEY = "industrial-project-pet:v1";
export const maxSignaturePoints = 1600;
export const maxPeople = 50;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dados da PET inválidos.");
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, limit = 240) {
  if (typeof value !== "string" || value.length > limit || !value.trim()) throw new Error("Informe um texto válido.");
  return value.trim();
}

function cleanSigner(value: unknown, needsCompany = false): Signer {
  const signer = asRecord(value);
  const name = cleanText(signer.name);
  const strokes: unknown = signer.strokes;
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > 100) throw new Error("Desenhe a assinatura.");
  let points = 0;
  const clean = strokes.map((stroke: unknown) => {
    if (!Array.isArray(stroke) || stroke.length < 2) throw new Error("Desenhe a assinatura.");
    points += stroke.length;
    if (points > maxSignaturePoints) throw new Error("A assinatura excedeu o limite de pontos.");
    return stroke.map((point: unknown): Point => {
      if (!Array.isArray(point) || point.length !== 2 ||
        !point.every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 1000)) {
        throw new Error("Assinatura inválida.");
      }
      return [point[0], point[1]];
    });
  });
  if (!clean.some((stroke) => stroke.some(([x, y]) => x !== stroke[0][0] || y !== stroke[0][1]))) {
    throw new Error("Desenhe a assinatura.");
  }
  return { name, strokes: clean, ...(needsCompany ? { company: cleanText(signer.company) } : {}) };
}

export function fieldVisible(field: Field, answers: Record<string, unknown>) {
  return !field.when || answers[field.when[0]] === field.when[1];
}

function cleanField(field: Field, value: unknown): Answer | undefined {
  if (!field.required && (value === undefined || value === "" ||
    (field.kind === "signature" && value && typeof value === "object" &&
      "name" in value && "strokes" in value && !value.name && Array.isArray(value.strokes) && !value.strokes.length))) return;
  if (field.kind === "signature") return cleanSigner(value);
  if (field.kind === "people") {
    if (!Array.isArray(value) || !value.length || value.length > maxPeople) throw new Error("Inclua e assine os participantes.");
    return value.map((person) => cleanSigner(person, field.id === "workers"));
  }
  if (field.kind === "checks") {
    if (!Array.isArray(value) || !value.length || !value.every((item) => typeof item === "string" && field.options?.includes(item))) {
      throw new Error("Marque as opções aplicáveis.");
    }
    return [...new Set<string>(value)];
  }
  const text = cleanText(value, field.kind === "textarea" ? 6000 : 240);
  if (field.kind === "choice" && !field.options?.includes(text)) throw new Error("Selecione uma opção.");
  if (field.kind === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString().slice(0, 10) !== text)) throw new Error("Informe uma data válida.");
  if (field.kind === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error("Informe um horário válido.");
  if (field.kind === "number" && (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > maxPeople)) {
    throw new Error(`Informe uma quantidade entre 1 e ${maxPeople}.`);
  }
  return text;
}

export function validateTopic(step: number, answers: Record<string, unknown>): Answers {
  const result: Answers = {};
  for (const field of petTopics[step].fields) {
    if (!fieldVisible(field, answers)) {
      if (step === 16) result[field.id] = "Não se aplica";
      continue;
    }
    try {
      const value = cleanField(field, answers[field.id]);
      if (value !== undefined) result[field.id] = value;
    } catch (cause) {
      throw new Error(`${field.label}: ${cause instanceof Error ? cause.message : "Resposta inválida."}`);
    }
  }
  if (step === 2 && `${answers.validUntilDate}T${answers.validUntilTime}` <= `${answers.startDate}T${answers.startTime}`) {
    throw new Error("A validade deve ser posterior ao início.");
  }
  if (step === 8 && petTopics[8].fields.some((field) => field.kind === "choice" && answers[field.id] === "Não")) {
    throw new Error("O checklist contém uma condição impeditiva para aprovação.");
  }
  if ((step === 10 && answers.responsibility !== "Sim") || (step === 12 && answers.authorization !== "Sim")) {
    throw new Error("A confirmação é necessária para prosseguir.");
  }
  if (step === 14 && `${answers.endDate}T${answers.endTime}` < `${answers.startDate}T${answers.startTime}`) {
    throw new Error("O encerramento deve ocorrer após o início.");
  }
  return result;
}

export function changePetDocuments(documents: PetDocument[], request: unknown, actorId: string, admin: boolean) {
  const input = asRecord(request);
  const id = input.id;
  if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Identificador da PET inválido.");
  }
  const existing = documents.find((document) => document.id === id);
  const now = new Date().toISOString();
  const reading = asRecord(input.answers);
  if (input.action === "create") {
    const opening: Answers = {};
    for (let step = 1; step <= 13; step++) Object.assign(opening, validateTopic(step, { ...reading, ...opening }));
    if (existing) {
      if (existing.ownerId === actorId && JSON.stringify(existing.opening) === JSON.stringify(opening)) return documents;
      throw new Error("Esta PET já foi salva.");
    }
    return [...documents, { id, opening, ownerId: actorId, createdAt: now }];
  }
  if (input.action !== "close") throw new Error("Operação de PET inválida.");
  if (!existing || (!admin && existing.ownerId !== actorId)) throw new Error("PET não encontrada.");
  const ending: Answers = {};
  for (let step = 14; step <= 16; step++) Object.assign(ending, validateTopic(step, { ...reading, ...existing.opening, ...ending }));
  if (existing.ending) {
    if (JSON.stringify(existing.ending) === JSON.stringify(ending)) return documents;
    throw new Error("Esta PET já foi encerrada.");
  }
  return documents.map((document) => document.id === id ? { ...document, ending, endedAt: now } : document);
}

export function readPetDocuments(raw: string | null): PetDocument[] {
  if (raw === null) return [];
  const result: unknown = JSON.parse(raw);
  if (!Array.isArray(result)) throw new Error("Não foi possível ler as PETs salvas.");
  return result;
}
