import type { Project } from "./types";
import { validateProjects } from "./validation";
import { withStorageWriteLock } from "../storage-write-lock";
import { readCoordinatedValue, recoverCoordinatedStorage } from "../coordinated-storage";
import { mutateOnlineStorage, readOnlineStorage } from "../online/client";
import { onlineMode } from "../online/state";

export interface ProjectRepository {
  /** null means the key is absent; an empty saved portfolio is returned as []. */
  load(): Promise<Project[] | null>;
  save(projects: readonly Project[], expected?: readonly Project[]): Promise<void>;
}

export const PROJECTS_STORAGE_KEY = "industrial-projects";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
function browserStorage() {
  if (typeof window === "undefined") throw new Error("Armazenamento de projetos disponível apenas no navegador.");
  return window.localStorage;
}

export class LocalStorageProjectRepository implements ProjectRepository {
  constructor(private readonly storageProvider: () => StoragePort = browserStorage) {}

  async load(): Promise<Project[] | null> {
    if (onlineMode && this.storageProvider === browserStorage) {
      const storage = await readOnlineStorage();
      return new LocalStorageProjectRepository(() => storage).load();
    }
    try {
      const saved = readCoordinatedValue(this.storageProvider(), PROJECTS_STORAGE_KEY);
      if (saved === null) return null;
      const projects: unknown = JSON.parse(saved);
      validateProjects(projects);
      return projects;
    } catch (cause) {
      throw new Error("Não foi possível ler o cadastro de projetos. Os dados armazenados foram preservados.", { cause });
    }
  }

  async save(projects: readonly Project[], expected?: readonly Project[]): Promise<void> {
    if (onlineMode && this.storageProvider === browserStorage) {
      return mutateOnlineStorage((storage) => new LocalStorageProjectRepository(() => storage).save(projects, expected));
    }
    return withStorageWriteLock(async () => {
      try {
        recoverCoordinatedStorage(this.storageProvider());
        validateProjects(projects);
        // Refuse to overwrite malformed storage, including corruption after the initial load.
        const current = await this.load();
        if (expected && JSON.stringify(current ?? []) !== JSON.stringify(expected)) throw new Error("O cadastro mudou. Atualize a tela antes de salvar.");
        for (const project of projects) {
          const previous = current?.find((p) => p.code === project.code);
          if (previous ? previous.budget !== project.budget : project.budget !== 0) {
            throw new Error("O orçamento legado não pode ser editado; utilize a reconciliação financeira.");
          }
        }
        this.storageProvider().setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
      } catch (cause) {
        throw new Error("Não foi possível salvar o cadastro de projetos. A alteração não foi aplicada.", { cause });
      }
    });
  }
}
