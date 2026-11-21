import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FINANCE_KEY, PROJECT_KEY } from "../coordinated-storage";
import { actualCostReviewIdentity } from "../finance/actual-cost-review";
import { calculateProjectFinancials, emptyFinanceData } from "../finance/calculations";
import { LocalStorageFinanceRepository } from "../finance/repository";
import { previewCostImport } from "../finance/sankhya-import";
import { loadScOrderForecasts, SC_ORDER_FORECAST_KEY } from "../finance/sc-order-forecast";
import { loadScContracts, SC_CONTRACT_KEY } from "../finance/sc-contract";
import type { Project } from "../projects/types";
import { loadProcurementPlan } from "../projects/procurement-plan";
import { changeProcurement, changeReviews, changeScContract, changeScOrderForecast, replaceWorkspace, scopeWorkspace } from "./workspace";
import { memoryStorage, type WorkspaceState } from "./state";
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
  const state: WorkspaceState = {
    version: 1, payload: { [PROJECT_KEY]: JSON.stringify(projects), [FINANCE_KEY]: JSON.stringify({ version: 1, data: finance }) },
  };
  return { finance, state };
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

test("buyers schedule pending SCs in their projects, and later imports preserve their forecast", async () => {
  const buyer: Member = { ...manager, role: "buyer" };
  const { state, finance } = fixture();
  finance.requisitions = ["P1", "P2"].map((projectCode) => ({
    code: "123", projectCode, amount: 500, objective: "", approvalStatus: "approved",
    convertedOrderNumber: null, traceability: { sourceSystem: "Sankhya", sourceRecordId: projectCode, recordedAt: time, externalReference: null },
  }));
  state.payload[FINANCE_KEY] = JSON.stringify({ version: 1, data: finance });
  const request = { projectCode: "P1", scNumber: "123", forecastDate: "2027-03-10", expectedDate: null };
  await assert.rejects(changeScOrderForecast(manager, state.payload, request), /Apenas Compras/);
  await assert.rejects(changeScOrderForecast(buyer, state.payload, { ...request, projectCode: "P2" }), /acesso/);
  await assert.rejects(changeProcurement(buyer, state.payload, { operation: "addType", projectCode: "P1", name: "Locação" }), /consulta/);
  await assert.rejects(changeScOrderForecast(buyer, state.payload, { ...request, forecastDate: "2027-02-30" }), /Data inválida/);
  await changeScOrderForecast(buyer, state.payload, request);
  await assert.rejects(changeScOrderForecast(buyer, state.payload, { ...request, forecastDate: "2027-03-11" }), /mudou/);
  await changeScOrderForecast(admin, state.payload, { ...request, projectCode: "P2" });
  const scopedBuyer = await scopeWorkspace(buyer, state);
  assert.deepEqual(loadScOrderForecasts(memoryStorage(scopedBuyer.payload)), [{ projectCode: "P1", scNumber: "123", forecastDate: "2027-03-10" }]);
  const scopedManager = await scopeWorkspace(manager, state);
  assert.deepEqual(loadScOrderForecasts(memoryStorage(scopedManager.payload)), [{ projectCode: "P1", scNumber: "123", forecastDate: "2027-03-10" }]);

  const imported = await replaceWorkspace(admin, state, {
    version: state.version, changes: { [FINANCE_KEY]: JSON.stringify({ version: 1, data: {
      ...finance, requisitions: [{ ...finance.requisitions[0], convertedOrderNumber: "912" }, finance.requisitions[1]],
    } }) },
  });
  assert.equal(imported[SC_ORDER_FORECAST_KEY], state.payload[SC_ORDER_FORECAST_KEY]);
  await assert.rejects(changeScOrderForecast(buyer, imported, { ...request, expectedDate: "2027-03-10" }), /sem pedido/);
});

test("Purchasing decides contract requirements, and Legal can only schedule required SCs in its projects", async () => {
  const { state, finance } = fixture();
  const buyer: Member = { ...manager, role: "buyer" };
  const legal: Member = { ...manager, role: "legal" };
  finance.requisitions = ["P1", "P2"].map((projectCode) => ({
    code: "123", projectCode, amount: 500, objective: "", approvalStatus: "approved",
    convertedOrderNumber: null, traceability: { sourceSystem: "Sankhya", sourceRecordId: projectCode, recordedAt: time, externalReference: null },
  }));
  state.payload[FINANCE_KEY] = JSON.stringify({ version: 1, data: finance });
  const requirement = { operation: "requirement", projectCode: "P1", scNumber: "123", required: true, expectedRequired: null };
  const completion = { operation: "completion", projectCode: "P1", scNumber: "123", completionDate: "2027-03-20", expectedDate: null };
  await assert.rejects(changeScContract(legal, state.payload, requirement), /função/);
  await assert.rejects(changeScContract(buyer, state.payload, completion), /função/);
  await assert.rejects(changeScContract(legal, state.payload, completion), /não está marcada/);
  await changeScContract(buyer, state.payload, requirement);
  await changeScContract(admin, state.payload, { ...requirement, projectCode: "P2" });
  await assert.rejects(changeScContract(legal, state.payload, { ...completion, projectCode: "P2" }), /acesso/);
  await assert.rejects(changeScContract(legal, state.payload, { ...completion, completionDate: "2027-02-30" }), /Data inválida/);
  await changeScContract(legal, state.payload, completion);
  await assert.rejects(changeScContract(legal, state.payload, completion), /mudou/);
  const scoped = await scopeWorkspace(legal, state);
  assert.deepEqual(loadScContracts(memoryStorage(scoped.payload)), [{ projectCode: "P1", scNumber: "123", required: true, completionDate: "2027-03-20" }]);
  assert.equal((await scopeWorkspace(manager, state)).payload[SC_CONTRACT_KEY], undefined);
  await changeScContract(buyer, state.payload, { ...requirement, required: false, expectedRequired: true });
  await assert.rejects(changeScContract(legal, state.payload, { ...completion, expectedDate: "2027-03-20" }), /não está marcada/);
  assert.equal(loadScContracts(memoryStorage(state.payload))[0].completionDate, "2027-03-20");
});
