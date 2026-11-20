import { validateProjects } from "./projects/validation";
import { normalizeFinanceData } from "./finance/calculations";
import { compactFinanceStorage, expandFinanceStorage } from "./finance/storage-codec";

/** Atomic logical commit for the two legacy localStorage keys. All repository readers use this adapter. */
export const PROJECT_KEY = "industrial-projects";
export const FINANCE_KEY = "industrial-project-finance:v1";
export const TRANSACTION_KEY = "industrial-project-management:transaction:v1";
export type StoragePort = Pick<Storage, "getItem" | "setItem">;
type Transaction = { version: 1; beforeProjects: string | null; beforeFinance: string | null; projects: string; finance: string };

function transaction(storage: StoragePort): Transaction | null {
  const raw = storage.getItem(TRANSACTION_KEY);
  if (raw === null || raw === "null") return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) throw new Error("Registro transacional inválido. Nenhum dado foi sobrescrito.");
  const item = value as Transaction;
  if (typeof item.projects !== "string" || typeof item.finance !== "string" || !(item.beforeProjects === null || typeof item.beforeProjects === "string") || !(item.beforeFinance === null || typeof item.beforeFinance === "string")) throw new Error("Registro transacional incompleto.");
  validateProjects(JSON.parse(item.projects));
  const financial = JSON.parse(expandFinanceStorage(item.finance));
  if (financial?.version !== 1) throw new Error("Versão financeira transacional inválida.");
  normalizeFinanceData(financial.data);
  return item;
}

function assertMirrors(storage: StoragePort, item: Transaction) {
  for (const [key, before, after] of [[PROJECT_KEY, item.beforeProjects, item.projects], [FINANCE_KEY, item.beforeFinance, item.finance]] as const) {
    const current = storage.getItem(key);
    if (current !== before && current !== after) throw new Error("Conflito com uma gravação externa durante a recuperação. Dados preservados; não é seguro continuar.");
  }
}

export function readCoordinatedValue(storage: StoragePort, key: string): string | null {
  const item = transaction(storage);
  if (item) assertMirrors(storage, item);
  const raw = item ? key === PROJECT_KEY ? item.projects : key === FINANCE_KEY ? item.finance : storage.getItem(key) : storage.getItem(key);
  return key === FINANCE_KEY && raw !== null ? expandFinanceStorage(raw) : raw;
}

/** Call under the shared writer lock. Reads alone never re-save legacy records. */
export function recoverCoordinatedStorage(storage: StoragePort): void {
  const item = transaction(storage);
  if (!item) return;
  assertMirrors(storage, item);
  if (storage.getItem(PROJECT_KEY) !== item.projects) storage.setItem(PROJECT_KEY, item.projects);
  if (storage.getItem(FINANCE_KEY) !== item.finance) storage.setItem(FINANCE_KEY, item.finance);
  // An explicit null tombstone clears only the internal journal, never user data.
  storage.setItem(TRANSACTION_KEY, "null");
}

export function hasPendingStorageRecovery(storage: StoragePort): boolean {
  return transaction(storage) !== null;
}

/** The journal write is the sole commit point. Once it succeeds both repositories see the whole batch. */
export function commitCoordinatedStorage(storage: StoragePort, projects: string, finance: string): { recoveryPending: boolean } {
  recoverCoordinatedStorage(storage);
  finance = compactFinanceStorage(finance);
  const item: Transaction = { version: 1, beforeProjects: storage.getItem(PROJECT_KEY), beforeFinance: storage.getItem(FINANCE_KEY), projects, finance };
  storage.setItem(TRANSACTION_KEY, JSON.stringify(item));
  try { recoverCoordinatedStorage(storage); return { recoveryPending: false }; }
  catch { return { recoveryPending: true }; }
}
