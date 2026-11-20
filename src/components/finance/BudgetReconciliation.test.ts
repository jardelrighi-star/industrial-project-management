import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BudgetReconciliation from "./BudgetReconciliation";
import { LocalStorageFinanceRepository } from "../../lib/finance/repository";

test("opening reconciliation offers preview without reading or writing storage or showing automatic confirmation", () => {
  let reads = 0;
  let writes = 0;
  const html = renderToStaticMarkup(createElement(BudgetReconciliation, {
    projectRepository: {
      load: async () => { reads++; throw new Error("Unexpected read"); },
      save: async () => { writes++; throw new Error("Unexpected write"); },
    },
    financeRepository: new LocalStorageFinanceRepository(() => { throw new Error("Unexpected storage access"); }),
    onConfirmed: () => { throw new Error("Unexpected confirmation"); },
  }));
  assert.match(html, /Gerar nova prévia/);
  assert.match(html, /Zero no legado não comprova aprovação/);
  assert.doesNotMatch(html, /Confirmar gravação/);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});
