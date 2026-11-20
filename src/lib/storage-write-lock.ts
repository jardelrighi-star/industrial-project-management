// All local repositories share one writer lock, including reconciliation preconditions.
let pending: Promise<unknown> = Promise.resolve();
export async function withStorageWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return await navigator.locks.request("industrial-project-management:write", operation);
  }
  if (typeof window !== "undefined") return Promise.reject(new Error("Este navegador não oferece bloqueio seguro de gravações. Utilize um navegador com suporte a Web Locks."));
  const next = pending.then(operation, operation);
  pending = next.catch(() => {});
  return next;
}
