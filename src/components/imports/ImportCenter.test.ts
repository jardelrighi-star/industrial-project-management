import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImportCenter from "./ImportCenter";

test("central offers the existing importer and explicitly unavailable future modules without accessing storage", () => {
  const html = renderToStaticMarkup(createElement(ImportCenter, {
    projectCodes: ["P1", "P2"],
    dataRepository: {
      load: async () => { throw new Error("Rendering must not load storage"); },
      save: async () => { throw new Error("Rendering must not write storage"); },
    },
  }));
  assert.match(html, /Central de Importações/);
  assert.match(html, /Importar custos realizados do Sankhya/);
  assert.match(html, /Importar Carteira de Projetos/);
  assert.match(html, /COD_INDORAMA/);
  for (const name of ["SCs", "Pedidos", "Orçamentos", "Cronogramas MS Project XML"]) assert.ok(html.includes(name));
  assert.equal((html.match(/Ainda não disponível/g) ?? []).length, 2);
  assert.match(html, /Limpar base de teste/);
  assert.match(html, /Importar SCs do Sankhya/);
  assert.match(html, /Importar pedidos do Sankhya/);
  assert.equal((html.match(/<button/g) ?? []).length, 5);
});
