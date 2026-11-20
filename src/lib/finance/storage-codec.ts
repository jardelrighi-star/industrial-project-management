import { deflate, inflate } from "pako";

/** Compress large snapshots without removing any ERP fields or precision. */
export function compactFinanceStorage(raw: string): string {
  if (raw.length < 500_000) return raw;
  const compressed = deflate(raw, { to: "string" });
  const packed = JSON.stringify({ storageEncoding: "deflate-base64-v1", payload: btoa(compressed) });
  return packed.length < raw.length ? packed : raw;
}

/** Existing uncompressed v1 envelopes remain readable without rewriting them. */
export function expandFinanceStorage(raw: string): string {
  const packed = JSON.parse(raw);
  if (!packed || typeof packed !== "object" || !("storageEncoding" in packed)) return raw;
  if (packed.storageEncoding !== "deflate-base64-v1" || typeof packed.payload !== "string") throw new Error("Formato financeiro compacto inválido.");
  try {
    return inflate(atob(packed.payload), { to: "string" });
  } catch (cause) {
    throw new Error("Não foi possível ler os dados financeiros compactados. Os dados foram preservados.", { cause });
  }
}
