import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FINANCE_KEY, PROJECT_KEY } from "../coordinated-storage";
import { actualCostReviewIdentity } from "../finance/actual-cost-review";
import { calculateProjectFinancials, emptyFinanceData } from "../finance/calculations";
import { LocalStorageFinanceRepository } from "../finance/repository";
import { previewCostImport } from "../finance/sankhya-import";
import type { Project } from "../projects/types";
import { loadProcurementPlan } from "../projects/procurement-plan";
import { changeProcurement, changeReviews, replaceWorkspace, scopeWorkspace } from "./workspace";
import { memoryStorage } from "./state";
import type { Member } from "./server";

const manager: Member = { workspaceId: "w1", userId: "u1", email: "gestor@example.com", role: "manager", projectCodes: ["P1"] };
const analyst: Member = { ...manager, userId: "u2", email: "analista@example.com", role: "analyst" };
const admin: Member = { ...manager, role: "admin" };
const time = "2026-11-20T12:00:00Z";

function fixture() {
  const finance = emptyFinanceData();
  const projects: Project[] = ["P1", "P2"].map((code) => ({
    code, name: "Projeto " + code, unit: "Industrial", owner: "", manager: "", department: "",
    type: "CAPEX", category: "Confiabilidade", start: "", finish: "", budget: 0, priority: "Média", status: "Planejado", progress: 0,
  }));
  finance.budgets = projects.map(({ code }) => ({ projectCode: code, originalApprovedAmount: 100000, updatedAmount: 100000 }));
  finance.adjustments = [{ id: "a1", type: "transfer", projectCode: "P2", sourceProjectCode: "P2", destinationProjectCode: "P1", status: "approved", amount: 2500, date: "2026-11-20", justification: "Ajuste", externalApprovalReference: "ref" }];
  finance.actualCosts = previewCostImport({
    sourceFile: "custos.xlsx", date1904: false, projectField: "AD_PROJ_IHBL",
    rows: projects.map(({ code }, index) => ({ rowNumber: index + 4, values: {
      AD_PROJ_IHBL: code, CODEMP: 1, NUNOTA: 100 + index, NUMNOTA: 200 + index, CODPROD: 2, CODCENCUS: 3, DTENTSAI: 46000, VLRTOT: 50,
    } })),
  }, ["P1", "P2"], finance, time).rows.map((row) => row.cost!);
  return {
    finance,
    state: { version: 1, payload: { [PROJECT_KEY]: JSON.stringify(projects), [FINANCE_KEY]: JSON.stringify({ version: 1, data: finance }) } },
  };
}

test("scoped reads preserve the allowed project's balance and withhold the other portfolio", async () => {
  const { state } = fixture();
  const scoped = await scopeWorkspace(manager, state);
  assert.deepEqual(JSON.parse(scoped.payload[PROJECT_KEY]).map(({ code }: Project) => code), ["P1"]);
  const data = await new LocalStorageFinanceRepository(() => memoryStorage(scoped.payload)).load();
  assert.deepEqual(data.actualCosts.map((cost) => cost.projectCode), ["P1"]);
  assert.equal(calculateProjectFinancials("P1", data).updatedAmount, 102500);
  assert.doesNotMatch(scoped.payload[FINANCE_KEY], /P2/);
});

test("review authorship comes from the session and analysts alone can decide a manager's contestation", async () => {
  const { state, finance } = fixture();
  const { evaluateActualCost, indexActualCostReviews } = await import("../finance/actual-cost-review");
  const first = evaluateActualCost(finance.actualCosts[0], indexActualCostReviews(finance));
  assert.equal(first.status, "pending");
  const target = { identity: first.identity, expectedEvents: 0, expectedRevision: first.current.revision };
  const review = { decision: "rejected", targets: [target], note: "Conferir", actor: "Outro usuário" };
  await assert.rejects(changeReviews(analyst, state.payload, review), /função/);
  await assert.rejects(changeReviews(manager, state.payload, { ...review, targets: [{ ...target, identity: actualCostReviewIdentity(finance.actualCosts[1]) }] }), /acesso/);
  await changeReviews(manager, state.payload, review);
  const decision = { decision: "analyst_validated", targets: [{ ...target, expectedEvents: 1 }], note: "Conferido" };
  await assert.rejects(changeReviews(manager, state.payload, decision), /função/);
  await changeReviews(analyst, state.payload, decision);
  const saved = await new LocalStorageFinanceRepository(() => memoryStorage(state.payload)).load();
  assert.deepEqual(saved.actualCostReviews?.[0].events.map(({ actor, actorId }) => [actor, actorId]),
    [[manager.email, manager.userId], [analyst.email, analyst.userId]]);
  assert.deepEqual(JSON.parse((await replaceWorkspace(admin, state, {
    version: 1, changes: { [FINANCE_KEY]: JSON.stringify({ version: 1, data: finance }) },
  }))[FINANCE_KEY]).data.actualCostReviews, saved.actualCostReviews);
});

test("catalog and procurement mutations are scoped and only admins replace the global snapshots", async () => {
  const { state } = fixture();
  const input = { version: 1, changes: { [PROJECT_KEY]: state.payload[PROJECT_KEY] } };
  await assert.rejects(replaceWorkspace(manager, state, input), /administradores/);
  await assert.rejects(replaceWorkspace(admin, state, { ...input, version: 0 }), /outro usuário/);
  await assert.rejects(changeProcurement(manager, state.payload, { operation: "addType", projectCode: "P2", name: "Locação" }), /acesso/);
  await assert.rejects(changeProcurement(analyst, state.payload, { operation: "addType", projectCode: "P1", name: "Locação" }), /consulta/);
  assert.deepEqual(await changeProcurement(manager, state.payload, { operation: "addType", projectCode: "P1", name: "Locação" }), { type: "Locação" });
});

test("procurement saves, validates, and clears the optional SC opening forecast", async () => {
  const { state } = fixture();
  const draft = { title: "Material", description: "Compra de materiais", type: "Material", estimatedAmount: "50,00" };
  const create = { operation: "create", projectCode: "P1" };
  await assert.rejects(changeProcurement(manager, state.payload, {
    ...create, draft: { ...draft, scOpeningForecast: "2027-02-30" },
  }), /Data inválida/);
  await changeProcurement(manager, state.payload, {
    ...create, draft: { ...draft, scOpeningForecast: "2027-02-28" },
  });
  const scoped = await scopeWorkspace(manager, state);
  const [purchase] = loadProcurementPlan(memoryStorage(scoped.payload)).purchases;
  assert.equal(purchase.scOpeningForecast, "2027-02-28");
  await changeProcurement(manager, state.payload, {
    operation: "update", projectCode: "P1", id: purchase.id, draft: { ...draft, scOpeningForecast: "" },
  });
  assert.equal(loadProcurementPlan(memoryStorage(state.payload)).purchases[0].scOpeningForecast, undefined);
});
