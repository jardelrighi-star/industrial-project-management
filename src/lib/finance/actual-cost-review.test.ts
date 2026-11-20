import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateActualCost, indexActualCostReviews, recordActualCostReview, recordActualCostReviews, rejectedActualCosts } from "./actual-cost-review";
import { emptyFinanceData, calculateActualCostTotal } from "./calculations";
import { LocalStorageFinanceRepository } from "./repository";
import { confirmCostImport, previewCostImport, type CostWorkbook } from "./sankhya-import";

const codes = ["P1"];
const at = "2026-11-20T12:00:00Z";
const original = { AD_PROJ_IHBL: "P1", NUNOTA: 123, NUMNOTA: 15, CODEMP: 1, CODPROD: 12, CODCENCUS: 8, DTENTSAI: 46000, VLRTOT: 50 };
const unrelated = { ...original, NUNOTA: 124, NUMNOTA: 16 };
const file = (...rows: Record<string, unknown>[]): CostWorkbook => ({
  sourceFile: "custos.xlsx", date1904: false, projectField: "AD_PROJ_IHBL",
  rows: rows.map((values, index) => ({ rowNumber: index + 4, values })),
});

function setup() {
  const entries = new Map<string, string>();
  const repository = new LocalStorageFinanceRepository(() => ({
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
  }));
  async function importCosts(workbook: CostWorkbook) {
    const result = await confirmCostImport(previewCostImport(workbook, codes, await repository.load(), at), codes, repository);
    assert.equal(result.saved, true);
  }
  async function evaluate(document = "15") {
    const data = await repository.load();
    return evaluateActualCost(data.actualCosts.find((cost) => cost.fiscalDocument === document)!, indexActualCostReviews(data));
  }
  return { repository, importCosts, evaluate };
}

test("recognition persists through a reordered import and requires a fresh decision after changes or absence", async () => {
  const { repository, importCosts, evaluate } = setup();
  assert.deepEqual(await repository.load(), emptyFinanceData());
  await importCosts(file(original, unrelated));
  const item = await evaluate();
  assert.equal(item.status, "pending");
  await recordActualCostReview(repository, {
    identity: item.identity, expectedRevision: item.current.revision, expectedEvents: 0,
    action: "recognized", actor: "Gestor", note: "",
  });
  await importCosts(file(unrelated, original));
  assert.equal((await evaluate()).status, "recognized");
  await importCosts(file({ ...original, VLRTOT: 60 }));
  assert.equal((await evaluate()).status, "review_again");
  const changed = await evaluate();
  assert.equal(changed.status, "review_again");
  await recordActualCostReview(repository, {
    identity: changed.identity, expectedRevision: changed.current.revision, expectedEvents: 1,
    action: "recognized", actor: "Gestor", note: "",
  });
  await importCosts(file(unrelated));
  assert.equal((await repository.load()).actualCostReviews?.[0].events.length, 2);
  await importCosts(file({ ...original, VLRTOT: 60 }));
  assert.equal((await evaluate()).status, "review_again");
});

test("analyst rejection preserves the contested amount and sends a corrected version back for review", async () => {
  const { repository, importCosts, evaluate } = setup();
  await importCosts(file(original));
  const item = await evaluate();
  assert.equal(item.status, "pending");
  const request = {
    identity: item.identity, expectedRevision: item.current.revision, expectedEvents: 0,
    action: "rejected" as const, actor: "Gestor",
  };
  await assert.rejects(recordActualCostReview(repository, { ...request, note: " " }), /motivo/);
  await recordActualCostReview(repository, { ...request, note: "Rateio incorreto" });
  assert.equal(calculateActualCostTotal("P1", await repository.load()), 5000);
  await importCosts(file({ ...original, VLRTOT: 25 }));
  const [queued] = rejectedActualCosts(indexActualCostReviews(await repository.load()));
  assert.equal(queued.rejection.cost.amount, 5000);
  assert.equal(queued.current?.amount, 2500);
  const resolved = await recordActualCostReview(repository, {
    identity: queued.review.identity, expectedEvents: 1, expectedRevision: queued.current!.revision,
    action: "analyst_rejected", actor: "Analista", note: "Rateio original incorreto",
  });
  assert.equal(rejectedActualCosts(indexActualCostReviews(resolved)).length, 0);
  assert.equal(resolved.actualCostReviews?.[0].events[1].cost.amount, 5000);
  assert.equal((await evaluate()).status, "review_again");
  await importCosts(file(original, original));
  assert.equal((await evaluate()).status, "unavailable");
});

test("repeated cost keys can be reviewed individually when their exported versions are distinct", async () => {
  const { repository, importCosts } = setup();
  const otherItem = { ...original, VLRTOT: 10 };
  await importCosts(file(original, otherItem));
  const data = await repository.load();
  const first = evaluateActualCost(data.actualCosts[0], indexActualCostReviews(data));
  assert.equal(first.status, "pending");
  await recordActualCostReview(repository, {
    identity: first.identity, expectedRevision: first.current.revision, expectedEvents: 0,
    action: "recognized", actor: "Gestor", note: "",
  });
  await importCosts(file(otherItem, original));
  const reordered = await repository.load();
  assert.deepEqual(reordered.actualCosts.map((cost) => evaluateActualCost(cost, indexActualCostReviews(reordered)).status), ["pending", "recognized"]);
  await importCosts(file(original));
  const single = await repository.load();
  assert.equal(evaluateActualCost(single.actualCosts[0], indexActualCostReviews(single)).status, "recognized");
});

test("both analyst outcomes persist on unchanged costs and only validation requires a reason", async () => {
  for (const action of ["analyst_validated", "analyst_rejected"] as const) {
    const { repository, importCosts, evaluate } = setup();
    await importCosts(file(original));
    const item = await evaluate();
    assert.equal(item.status, "pending");
    const target = { identity: item.identity, expectedRevision: item.current.revision };
    await recordActualCostReview(repository, {
      ...target, expectedEvents: 0, action: "rejected", actor: "Gestor", note: "Conferir o documento",
    });
    const decision = { ...target, expectedEvents: 1, action, actor: "Analista", note: " " };
    if (action === "analyst_validated") {
      await assert.rejects(recordActualCostReview(repository, decision), /motivo/);
      await recordActualCostReview(repository, { ...decision, note: "Conferência concluída" });
    } else {
      await recordActualCostReview(repository, decision);
    }
    await importCosts(file(unrelated, original));
    assert.equal((await evaluate()).status, action);
    assert.equal(calculateActualCostTotal("P1", await repository.load()), 10000);
    assert.equal(rejectedActualCosts(indexActualCostReviews(await repository.load())).length, 0);
  }
});

test("the manager's batch records every selection or none if a selected version is stale", async () => {
  const { repository, importCosts, evaluate } = setup();
  await importCosts(file(original, unrelated));
  const selected = await Promise.all([evaluate("15"), evaluate("16")]);
  const targets = selected.map((item) => {
    assert.equal(item.status, "pending");
    return { identity: item.identity, expectedEvents: 0, expectedRevision: item.current.revision };
  });
  await importCosts(file(original, { ...unrelated, VLRTOT: 51 }));
  const decision = { action: "recognized" as const, actor: "Gestor", note: "" };
  await assert.rejects(recordActualCostReviews(repository, targets, decision), /mudou/);
  assert.equal((await repository.load()).actualCostReviews, undefined);
  const updated = await evaluate("16");
  assert.equal(updated.status, "pending");
  const saved = await recordActualCostReviews(repository, [targets[0], { ...targets[1], expectedRevision: updated.current.revision }], decision);
  assert.equal(saved.actualCostReviews?.length, 2);
  assert.equal((await evaluate("15")).status, "recognized");
  assert.equal((await evaluate("16")).status, "recognized");
});
