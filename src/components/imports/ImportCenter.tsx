"use client";

import { useState } from "react";
import SankhyaCostImport from "../finance/SankhyaCostImport";
import SankhyaRequisitionImport from "../finance/SankhyaRequisitionImport";
import SankhyaOrderImport from "../finance/SankhyaOrderImport";
import PortfolioImport from "./PortfolioImport";
import { LocalStorageFinanceRepository, type FinanceRepository } from "../../lib/finance/repository";
import { resetTestData } from "../../lib/reset-test-data";
import { onlinePost, onlineRequest } from "../../lib/online/client";
import { onlineMode, type WorkspaceState } from "../../lib/online/state";

const repository = new LocalStorageFinanceRepository();

export default function ImportCenter({ projectCodes, dataRepository = repository, onImported = () => {} }: { projectCodes: readonly string[]; dataRepository?: FinanceRepository; onImported?: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");

  async function clearTestData() {
    if (resetting) return;
    if (!onlineMode && !window.confirm("Limpar todos os projetos, orçamentos, custos realizados, ajustes, SCs, pedidos e históricos deste navegador? Essa ação não pode ser desfeita. Os modelos de mapeamento serão preservados.")) return;
    setResetting(true);
    setResetError("");
    try {
      if (onlineMode) {
        const { version } = await onlineRequest<WorkspaceState>("/api/workspace");
        if (!window.confirm("Apagar os dados operacionais da carteira online compartilhada para todos os usuários? Projetos, financeiro, planos de aquisições, previsões, contratos e avaliações serão apagados. Contas, acessos e modelos de importação serão preservados. A limpeza não pode ser desfeita.")) {
          setResetting(false);
          return;
        }
        await onlinePost("/api/workspace", { action: "reset", version });
      } else {
        await resetTestData();
      }
      window.location.reload();
    } catch (cause) {
      setResetError(cause instanceof Error ? cause.message : "Não foi possível limpar a base de teste.");
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Central de Importações</h1>
        <p className="mt-2 text-sm text-slate-500">Importações globais para todos os projetos cadastrados, com revisão e confirmação antes da gravação.</p>
      </header>
      <section aria-labelledby="reset-test-title" className="rounded-xl border border-red-200 bg-white p-5">
        <h2 id="reset-test-title" className="font-semibold">Iniciar teste do zero</h2>
        <p className="mt-2 text-sm text-slate-600">{onlineMode
          ? "Apaga os dados operacionais da carteira compartilhada. Contas, acessos, modelos de importação e tipos de aquisição são preservados."
          : "Apaga projetos, orçamentos, custos realizados e demais registros financeiros e históricos deste navegador. Os modelos de mapeamento são mantidos."}</p>
        <p className="mt-2 text-sm text-slate-600">Depois da limpeza, importe primeiro a carteira de projetos e depois revise os vínculos na prévia de custos realizados.</p>
        <button type="button" disabled={resetting} onClick={() => void clearTestData()} className="mt-4 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">{resetting ? "Limpando…" : "Limpar base de teste"}</button>
        {resetError && <p role="alert" className="mt-3 text-sm text-red-700">{resetError}</p>}
      </section>
      <PortfolioImport onImported={onImported} />
      <section aria-labelledby="cost-import-title">
        <h2 id="cost-import-title" className="mb-2 text-lg font-bold">Custos realizados · Sankhya</h2>
        <p className="mb-4 text-sm text-slate-600">O vínculo usa AD_PROJ_IHBL na exportação direta e COD_INDORAMA no Painel Capex.</p>
        <SankhyaCostImport projectCodes={projectCodes} repository={dataRepository} onImported={onImported} />
      </section>
      <section aria-labelledby="sc-import-title">
        <h2 id="sc-import-title" className="mb-2 text-lg font-bold">Solicitações de compra · Sankhya</h2>
        <SankhyaRequisitionImport projectCodes={projectCodes} repository={dataRepository} onImported={onImported} />
      </section>
      <section aria-labelledby="order-import-title">
        <h2 id="order-import-title" className="mb-2 text-lg font-bold">Pedidos · Sankhya</h2>
        <SankhyaOrderImport projectCodes={projectCodes} repository={dataRepository} onImported={onImported} />
      </section>
      <section aria-labelledby="future-imports-title">
        <h2 id="future-imports-title" className="mb-4 text-lg font-bold">Próximos módulos</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {["Orçamentos", "Cronogramas MS Project XML"].map((name) => (
            <article key={name} className="rounded-xl border bg-white p-5 shadow-sm">
              <h3 className="font-semibold">{name}</h3>
              <p className="mt-2 text-sm text-slate-500">Ainda não disponível</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
