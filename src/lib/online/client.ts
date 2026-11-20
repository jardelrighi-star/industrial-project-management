import { memoryStorage, type WorkspaceState } from "./state";
import { TRANSACTION_KEY, type StoragePort } from "../coordinated-storage";

export async function onlineRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...options });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("ipm-session-expired"));
    throw new Error(typeof result?.error === "string" ? result.error : "Não foi possível consultar o servidor.");
  }
  return result as T;
}

export function onlinePost<T>(path: string, value: unknown): Promise<T> {
  return onlineRequest(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

export async function readOnlineStorage() {
  const { payload } = await onlineRequest<WorkspaceState>("/api/workspace");
  return memoryStorage(payload);
}

export async function mutateOnlineStorage<T>(operation: (storage: StoragePort) => Promise<T>): Promise<T> {
  const { payload, version } = await onlineRequest<WorkspaceState>("/api/workspace");
  const original = { ...payload };
  const result = await operation(memoryStorage(payload));
  const changes = Object.fromEntries(Object.entries(payload).filter(([key, value]) => key !== TRANSACTION_KEY && value !== original[key]));
  if (Object.keys(changes).length) {
    await onlinePost("/api/workspace", { action: "replace", version, changes });
  }
  return result;
}
