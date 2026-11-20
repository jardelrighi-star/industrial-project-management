import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PortfolioMappingTools from "./PortfolioMappingTools";

test("model controls expose named models, explicit saving and compatibility errors without importing", () => {
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(PortfolioMappingTools, {
    models: [{ id: "id", name: "Meu layout CAPEX", sheet: "Carteira", headerRow: 1, bindings: { code: "cod indorama", name: "nome", approvedAmount: "valor aprovado" } }],
    selectedId: "id", name: "", message: "", error: "Cabeçalho alterado", canSave: false,
    onSelect: noop, onName: noop, onSave: noop, onDetect: noop,
  }));
  assert.match(html, /Meu layout CAPEX/);
  assert.match(html, /Nome do novo modelo/);
  assert.match(html, /disabled=""[^>]*>Salvar modelo/);
  assert.match(html, /Cabeçalho alterado/);
  assert.doesNotMatch(html, /Confirmar importação/);
});
