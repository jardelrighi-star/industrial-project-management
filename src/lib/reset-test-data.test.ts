import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resetTestData } from "./reset-test-data";
import { FINANCE_KEY, PROJECT_KEY, TRANSACTION_KEY, readCoordinatedValue } from "./coordinated-storage";
import { emptyFinanceData } from "./finance/calculations";

function fixture(failingKey?: string) {
  const entries = new Map([
    [PROJECT_KEY, JSON.stringify([{ code: "P1", name: "Projeto de teste", unit: "", department: "", type: "CAPEX", category: "", owner: "", manager: "", start: "", finish: "", budget: 100, priority: "", status: "Planejado", progress: 0 }])],
    [FINANCE_KEY, JSON.stringify({ version: 1, data: { ...emptyFinanceData(), budgets: [{ projectCode: "P1", originalApprovedAmount: 10000, updatedAmount: 10000 }] } })],
    ["industrial-project-mapping-templates:v1", "saved templates"],
    ["unrelated", "keep"],
  ]);
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === failingKey) throw new Error("Storage unavailable");
      entries.set(key, value);
    },
  };
  return { entries, storage };
}

test("reset empties both repositories, preserves templates and unrelated data, and can be repeated", async () => {
  const { entries, storage } = fixture();
  await resetTestData(storage);
  await resetTestData(storage);
  assert.deepEqual(JSON.parse(readCoordinatedValue(storage, PROJECT_KEY)!), []);
  assert.deepEqual(JSON.parse(readCoordinatedValue(storage, FINANCE_KEY)!), { version: 1, data: emptyFinanceData() });
  assert.equal(entries.get(TRANSACTION_KEY), "null");
  assert.equal(entries.get("industrial-project-mapping-templates:v1"), "saved templates");
  assert.equal(entries.get("unrelated"), "keep");
});

test("failure before reset commit preserves existing data", async () => {
  const { entries, storage } = fixture(TRANSACTION_KEY);
  const before = new Map(entries);
  await assert.rejects(resetTestData(storage), /Storage unavailable/);
  assert.deepEqual(entries, before);
});

test("mirror failure after reset commit still exposes an empty consistent database", async () => {
  const { storage } = fixture(FINANCE_KEY);
  assert.equal((await resetTestData(storage)).recoveryPending, true);
  assert.deepEqual(JSON.parse(readCoordinatedValue(storage, PROJECT_KEY)!), []);
  assert.deepEqual(JSON.parse(readCoordinatedValue(storage, FINANCE_KEY)!).data, emptyFinanceData());
});
