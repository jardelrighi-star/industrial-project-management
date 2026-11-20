import type { StoragePort } from "../coordinated-storage";
import { withStorageWriteLock } from "../storage-write-lock";
import { PORTFOLIO_FIELDS, REQUIRED_PORTFOLIO_FIELDS, type PortfolioField } from "./portfolio-import";
import { normalizePortfolioHeader } from "./portfolio-headers";
import type { PortfolioMappingModel } from "./portfolio-mapping-models";
import { mutateOnlineStorage, readOnlineStorage } from "../online/client";
import { onlineMode } from "../online/state";

const browserStorage = () => window.localStorage;

export const PORTFOLIO_MODELS_KEY = "industrial-project-mapping-templates:v1";
export interface PortfolioModelRepository { load(): Promise<PortfolioMappingModel[]>; add(model: PortfolioMappingModel): Promise<void> }

export function validatePortfolioModels(value: unknown): asserts value is PortfolioMappingModel[] {
  if (!Array.isArray(value)) throw new Error("Lista de modelos inválida.");
  const ids = new Set<string>(), names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Modelo inválido.");
    for (const field of ["id", "name", "sheet"] as const) if (typeof item[field] !== "string" || !item[field].trim() || item[field] !== item[field].trim()) throw new Error("Nome ou identificador de modelo inválido.");
    if (item.name.length > 80 || !Number.isSafeInteger(item.headerRow) || item.headerRow < 1) throw new Error("Nome ou linha de cabeçalho inválida.");
    if (!item.bindings || typeof item.bindings !== "object" || Array.isArray(item.bindings)) throw new Error("Campos do modelo inválidos.");
    const fields = item.bindings as Partial<Record<PortfolioField, unknown>>;
    const labels = new Set<string>();
    for (const [field, label] of Object.entries(fields)) {
      if (!Object.hasOwn(PORTFOLIO_FIELDS, field) || typeof label !== "string" || !label || normalizePortfolioHeader(label) !== label || labels.has(label)) throw new Error("Cabeçalhos do modelo ausentes, inválidos ou duplicados.");
      labels.add(label);
    }
    if (!REQUIRED_PORTFOLIO_FIELDS.every((field) => typeof fields[field] === "string")) throw new Error("O modelo não contém todos os campos obrigatórios.");
    const name = normalizePortfolioHeader(item.name);
    if (ids.has(item.id) || names.has(name)) throw new Error("Já existe um modelo com este nome ou identificador. Escolha outro nome.");
    ids.add(item.id); names.add(name);
  }
}

/** Separate versioned key: no project/finance access, no automatic writes or replacement of corrupt templates. */
export class LocalStoragePortfolioModelRepository implements PortfolioModelRepository {
  constructor(private readonly storageProvider: () => StoragePort = browserStorage) {}
  async load(): Promise<PortfolioMappingModel[]> {
    if (onlineMode && this.storageProvider === browserStorage) {
      const storage = await readOnlineStorage();
      return new LocalStoragePortfolioModelRepository(() => storage).load();
    }
    try {
      const raw = this.storageProvider().getItem(PORTFOLIO_MODELS_KEY);
      if (raw === null) return [];
      const envelope: unknown = JSON.parse(raw);
      if (!envelope || typeof envelope !== "object" || !("version" in envelope) || envelope.version !== 1 || !("models" in envelope)) throw new Error("Versão de modelos não suportada.");
      validatePortfolioModels(envelope.models);
      return envelope.models;
    } catch (cause) { throw new Error("Não foi possível ler os modelos salvos. Os dados armazenados foram preservados; o mapeamento manual continua disponível.", { cause }); }
  }
  async add(model: PortfolioMappingModel): Promise<void> {
    if (onlineMode && this.storageProvider === browserStorage) {
      return mutateOnlineStorage((storage) => new LocalStoragePortfolioModelRepository(() => storage).add(model));
    }
    return withStorageWriteLock(async () => {
      const models = await this.load();
      const next = [...models, model];
      validatePortfolioModels(next);
      try { this.storageProvider().setItem(PORTFOLIO_MODELS_KEY, JSON.stringify({ version: 1, models: next })); }
      catch (cause) { throw new Error("Não foi possível salvar o modelo. Os modelos anteriores foram preservados.", { cause }); }
    });
  }
}
