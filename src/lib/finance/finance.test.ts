import { strict as assert } from "node:assert";
import { test } from "node:test";
import { calculateCommittedTotal, calculateProjectFinancials, emptyFinanceData, normalizeFinanceData } from "./calculations";
import { FINANCE_STORAGE_KEY, LocalStorageFinanceRepository } from "./repository";
import type { ActualCost, BudgetAdjustment, FinanceData, PurchaseOrder, PurchaseRequisition } from "./types";
import { validateFinanceData } from "./validation";

const trace = (id: string) => ({ sourceSystem: "test", sourceRecordId: id, recordedAt: "2026-01-01T00:00:00Z", externalReference: null });
function data(): FinanceData {
  return { ...emptyFinanceData(), budgets: [
    { projectCode: "P1", originalApprovedAmount: 100000, updatedAmount: 100000 },
    { projectCode: "P2", originalApprovedAmount: 50000, updatedAmount: 50000 },
  ] };
}
const requisition = (code: string, approvalStatus: PurchaseRequisition["approvalStatus"] = "approved"): PurchaseRequisition => ({
  code, objective: "Contratar manutenção", projectCode: "P1", amount: 10000, approvalStatus, convertedOrderNumber: null, traceability: trace(code),
});
const order = (number: string, invoicedAmount: number, status: PurchaseOrder["status"], requisitionCode: string | null = null): PurchaseOrder => ({
  number, objective: "Contratar manutenção", supplier: "Fornecedor de teste", projectCode: "P1", totalAmount: 10000, invoicedAmount, openBalance: 10000 - invoicedAmount,
  status, requisitionCode, traceability: trace(number),
});
const actual = (id: string, entry = "1"): ActualCost => ({
  transactionId: id, supplier: "Fornecedor de teste", projectCode: "P1", fiscalDocument: "fiscal-key", documentEntryId: entry,
  date: "2026-01-01", amount: 4000, traceability: trace(id),
});

test("portfolio commitment matches project summaries, isolates links by project and ignores repeated project codes", () => {
  const d = data();
  d.requisitions = [requisition("same"), { ...requisition("same"), projectCode: "P2", traceability: trace("P2-SC") }, requisition("planned", "pending")];
  d.orders = [order("P1-order", 4000, "partially_invoiced"), { ...order("P2-order", 7000, "partially_invoiced", "same"), projectCode: "P2" }, order("cancelled", 0, "cancelled")];
  d.actualCosts = [actual("TX")];
  assert.equal(calculateCommittedTotal(["P1"], d), 16000);
  assert.equal(calculateCommittedTotal(["P2"], d), 3000);
  assert.equal(calculateCommittedTotal(["P1", "P2", "P1"], d), 19000);
  assert.equal(calculateCommittedTotal(["P1", "P2"], d), calculateProjectFinancials("P1", d).totalCommitted + calculateProjectFinancials("P2", d).totalCommitted);
  assert.equal(calculateCommittedTotal([], d), 0);
});

test("commitment excludes unapproved/converted SCs and invoiced/cancelled order balances", () => {
  const d = data();
  d.requisitions = [requisition("free"), requisition("pending", "pending"), requisition("rejected", "rejected"),
    { ...requisition("converted"), convertedOrderNumber: "not-loaded" }, requisition("linked")];
  d.orders = [order("partial", 4000, "partially_invoiced", "linked"), order("full", 10000, "fully_invoiced"), order("cancelled", 0, "cancelled")];
  d.actualCosts = [actual("tx")];
  const snapshot = JSON.stringify(d);
  const result = calculateProjectFinancials("P1", d);
  assert.equal(result.approvedUnconvertedRequisitions, 10000);
  assert.equal(result.uninvoicedOrderBalance, 6000);
  assert.equal(result.totalCommitted, 16000);
  assert.equal(result.totalActual, 4000);
  assert.equal(result.availableBalance, 80000);
  assert.equal(result.financialExecutionPercent, 4);
  assert.equal(calculateProjectFinancials("P2", d).totalCommitted, 0);
  assert.equal(JSON.stringify(d), snapshot);
});

test("only externally approved adjustments apply; transfer is balanced and counted once", () => {
  const d = data();
  const transfer: BudgetAdjustment = { id: "transfer", projectCode: "P1", sourceProjectCode: "P1", destinationProjectCode: "P2", type: "transfer", amount: 20000, justification: "External decision", date: "2026-01-01", externalApprovalReference: "approval-1", status: "approved" };
  d.adjustments = [transfer, { ...transfer }, { ...transfer, id: "pending", status: "pending" },
    { id: "increase", projectCode: "P1", type: "increase", amount: 5000, justification: "Approved", date: "2026-01-01", status: "approved", externalApprovalReference: "approval-2" },
    { id: "reduction", projectCode: "P1", type: "reduction", amount: 1000, justification: "Approved", date: "2026-01-01", status: "approved", externalApprovalReference: "approval-3" }];
  assert.equal(calculateProjectFinancials("P1", d).updatedAmount, 84000);
  assert.equal(calculateProjectFinancials("P2", d).updatedAmount, 70000);
  d.adjustments = [{ ...transfer, externalApprovalReference: null }];
  assert.throws(() => normalizeFinanceData(d));
  d.adjustments = [{ ...transfer, destinationProjectCode: "MISSING" }];
  assert.throws(() => normalizeFinanceData(d));
});

test("duplicate imports are idempotent and conflicting identities are rejected", () => {
  const d = data();
  d.actualCosts = [actual("tx"), actual("tx"), actual("line2", "2")];
  d.requisitions = [requisition("sc"), requisition("sc")];
  d.orders = [order("po", 0, "open"), order("po", 0, "open")];
  assert.equal(calculateProjectFinancials("P1", d).totalActual, 8000);
  assert.equal(normalizeFinanceData(d).orders.length, 1);
  d.actualCosts.push(actual("another-id"));
  assert.throws(() => normalizeFinanceData(d), /conflicting duplicate/);
});

test("rejects invalid amounts, balances and dates; handles zero budget and overspend", () => {
  const d = data();
  d.budgets[0].originalApprovedAmount = 0;
  d.actualCosts = [actual("tx")];
  assert.equal(calculateProjectFinancials("P1", d).financialExecutionPercent, null);
  assert.equal(calculateProjectFinancials("P1", d).availableBalance, -4000);
  d.actualCosts[0].amount = 0.5;
  assert.throws(() => normalizeFinanceData(d));
  d.actualCosts = [{ ...actual("tx"), date: "2026-02-30" }];
  assert.throws(() => normalizeFinanceData(d));
  d.actualCosts = [];
  d.orders = [{ ...order("po", 4000, "partially_invoiced"), openBalance: 10000 }];
  assert.throws(() => normalizeFinanceData(d));
});

test("storage is empty without seeding; roundtrips only its own versioned key", async () => {
  const entries = new Map<string, string>([["industrial-projects", "existing projects"]]);
  const repository = new LocalStorageFinanceRepository(() => ({ getItem: (k) => entries.get(k) ?? null, setItem: (k, v) => { entries.set(k, v); } }));
  assert.deepEqual(await repository.load(), emptyFinanceData());
  assert.equal(entries.size, 1);
  await repository.save(data());
  assert.deepEqual(await repository.load(), data());
  assert.equal(entries.get("industrial-projects"), "existing projects");
  entries.set(FINANCE_STORAGE_KEY, "broken JSON");
  await assert.rejects(repository.load());
  await assert.rejects(repository.save(data()));
  assert.equal(entries.get(FINANCE_STORAGE_KEY), "broken JSON");
  entries.set(FINANCE_STORAGE_KEY, JSON.stringify({ version: 2, data: data() }));
  await assert.rejects(repository.load());
});

test("storage access and quota errors propagate", async () => {
  const blocked = new LocalStorageFinanceRepository(() => { throw new Error("denied"); });
  await assert.rejects(blocked.load());
  const quota = new LocalStorageFinanceRepository(() => ({ getItem: () => null, setItem: () => { throw new Error("quota"); } }));
  await assert.rejects(quota.save(data()));
});

test("legacy v1 snapshots get empty metadata without mutation or automatic writes", async () => {
  const d = data();
  d.requisitions = [requisition("sc")];
  d.orders = [order("po", 4000, "partially_invoiced", "sc")];
  d.actualCosts = [actual("tx")];
  const legacy = {
    ...d,
    requisitions: d.requisitions.map(({ objective, ...rest }) => { void objective; return rest; }),
    orders: d.orders.map(({ objective, supplier, ...rest }) => { void objective; void supplier; return rest; }),
    actualCosts: d.actualCosts.map(({ supplier, ...rest }) => { void supplier; return rest; }),
  };
  const original = JSON.stringify(legacy);
  let saved = JSON.stringify({ version: 1, data: legacy });
  const originalSaved = saved;
  let writes = 0;
  const repository = new LocalStorageFinanceRepository(() => ({
    getItem: (key) => key === FINANCE_STORAGE_KEY ? saved : null,
    setItem: (_key, value) => { saved = value; writes++; },
  }));
  const loaded = await repository.load();
  assert.equal(loaded.requisitions[0].objective, "");
  assert.equal(loaded.orders[0].objective, "");
  assert.equal(loaded.orders[0].supplier, "");
  assert.equal(loaded.actualCosts[0].supplier, "");
  assert.equal(writes, 0);
  assert.equal(saved, originalSaved);
  assert.equal(JSON.stringify(legacy), original);
  assert.deepEqual(calculateProjectFinancials("P1", loaded), calculateProjectFinancials("P1", d));
  assert.deepEqual(normalizeFinanceData(legacy), loaded);
  await repository.save(loaded);
  assert.equal(writes, 1);
  assert.deepEqual(await repository.load(), loaded);
});

test("Sankhya descriptive fields roundtrip without changing calculations", async () => {
  const d = data();
  d.requisitions = [requisition("sc")];
  d.orders = [order("po", 0, "open")];
  d.actualCosts = [actual("tx")];
  const expected = calculateProjectFinancials("P1", d);
  let saved: string | null = null;
  const repository = new LocalStorageFinanceRepository(() => ({ getItem: (key) => key === FINANCE_STORAGE_KEY ? saved : null, setItem: (_k, v) => { saved = v; } }));
  await repository.save(d);
  assert.deepEqual(await repository.load(), d);
  d.requisitions[0].objective = "Outro objetivo";
  d.orders[0].objective = "Serviços especializados";
  d.orders[0].supplier = "Código 123 — Fornecedor";
  d.actualCosts[0].supplier = "Código 456 — Outro fornecedor";
  assert.deepEqual(calculateProjectFinancials("P1", d), expected);
  await repository.save(d);
  assert.deepEqual(await repository.load(), d);
});

test("descriptive fields reject invalid types and preserve duplicate conflict checks", () => {
  const d = data();
  d.requisitions = [requisition("sc")];
  d.orders = [order("po", 0, "open")];
  d.actualCosts = [actual("tx")];
  for (const [collection, field] of [["requisitions", "objective"], ["orders", "objective"], ["orders", "supplier"], ["actualCosts", "supplier"]] as const) {
    for (const invalid of [null, 123, {}, []]) {
      const invalidData = { ...d, [collection]: [{ ...d[collection][0], [field]: invalid }] };
      assert.throws(() => normalizeFinanceData(invalidData), /must be strings/);
      assert.throws(() => validateFinanceData(invalidData), /must be strings/);
    }
  }
  for (const variant of [
    { ...d, requisitions: [d.requisitions[0], { ...d.requisitions[0], objective: "Different" }] },
    { ...d, orders: [d.orders[0], { ...d.orders[0], supplier: "Different" }] },
    { ...d, orders: [d.orders[0], { ...d.orders[0], objective: "Different" }] },
    { ...d, actualCosts: [d.actualCosts[0], { ...d.actualCosts[0], supplier: "Different" }] },
  ]) assert.throws(() => normalizeFinanceData(variant), /conflicting duplicate/);
  const emptyMetadata = { ...d.requisitions[0], objective: "" };
  const legacyRequisition = { ...emptyMetadata } as Partial<PurchaseRequisition>;
  delete legacyRequisition.objective;
  assert.equal(normalizeFinanceData({ ...d, requisitions: [legacyRequisition, emptyMetadata] }).requisitions.length, 1);
});
