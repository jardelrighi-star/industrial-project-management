import type { StoragePort } from "../coordinated-storage";

export const onlineMode = process.env.NEXT_PUBLIC_APP_MODE === "online";
export type WorkspaceRole = "admin" | "manager" | "analyst";
export type OnlineSession = { email: string; role: WorkspaceRole };
export type WorkspacePayload = Record<string, string>;
export type WorkspaceState = { version: number; payload: WorkspacePayload };

export function memoryStorage(payload: WorkspacePayload): StoragePort {
  return {
    getItem: (key) => Object.hasOwn(payload, key) ? payload[key] : null,
    setItem: (key, value) => { payload[key] = value; },
  };
}
