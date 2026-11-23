import { parseBrlCents, parseExcelDate } from "../finance/import-values";
import { withStorageWriteLock } from "../storage-write-lock";

export const PROCUREMENT_PLAN_KEY = "industrial-project-procurement:v1";
const defaultProcurementTypes = ["Material", "Serviço"];

export type PlannedPurchase = {
  id: string;
  projectCode: string;
  title?: string;
  description: string;
  type: string;
  estimatedCents: number;
  scNumber?: string;
  scOpeningForecast?: string;
  orderNumber?: string;
};

type ProcurementPlan = { types: string[]; purchases: PlannedPurchase[] };
type PurchaseDraft = {
  title: string; description: string; type: string; estimatedAmount: string;
  scNumber?: string; scOpeningForecast?: string; orderNumber?: string;
};
type StoragePort = Pick<Storage, "getItem" | "setItem">;

export function isScOpeningOverdue(
  purchase: Pick<PlannedPurchase, "scOpeningForecast" | "scNumber">,
  today: string,
  scMissingFromFinance = false,
): boolean {
  return Boolean(purchase.scOpeningForecast && purchase.scOpeningForecast < today &&
    (!purchase.scNumber?.trim() || scMissingFromFinance));
}

function typeKey(value: string) {
  return value.normalize("NFC").toLocaleLowerCase("pt-BR");
}

function isPlannedPurchase(value: unknown): value is PlannedPurchase {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<PlannedPurchase>;
  return typeof row.id === "string" && !!row.id && typeof row.projectCode === "string" &&
    (row.title === undefined || (typeof row.title === "string" && !!row.title.trim())) &&
    (row.scNumber === undefined || typeof row.scNumber === "string") &&
    (row.scOpeningForecast === undefined || typeof row.scOpeningForecast === "string") &&
    (row.orderNumber === undefined || typeof row.orderNumber === "string") &&
    typeof row.description === "string" && !!row.description.trim() && typeof row.type === "string" &&
    typeof row.estimatedCents === "number" && Number.isSafeInteger(row.estimatedCents) && row.estimatedCents >= 0;
}

export function loadProcurementPlan(storage: StoragePort = window.localStorage): ProcurementPlan {
  const saved = storage.getItem(PROCUREMENT_PLAN_KEY);
  if (saved === null) return { types: [...defaultProcurementTypes], purchases: [] };
  const plan = JSON.parse(saved) as Partial<ProcurementPlan> | null;
  if (!Array.isArray(plan?.types) || !plan.types.every((type) => typeof type === "string" && type.trim()) ||
    !Array.isArray(plan.purchases) || !plan.purchases.every(isPlannedPurchase)) {
    throw new Error("Não foi possível ler o plano de aquisições salvo.");
  }
  const existingKeys = new Set(plan.types.map(typeKey));
  const defaultsToAdd = defaultProcurementTypes.filter((type) => !existingKeys.has(typeKey(type)));
  return { types: [...plan.types, ...defaultsToAdd].sort((a, b) => a.localeCompare(b, "pt-BR")), purchases: plan.purchases };
}

export async function addProcurementType(name: string, storage: StoragePort = window.localStorage) {
  const type = name.trim().replace(/\s+/g, " ");
  if (!type) throw new Error("Informe o nome do tipo de contratação.");
  return withStorageWriteLock(async () => {
    const plan = loadProcurementPlan(storage);
    const existing = plan.types.find((value) => typeKey(value) === typeKey(type));
    if (existing) return { plan, type: existing };
    const next = { ...plan, types: [...plan.types, type].sort((a, b) => a.localeCompare(b, "pt-BR")) };
    storage.setItem(PROCUREMENT_PLAN_KEY, JSON.stringify(next));
    return { plan: next, type };
  });
}

async function savePlannedPurchase(
  projectCode: string,
  draft: PurchaseDraft,
  storage: StoragePort,
  purchaseId?: string,
) {
  const title = draft.title.trim();
  if (!title) throw new Error("Informe um título breve para a contratação.");
  const description = draft.description.trim();
  if (!description) throw new Error("Descreva a contratação.");
  const estimatedCents = parseBrlCents(draft.estimatedAmount);
  const scNumber = draft.scNumber?.trim();
  const scOpeningForecast = draft.scOpeningForecast?.trim();
  const orderNumber = draft.orderNumber?.trim();
  if (estimatedCents < 0) throw new Error("O valor estimado deve ser igual ou maior que zero.");
  return withStorageWriteLock(async () => {
    const plan = loadProcurementPlan(storage);
    if (!plan.types.includes(draft.type)) throw new Error("Selecione um tipo de contratação cadastrado.");
    const purchases = [...plan.purchases];
    const purchase = {
      id: purchaseId ?? crypto.randomUUID(), projectCode, title, description, type: draft.type, estimatedCents,
      ...(scNumber ? { scNumber } : {}),
      ...(scOpeningForecast ? { scOpeningForecast: parseExcelDate(scOpeningForecast) } : {}),
      ...(orderNumber ? { orderNumber } : {}),
    };
    if (purchaseId !== undefined) {
      const index = purchases.findIndex((item) => item.id === purchaseId && item.projectCode === projectCode);
      if (index === -1) throw new Error("A contratação não está mais disponível neste projeto.");
      purchases[index] = purchase;
    } else {
      purchases.push(purchase);
    }
    const next = { ...plan, purchases };
    storage.setItem(PROCUREMENT_PLAN_KEY, JSON.stringify(next));
    return next;
  });
}

export function addPlannedPurchase(projectCode: string, draft: PurchaseDraft, storage: StoragePort = window.localStorage) {
  return savePlannedPurchase(projectCode, draft, storage);
}

export function updatePlannedPurchase(projectCode: string, purchaseId: string, draft: PurchaseDraft, storage: StoragePort = window.localStorage) {
  return savePlannedPurchase(projectCode, draft, storage, purchaseId);
}

export function deletePlannedPurchase(projectCode: string, purchaseId: string, storage: StoragePort = window.localStorage) {
  return withStorageWriteLock(async () => {
    const plan = loadProcurementPlan(storage);
    const purchases = plan.purchases.filter((item) => item.id !== purchaseId || item.projectCode !== projectCode);
    if (purchases.length === plan.purchases.length) throw new Error("A contratação não está mais disponível neste projeto.");
    const next = { ...plan, purchases };
    storage.setItem(PROCUREMENT_PLAN_KEY, JSON.stringify(next));
    return next;
  });
}
