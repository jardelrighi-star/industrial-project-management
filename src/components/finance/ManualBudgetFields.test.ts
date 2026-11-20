import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ManualBudgetFields from "./ManualBudgetFields";

const request = { amount: "", correctionRequested: false, justification: "" };
test("missing financial budget offers an empty input without a legacy fallback", () => {
  const html = renderToStaticMarkup(createElement(ManualBudgetFields, { budget: null, request, onChange: () => {} }));
  assert.match(html, /Nenhuma alteração registrada/);
  assert.match(html, /inputMode="decimal"/);
  assert.match(html, /value=""/);
});

test("approved budget is directly editable with an optional note and history below", () => {
  const budget = { projectCode: "P1", originalApprovedAmount: 10000, updatedAmount: 10000, corrections: [{ previousAmount: 5000, newAmount: 10000, recordedAt: "2026-11-15T12:00:00Z", justification: "Digitação original incorreta" }] };
  const html = renderToStaticMarkup(createElement(ManualBudgetFields, { budget, request, onChange: () => {} }));
  assert.match(html, /<input/);
  assert.match(html, /<textarea/);
  assert.match(html, /Observação \(opcional\)/);
  assert.match(html, /Log de alterações/);
  assert.doesNotMatch(html, /Solicitar correção|Cancelar solicitação|legado|Salvar abrirá/);
  assert.match(html, /100,00/);
  assert.match(html, /50,00/);
  assert.match(html, /Digitação original incorreta/);
  assert.ok(html.indexOf("<input") < html.indexOf("<table"));
});
