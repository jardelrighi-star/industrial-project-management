"use client";

import type { PortfolioMappingModel } from "../../lib/projects/portfolio-mapping-models";

export default function PortfolioMappingTools({ models, selectedId, name, message, error, canSave, onSelect, onName, onSave, onDetect }: {
  models: readonly PortfolioMappingModel[]; selectedId: string; name: string; message: string; error: string; canSave: boolean;
  onSelect: (id: string) => void; onName: (name: string) => void; onSave: () => void; onDetect: () => void;
}) {
  return <div className="space-y-3 rounded-lg border bg-slate-50 p-4">
    <h3 className="font-semibold">Modelos de mapeamento</h3>
    <p className="text-xs text-slate-600">Os modelos usam os nomes dos cabeçalhos, mesmo quando as colunas mudam de posição. Salvar um modelo não importa projetos. A prévia e a confirmação continuam obrigatórias.</p>
    <label className="block text-sm">Modelo salvo
      <select value={selectedId} onChange={(event) => onSelect(event.target.value)} className="mt-1 block w-full rounded border p-2">
        <option value="">Reconhecimento automático / ajustes manuais</option>
        {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
    </label>
    <button type="button" onClick={onDetect} className="rounded border px-3 py-2 text-sm">Detectar automaticamente novamente</button>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1 text-sm">Nome do novo modelo
        <input value={name} maxLength={80} onChange={(event) => onName(event.target.value)} className="mt-1 block w-full rounded border p-2" placeholder="Ex.: Carteira CAPEX da unidade" />
      </label>
      <button type="button" disabled={!canSave || !name.trim()} onClick={onSave} className="rounded border bg-white px-3 py-2 text-sm disabled:opacity-40">Salvar modelo</button>
    </div>
    {!canSave && <p className="text-xs text-slate-500">Para salvar, mapeie os campos obrigatórios e use cabeçalhos textuais únicos.</p>}
    {message && <p role="status" className="text-sm text-blue-900">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
  </div>;
}
