import { commitCoordinatedStorage, type StoragePort } from "./coordinated-storage";
import { emptyFinanceData } from "./finance/calculations";
import { withStorageWriteLock } from "./storage-write-lock";

/** Clears application records together, preserving import mapping templates. */
export async function resetTestData(storage: StoragePort = window.localStorage) {
  return withStorageWriteLock(async () => commitCoordinatedStorage(
    storage,
    JSON.stringify([]),
    JSON.stringify({ version: 1, data: emptyFinanceData() }),
  ));
}
