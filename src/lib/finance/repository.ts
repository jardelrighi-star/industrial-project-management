import type { FinanceData } from "./types";
import { emptyFinanceData, normalizeFinanceData } from "./calculations";
import { withStorageWriteLock } from "../storage-write-lock";
import { readCoordinatedValue, recoverCoordinatedStorage } from "../coordinated-storage";
import { compactFinanceStorage } from "./storage-codec";
import { mutateOnlineStorage, readOnlineStorage } from "../online/client";
import { onlineMode } from "../online/state";

/** Async boundary can be implemented by HTTP/API without changing consumers. */
export interface FinanceRepository {
  load(): Promise<FinanceData>;
  /** Explicit full snapshot replacement; callers must reconcile updates before saving. */
  save(data: FinanceData): Promise<void>;
  saveIfCurrent?(data: FinanceData, expected?: FinanceData, validateRelated?: () => Promise<void>): Promise<void>;
}

export const FINANCE_STORAGE_KEY = "industrial-project-finance:v1";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
function browserStorage() {
  if (typeof window === "undefined") throw new Error("Financial localStorage is available only in the browser");
  return window.localStorage;
}

/** Lazy browser access: importing this module during SSR never accesses window. */
export class LocalStorageFinanceRepository implements FinanceRepository {
  constructor(private readonly storageProvider: () => StoragePort = browserStorage) {}

  async load(): Promise<FinanceData> {
    if (onlineMode && this.storageProvider === browserStorage) {
      const storage = await readOnlineStorage();
      return new LocalStorageFinanceRepository(() => storage).load();
    }
    try {
      const saved = readCoordinatedValue(this.storageProvider(), FINANCE_STORAGE_KEY);
      if (saved === null) return emptyFinanceData();
      const envelope: unknown = JSON.parse(saved);
      if (!envelope || typeof envelope !== "object" || !("version" in envelope) || envelope.version !== 1 || !("data" in envelope)) {
        throw new Error("Unsupported financial storage version");
      }
      return normalizeFinanceData(envelope.data);
    } catch (cause) {
      throw new Error("Unable to read financial storage; existing data was preserved", { cause });
    }
  }

  async save(data: FinanceData): Promise<void> {
    return this.saveIfCurrent(data);
  }

  /** One atomic setItem after checking both financial and related cadastral snapshots under the shared writer lock. */
  async saveIfCurrent(data: FinanceData, expected?: FinanceData, validateRelated?: () => Promise<void>): Promise<void> {
    if (onlineMode && this.storageProvider === browserStorage) {
      return mutateOnlineStorage((storage) => new LocalStorageFinanceRepository(() => storage).saveIfCurrent(data, expected, validateRelated));
    }
    return withStorageWriteLock(async () => {
      try {
        recoverCoordinatedStorage(this.storageProvider());
        const normalized = normalizeFinanceData(data);
        // Do not silently overwrite malformed or unknown-version persisted records.
        const current = await this.load();
        if (expected && JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("Os dados financeiros mudaram. Gere uma nova prévia.");
        await validateRelated?.();
        this.storageProvider().setItem(FINANCE_STORAGE_KEY, compactFinanceStorage(JSON.stringify({ version: 1, data: normalized })));
      } catch (cause) {
        if (cause instanceof Error && (cause.name === "QuotaExceededError" || cause.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
          throw new Error("O armazenamento deste navegador está cheio. A importação não foi gravada e os dados anteriores foram preservados. Não é necessário gerar a mesma prévia novamente; libere espaço ou importe um arquivo menor.", { cause });
        }
        throw new Error("Não foi possível gravar os dados financeiros. Os dados anteriores foram preservados; gere uma nova prévia ou tente novamente.", { cause });
      }
    });
  }
}
