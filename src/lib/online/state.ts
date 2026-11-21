import type { StoragePort } from "../coordinated-storage";

export const onlineMode = process.env.NEXT_PUBLIC_APP_MODE === "online";
export const workspaceRoles = ["admin", "manager", "analyst", "buyer", "legal"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];
export function canScheduleOrders(role: WorkspaceRole) { return role === "admin" || role === "buyer"; }
export function canScheduleContracts(role: WorkspaceRole) { return role === "admin" || role === "legal"; }
export type OnlineSession = { email: string; role: WorkspaceRole };
export type WorkspacePayload = Record<string, string>;
export type WorkspaceState = { version: number; payload: WorkspacePayload };

export function memoryStorage(payload: WorkspacePayload): StoragePort {
  return {
    getItem: (key) => Object.hasOwn(payload, key) ? payload[key] : null,
    setItem: (key, value) => { payload[key] = value; },
  };
}
