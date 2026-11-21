import type { StoragePort } from "../coordinated-storage";
import { withStorageWriteLock } from "../storage-write-lock";
import { parseExcelDate } from "./import-values";
import { scOrderKey } from "./sc-order-forecast";

export const SC_CONTRACT_KEY = "industrial-project-sc-contracts:v1";
export type ScContract = { projectCode: string; scNumber: string; required: boolean; completionDate?: string };
type ScReference = Pick<ScContract, "projectCode" | "scNumber">;
export type ScContractChange = ScReference & (
  | { operation: "requirement"; required: boolean; expectedRequired: boolean | null }
  | { operation: "completion"; completionDate: string; expectedDate: string | null }
);

function isContract(input: unknown): input is ScContract {
  if (!input || typeof input !== "object") return false;
  const row = input as Partial<ScContract>;
  return typeof row.projectCode === "string" && !!row.projectCode.trim() &&
    typeof row.scNumber === "string" && !!row.scNumber.trim() && typeof row.required === "boolean" &&
    (row.completionDate === undefined || (typeof row.completionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.completionDate)));
}

export function loadScContracts(storage: StoragePort = window.localStorage): ScContract[] {
  const raw = storage.getItem(SC_CONTRACT_KEY);
  if (raw === null) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.every(isContract) ||
    new Set(rows.map((row) => scOrderKey(row.projectCode, row.scNumber))).size !== rows.length) {
    throw new Error("Os registros de contratos salvos são inválidos.");
  }
  return rows;
}

export function saveScContract(change: ScContractChange, storage: StoragePort = window.localStorage) {
  return withStorageWriteLock(async () => {
    const { projectCode, scNumber } = change;
    const rows = loadScContracts(storage);
    const index = rows.findIndex((row) => row.projectCode === projectCode && row.scNumber === scNumber);
    const current = rows[index];
    if (change.operation === "requirement") {
      if ((current?.required ?? null) !== change.expectedRequired) {
        throw new Error("A necessidade de contrato mudou. Reabra a seção para atualizar os dados.");
      }
      const next = { ...current, projectCode, scNumber, required: change.required };
      if (index === -1) rows.push(next);
      else rows[index] = next;
    } else {
      if (!current?.required) throw new Error("Esta SC não está marcada como necessitando contrato.");
      if ((current.completionDate ?? null) !== change.expectedDate) {
        throw new Error("A previsão do contrato mudou. Reabra a seção para atualizar os dados.");
      }
      const completionDate = change.completionDate ? parseExcelDate(change.completionDate) : undefined;
      rows[index] = { ...current, completionDate };
    }
    storage.setItem(SC_CONTRACT_KEY, JSON.stringify(rows));
    return rows;
  });
}
