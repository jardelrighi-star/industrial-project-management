import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FINANCE_KEY } from "../coordinated-storage";
import { emptyFinanceData } from "../finance/calculations";
import type { ActualCost } from "../finance/types";
import { memoryStorage } from "../online/state";
import { previewProcurementHistory, procurementHistorySignature, saveProcurementHistory } from "./procurement-history";
import { isScOpeningOverdue } from "./procurement-plan";

test("reconstructs one item per order, preserves plan estimates and skips cross-project orders", async () => {
  const finance = emptyFinanceData();
  function cost(id: string, projectCode: string, order: string, amount: number): ActualCost {
    return {
      transactionId: id, documentEntryId: id, projectCode, fiscalDocument: id, date: "2026-11-20",
      amount, supplier: "", reportFields: { NF_PEDIDO: [order] },
      traceability: { sourceSystem: "Sankhya", sourceRecordId: id, recordedAt: "2026-11-20T00:00:00Z", externalReference: null },
    };
  }
  finance.actualCosts = [
    cost("1", "P1", "101", 100), cost("2", "P1", "101", 200),
    cost("3", "P1", "102", 500), cost("4", "P2", "102", 700), cost("5", "P1", "0", 300),
  ];
  const storage = memoryStorage({ [FINANCE_KEY]: JSON.stringify({ version: 1, data: finance }) });
  const preview = previewProcurementHistory("P1", finance, []);
  assert.equal(preview.unlinked, 1);
  assert.match(preview.rows.find((row) => row.orderId === "102")?.issue ?? "", /mais de um projeto/);
  const plan = await saveProcurementHistory("P1", await procurementHistorySignature(preview), storage);
  assert.equal(plan.purchases.length, 1);
  const item = plan.purchases[0];
  assert.equal(item.estimatedCents, 0);
  assert.deepEqual(item.realized, { orderId: "101", cents: 300, lineCount: 2, documents: ["1", "2"] });
  assert.equal(isScOpeningOverdue({ ...item, scOpeningForecast: "2026-10-01" }, "2026-11-20"), false);
  await assert.rejects(saveProcurementHistory("P1", await procurementHistorySignature(preview), storage), /nova prévia/);
  const nextPreview = previewProcurementHistory("P1", finance, plan.purchases);
  const again = await saveProcurementHistory("P1", await procurementHistorySignature(nextPreview), storage);
  assert.deepEqual(again, plan);
});
