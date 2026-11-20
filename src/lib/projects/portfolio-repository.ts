import { LocalStorageProjectRepository } from "./repository";
import { LocalStorageFinanceRepository } from "../finance/repository";
import { normalizeFinanceData } from "../finance/calculations";
import { validateProjects } from "./validation";
import { withStorageWriteLock } from "../storage-write-lock";
import { commitCoordinatedStorage, recoverCoordinatedStorage, hasPendingStorageRecovery, readCoordinatedValue, FINANCE_KEY, type StoragePort } from "../coordinated-storage";
import { previewPortfolioImport, type PortfolioPreview, type PortfolioReport, type PortfolioSnapshot } from "./portfolio-import";
import { mutateOnlineStorage, readOnlineStorage } from "../online/client";
import { onlineMode } from "../online/state";

const browserStorage = () => window.localStorage;

export class PortfolioImportRepository {
  constructor(private readonly storageProvider: () => StoragePort = browserStorage) {}

  async load(): Promise<PortfolioSnapshot> {
    if (onlineMode && this.storageProvider === browserStorage) {
      const storage = await readOnlineStorage();
      return new PortfolioImportRepository(() => storage).load();
    }
    const [projects, finance] = await Promise.all([
      new LocalStorageProjectRepository(this.storageProvider).load(),
      new LocalStorageFinanceRepository(this.storageProvider).load(),
    ]);
    return { projects: projects ?? [], finance };
  }

  pendingRecovery(): boolean { return !(onlineMode && this.storageProvider === browserStorage) && hasPendingStorageRecovery(this.storageProvider()); }

  async recover(): Promise<void> {
    if (onlineMode && this.storageProvider === browserStorage) return;
    await withStorageWriteLock(async () => { recoverCoordinatedStorage(this.storageProvider()); });
  }

  async confirm(preview: PortfolioPreview): Promise<{ saved: false; preview: PortfolioPreview } | { saved: true; report: PortfolioReport }> {
    if (onlineMode && this.storageProvider === browserStorage) {
      return mutateOnlineStorage((storage) => new PortfolioImportRepository(() => storage).confirm(preview));
    }
    return withStorageWriteLock(async () => {
      const storage = this.storageProvider();
      // Any previously committed batch must be mirrored first; failure blocks new writes but not coherent reads.
      recoverCoordinatedStorage(storage);
      const current = await this.load();
      const refreshed = previewPortfolioImport(preview.workbook, preview.mapping, current);
      if (JSON.stringify(refreshed.baseline) !== JSON.stringify(preview.baseline) || JSON.stringify(refreshed.rows) !== JSON.stringify(preview.rows)) return { saved: false, preview: refreshed };
      const imported = refreshed.rows.filter((r) => r.status === "new");
      if (!imported.length) throw new Error("Nenhum projeto novo válido para importar.");
      const projects = [...current.projects, ...imported.map((row) => row.project!)];
      validateProjects(projects);
      normalizeFinanceData({ ...current.finance, budgets: [...current.finance.budgets, ...imported.map((row) => row.budget!)] });

      // Append only. Preserve raw existing ledger fields, cached values and envelope extensions byte-for-value.
      const rawFinance = readCoordinatedValue(storage, FINANCE_KEY);
      const envelope = rawFinance === null ? { version: 1, data: current.finance } : JSON.parse(rawFinance);
      const nextFinance = { ...envelope, data: { ...envelope.data, budgets: [...envelope.data.budgets, ...imported.map((row) => row.budget!)] } };
      const result = commitCoordinatedStorage(storage, JSON.stringify(projects), JSON.stringify(nextFinance));
      return { saved: true, report: { imported: imported.map((row) => ({ ...row, reason: "Importado: projeto cadastrado e orçamento original registrado; autorização de execução pendente." })), notImported: refreshed.rows.filter((r) => r.status !== "new"), recoveryPending: result.recoveryPending } };
    });
  }
}
