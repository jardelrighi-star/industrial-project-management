import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { compactFinanceStorage, expandFinanceStorage } from "./storage-codec";
import { LocalStorageFinanceRepository, FINANCE_STORAGE_KEY } from "./repository";
import { emptyFinanceData } from "./calculations";
import { readCostWorkbook } from "./sankhya-workbook";
import { previewCostImport, confirmCostImport } from "./sankhya-import";
import { commitCoordinatedStorage, recoverCoordinatedStorage, PROJECT_KEY, TRANSACTION_KEY } from "../coordinated-storage";

test("large financial envelopes compress losslessly, including Unicode, metadata and integer cents", () => {
  const raw = JSON.stringify({ version: 1, metadata: "Extensão preservada", data: Array.from({ length: 5000 }, (_, index) => ({ index, description: "Serviços de manutenção — aquisição de peças", cents: Number.MAX_SAFE_INTEGER, nullable: null, enabled: false })) });
  const compact = compactFinanceStorage(raw);
  assert.ok(compact.length < raw.length / 5);
  assert.equal(expandFinanceStorage(compact), raw);
  assert.equal(expandFinanceStorage(raw), raw);
  assert.equal(compactFinanceStorage('{"version":1}'), '{"version":1}');
});

test("unknown and corrupted compression formats fail without replacing persisted data", async () => {
  for (const value of [{ storageEncoding: "future", payload: "" }, { storageEncoding: "deflate-base64-v1", payload: "broken" }]) {
    const raw = JSON.stringify(value);
    const repository = new LocalStorageFinanceRepository(() => ({ getItem: (key) => key === FINANCE_STORAGE_KEY ? raw : null, setItem: () => assert.fail("Must not write") }));
    await assert.rejects(repository.load(), /preserved/);
  }
});

test("quota exhaustion explains the cause and preserves the old financial snapshot", async () => {
  const raw = JSON.stringify({ version: 1, data: emptyFinanceData() });
  const repository = new LocalStorageFinanceRepository(() => ({ getItem: (key) => key === FINANCE_STORAGE_KEY ? raw : null, setItem: () => { throw new DOMException("Full", "QuotaExceededError"); } }));
  await assert.rejects(repository.save(emptyFinanceData()), /armazenamento deste navegador está cheio/);
  assert.deepEqual(await repository.load(), emptyFinanceData());
});

test("real cost workbook saves under a 5 MiB UTF-16 quota and survives coordinated recovery", { skip: !process.env.COST_WORKBOOK_FIXTURE }, async () => {
  const bytes = await readFile(process.env.COST_WORKBOOK_FIXTURE!);
  const workbook = await readCostWorkbook(Uint8Array.from(bytes).buffer, "Painel Capex 20252.xlsx");
  // Isolate storage capacity from whichever project subset the user registered.
  const codes = [...new Set(workbook.rows.map((row) => String(row.values.COD_INDORAMA ?? "").trim()).filter(Boolean))];
  const preview = previewCostImport(workbook, codes, emptyFinanceData(), new Date().toISOString());
  const entries = new Map<string, string>();
  let failMirror = false;
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failMirror && key === FINANCE_STORAGE_KEY) throw new Error("Mirror failure");
      const next = new Map(entries).set(key, value);
      if ([...next.values()].reduce((sum, item) => sum + item.length * 2, 0) > 5 * 1024 * 1024) throw new DOMException("Full", "QuotaExceededError");
      entries.set(key, value);
    },
  };
  const repository = new LocalStorageFinanceRepository(() => storage);
  const result = await confirmCostImport(preview, codes, repository);
  assert.equal(result.saved, true);
  const saved = await repository.load();
  assert.ok(saved.actualCosts.length > 4000);
  assert.deepEqual(saved.actualCosts, result.preview.rows.filter((row) => row.status === "ready").map((row) => row.cost));
  assert.equal(previewCostImport(workbook, codes, saved, new Date().toISOString()).readyCount, preview.readyCount);
  failMirror = true;
  const next = { ...saved, budgets: [{ projectCode: codes[0], originalApprovedAmount: 10000, updatedAmount: 10000 }] };
  assert.equal(commitCoordinatedStorage(storage, "[]", JSON.stringify({ version: 1, data: next })).recoveryPending, true);
  assert.deepEqual(await repository.load(), next);
  failMirror = false;
  recoverCoordinatedStorage(storage);
  assert.equal(entries.get(TRANSACTION_KEY), "null");
  assert.equal(entries.get(PROJECT_KEY), "[]");
  assert.deepEqual(await repository.load(), next);
});
