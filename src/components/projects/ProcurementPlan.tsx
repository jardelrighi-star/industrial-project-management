"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { orderRequisitionCodes } from "../../lib/finance/calculations";
import { loadScOrderForecasts, scOrderKey, type ScOrderForecast } from "../../lib/finance/sc-order-forecast";
import type { PurchaseOrder, PurchaseRequisition } from "../../lib/finance/types";
import { projectCalendarDate } from "../../lib/projects/project-date";
import { onlineMode } from "../../lib/online/state";
import { readOnlineStorage } from "../../lib/online/client";
import { changeOnlineProcurement } from "../../lib/online/operations";
import {
  addPlannedPurchase, addProcurementType, deletePlannedPurchase, isScOpeningOverdue, loadProcurementPlan,
  updatePlannedPurchase, type PlannedPurchase,
} from "../../lib/projects/procurement-plan";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const fieldClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const missingScMessage = "SC ausente das listas de solicitações e pedidos do projeto.";

function ForecastDate({ date }: { date?: string }) {
  return date ? <time dateTime={date}>{date.split("-").reverse().join("/")}</time> : "—";
}

function OpeningForecast({ date, overdue }: { date?: string; overdue: boolean }) {
  if (!date) return "—";
  return <div className="flex flex-wrap items-center gap-2">
    <ForecastDate date={date} />
    {overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Atrasada</span>}
  </div>;
}

export default function ProcurementPlan({ projectCode, budgetCents, requisitions, orders, canManage = true }: {
  projectCode: string;
  budgetCents?: number | null;
  requisitions?: readonly PurchaseRequisition[];
  orders?: readonly PurchaseOrder[];
  canManage?: boolean;
}) {
  const [plan, setPlan] = useState<ReturnType<typeof loadProcurementPlan> | null>(null);
  const [orderForecasts, setOrderForecasts] = useState<ScOrderForecast[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<PlannedPurchase | null>(null);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<PlannedPurchase | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("");
  const [estimatedAmount, setEstimatedAmount] = useState("");
  const [scNumber, setScNumber] = useState("");
  const [scOpeningForecast, setScOpeningForecast] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState("");
  const [busy, setBusy] = useState<"purchase" | "type" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      const storage = onlineMode ? await readOnlineStorage() : undefined;
      const savedPlan = loadProcurementPlan(storage);
      const savedForecasts = loadScOrderForecasts(storage);
      if (active) {
        setPlan(savedPlan);
        setOrderForecasts(savedForecasts);
      }
    }).catch(() => {
      if (active) setError("Não foi possível carregar o plano de aquisições salvo.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const dialog = detailsDialog.current;
    if (viewing && dialog && !dialog.open) dialog.showModal();
  }, [viewing]);

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setTitle("");
    setDescription("");
    setType("");
    setEstimatedAmount("");
    setScNumber("");
    setScOpeningForecast("");
    setOrderNumber("");
    setAddingType(false);
    setNewType("");
    setError("");
  }

  function openEdit(purchase: PlannedPurchase) {
    setEditing(purchase);
    setTitle(purchase.title ?? "");
    setDescription(purchase.description);
    setType(purchase.type);
    setEstimatedAmount(`${Math.floor(purchase.estimatedCents / 100)},${String(purchase.estimatedCents % 100).padStart(2, "0")}`);
    setScNumber(purchase.scNumber ?? "");
    setScOpeningForecast(purchase.scOpeningForecast ?? "");
    setOrderNumber(purchase.orderNumber ?? "");
    setNotice("");
    setError("");
    setFormOpen(true);
  }

  async function saveType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("type");
    setError("");
    setNotice("");
    try {
      const saved = onlineMode ? await changeOnlineProcurement(projectCode, "addType", { name: newType }) : await addProcurementType(newType);
      setPlan(saved.plan);
      setType(saved.type ?? "");
      setNewType("");
      setAddingType(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível adicionar o tipo.");
    } finally {
      setBusy(null);
    }
  }

  async function savePurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("purchase");
    setError("");
    setNotice("");
    try {
      const draft = { title, description, type, estimatedAmount, scNumber, scOpeningForecast, orderNumber };
      if (onlineMode) {
        const saved = await changeOnlineProcurement(projectCode, editing ? "update" : "create", { draft, id: editing?.id });
        setPlan(saved.plan);
      } else {
        setPlan(editing ? await updatePlannedPurchase(projectCode, editing.id, draft) : await addPlannedPurchase(projectCode, draft));
      }
      closeForm();
      setNotice(editing ? "Contratação atualizada." : "Contratação adicionada ao plano.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a contratação.");
    } finally {
      setBusy(null);
    }
  }

  async function removePurchase() {
    if (!editing || busy || !window.confirm(`Excluir a contratação “${editing.title || editing.description}” do plano?`)) return;
    setBusy("delete");
    setError("");
    setNotice("");
    try {
      setPlan(onlineMode
        ? (await changeOnlineProcurement(projectCode, "delete", { id: editing.id })).plan
        : await deletePlannedPurchase(projectCode, editing.id));
      closeForm();
      setNotice("Contratação excluída do plano.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a contratação.");
    } finally {
      setBusy(null);
    }
  }

  const purchases = plan?.purchases.filter((purchase) => purchase.projectCode === projectCode) ?? [];
  const estimatedTotal = purchases.reduce((total, purchase) => total + purchase.estimatedCents, 0);
  const validEstimatedTotal = Number.isSafeInteger(estimatedTotal);
  const budgetDifference = typeof budgetCents === "number" && validEstimatedTotal ? budgetCents - estimatedTotal : undefined;
  const plannedShare = typeof budgetCents === "number" && budgetCents > 0 && validEstimatedTotal ? estimatedTotal / budgetCents : undefined;
  const scCodes = requisitions && new Set(requisitions.filter((sc) => sc.projectCode === projectCode).map((sc) => sc.code));
  const balancesByOrder = new Map<string, number | null>();
  const ordersBySc = new Map<string, { order: PurchaseOrder; balance: number }[]>();
  for (const order of orders ?? []) {
    if (order.projectCode !== projectCode) continue;
    const numbers = new Set([order.number, order.sankhya?.internalOrderId]);
    for (const number of numbers) {
      if (number) balancesByOrder.set(number, balancesByOrder.has(number) ? null : order.openBalance);
    }
    const itemBalancesBySc = new Map<string, number>();
    for (const item of order.sankhya?.items ?? []) {
      if (!item.requisitionCode) continue;
      itemBalancesBySc.set(item.requisitionCode, (itemBalancesBySc.get(item.requisitionCode) ?? 0) + item.openBalance);
    }
    for (const code of orderRequisitionCodes(order)) {
      const matches = ordersBySc.get(code) ?? [];
      matches.push({ order, balance: itemBalancesBySc.get(code) ?? order.openBalance });
      ordersBySc.set(code, matches);
    }
  }

  const today = projectCalendarDate();
  function isMissingSc(number?: string) {
    const code = number?.trim();
    return Boolean(code && scCodes && orders && !scCodes.has(code) && !ordersBySc.has(code));
  }
  const missingCurrentSc = isMissingSc(scNumber);
  const missingViewedSc = isMissingSc(viewing?.scNumber);

  function orderDetails(number?: string, requisition?: string) {
    const linked = ordersBySc.get(requisition?.trim() ?? "");
    if (linked) {
      const numbers = linked.map(({ order }) => {
        const internalId = order.sankhya?.internalOrderId;
        return balancesByOrder.get(order.number) === null && internalId && internalId !== order.number
          ? `${order.number} (${internalId})` : order.number;
      });
      const balance = linked.reduce((total, match) => total + match.balance, 0);
      return { numbers: numbers.join(", "), amount: currency.format(balance / 100), issue: "", automatic: true };
    }
    const query = number?.trim();
    const balance = query ? balancesByOrder.get(query) : undefined;
    const issue = balance === null ? "Há mais de um pedido com esse número neste projeto. Informe o número único." :
      orders && query && balance === undefined ? "Pedido ainda não encontrado no Financeiro deste projeto." : "";
    return { numbers: query ?? "", amount: typeof balance === "number" ? currency.format(balance / 100) : "—", issue, automatic: false };
  }

  const currentOrder = orderDetails(orderNumber, scNumber);
  const viewedOrder = orderDetails(viewing?.orderNumber, viewing?.scNumber);
  const forecastDates = new Map(orderForecasts.map((row) => [scOrderKey(row.projectCode, row.scNumber), row.forecastDate]));
  const orderForecastDate = (number?: string) => number ? forecastDates.get(scOrderKey(projectCode, number.trim())) : undefined;

  return <section className="space-y-4" aria-labelledby="procurement-plan-heading">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="procurement-plan-heading" className="text-lg font-bold">Plano de aquisições</h2>
      {canManage && plan && !formOpen && <button type="button" onClick={() => { setNotice(""); setFormOpen(true); }}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">
        Nova contratação
      </button>}
    </header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
    {!plan ? (!error && <p role="status" className="text-sm text-slate-500">Carregando plano de aquisições…</p>) : <>
      <dl aria-label="Comparação entre o orçamento e o plano de aquisições" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <dt className="text-sm text-slate-500">Orçamento atualizado</dt>
          <dd className="mt-2 break-words text-lg font-semibold">
            {typeof budgetCents === "number" ? currency.format(budgetCents / 100) : budgetCents === null ? "Não cadastrado" : "Não disponível"}
          </dd>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <dt className="text-sm text-slate-500">Total estimado do plano</dt>
          <dd className="mt-2 break-words text-lg font-semibold">{validEstimatedTotal ? currency.format(estimatedTotal / 100) : "Não disponível"}</dd>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <dt className="text-sm text-slate-500">Percentual do orçamento</dt>
          <dd className={`mt-2 break-words text-lg font-semibold ${plannedShare !== undefined && plannedShare > 1 ? "text-red-700" : ""}`}>
            {plannedShare === undefined ? "Não disponível" : percent.format(plannedShare)}
          </dd>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <dt className="text-sm text-slate-500">Diferença para o orçamento</dt>
          <dd className={`mt-2 break-words text-lg font-semibold ${budgetDifference !== undefined && budgetDifference < 0 ? "text-red-700" : ""}`}>
            {budgetDifference !== undefined && Number.isSafeInteger(budgetDifference) ? currency.format(budgetDifference / 100) : "Não disponível"}
          </dd>
        </div>
      </dl>
      {formOpen && <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h3 className="font-semibold">{editing ? "Editar contratação" : "Nova contratação"}</h3>
        <form onSubmit={(event) => void savePurchase(event)} className="mt-4 space-y-4">
          <label className="block text-sm font-medium">Título breve
            <input value={title} onChange={(event) => setTitle(event.target.value)}
              required maxLength={120} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium">Descrição da contratação
            <textarea value={description} onChange={(event) => setDescription(event.target.value)}
              required rows={3} className={fieldClass} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Tipo de contratação
                <select required value={type} onChange={(event) => setType(event.target.value)} className={fieldClass}>
                  <option value="">Selecione um tipo</option>
                  {plan.types.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <button type="button" aria-expanded={addingType} disabled={busy !== null}
                onClick={() => setAddingType((visible) => !visible)} className="mt-2 text-sm font-medium text-blue-700 hover:underline">
                {addingType ? "Fechar cadastro de tipo" : "Adicionar tipo"}
              </button>
            </div>
            <label className="block text-sm font-medium">Valor estimado (R$)
              <input required inputMode="decimal" value={estimatedAmount} onChange={(event) => setEstimatedAmount(event.target.value)}
                placeholder="0,00" className={fieldClass} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="block text-sm font-medium">Previsão de abertura da SC
              <input type="date" value={scOpeningForecast} onChange={(event) => setScOpeningForecast(event.target.value)}
                className={fieldClass} />
            </label>
            <label className="block text-sm font-medium">Número da SC
              <input value={scNumber} onChange={(event) => setScNumber(event.target.value)}
                aria-describedby={missingCurrentSc ? "procurement-sc-unavailable" : undefined}
                className={`${fieldClass} ${missingCurrentSc ? "border-red-600! text-red-800" : ""}`} />
              {missingCurrentSc && <span id="procurement-sc-unavailable" className="sr-only">{missingScMessage}</span>}
            </label>
            <div className="text-sm">
              <span className="font-medium">Previsão de geração do pedido</span>
              <p className="mt-2 text-slate-700" aria-live="polite"><ForecastDate date={orderForecastDate(scNumber)} /></p>
            </div>
            <label className="block text-sm font-medium">Número do pedido
              <input value={currentOrder.automatic ? currentOrder.numbers : orderNumber} readOnly={currentOrder.automatic}
                onChange={(event) => setOrderNumber(event.target.value)}
                aria-describedby={currentOrder.issue ? "procurement-order-unavailable" : undefined}
                className={`${fieldClass} ${currentOrder.issue ? "border-red-600! text-red-800" : ""}`} />
              {currentOrder.issue && <span id="procurement-order-unavailable" className="sr-only">{currentOrder.issue}</span>}
              {currentOrder.automatic && <span className="mt-1 block text-xs text-slate-500">Vinculado automaticamente pela SC.</span>}
            </label>
            <div className="text-sm">
              <span className="font-medium">Saldo do pedido</span>
              <p className="mt-2 text-slate-700" aria-live="polite">{currentOrder.amount}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy !== null || addingType}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy === "purchase" ? "Salvando…" : editing ? "Salvar alterações" : "Adicionar contratação"}
            </button>
            <button type="button" onClick={closeForm} disabled={busy !== null}
              className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50">Cancelar</button>
            {editing && <button type="button" onClick={() => void removePurchase()} disabled={busy !== null}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50">
              {busy === "delete" ? "Excluindo…" : "Excluir"}
            </button>}
          </div>
        </form>
        {addingType && <form onSubmit={(event) => void saveType(event)} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border bg-slate-50 p-3">
          <label className="min-w-44 flex-1 text-sm font-medium">Nome do novo tipo
            <input required value={newType} onChange={(event) => setNewType(event.target.value)} className={fieldClass} />
          </label>
          <button type="submit" disabled={busy !== null} className="rounded-lg border bg-white px-3 py-2 text-sm font-medium text-blue-800 disabled:opacity-50">
            {busy === "type" ? "Salvando…" : "Salvar tipo"}
          </button>
        </form>}
      </div>}
      <div className="overflow-x-auto rounded-xl border bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold">Contratações planejadas</h3>
        {purchases.length === 0 ? <p className="text-sm text-slate-500">Nenhuma aquisição planejada para este projeto.</p> :
          <table aria-label="Contratações planejadas" className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50"><tr>
              <th scope="col" className="p-3">Título</th><th scope="col" className="p-3">Tipo</th>
              <th scope="col" className="p-3 text-right">Valor estimado</th>
              <th scope="col" className="p-3">Previsão de abertura da SC</th>
              <th scope="col" className="p-3">Número da SC</th>
              <th scope="col" className="p-3">Previsão de geração do pedido</th>
              <th scope="col" className="p-3">Número do pedido</th>
              <th scope="col" className="p-3 text-right">Saldo do pedido</th>
              <th scope="col" className="p-3 text-right">Ações</th>
            </tr></thead>
            <tbody>{purchases.map((purchase) => {
              const missing = isMissingSc(purchase.scNumber);
              const linkedOrder = orderDetails(purchase.orderNumber, purchase.scNumber);
              return <tr key={purchase.id} className="border-t [&_td]:p-3 [&_td]:align-top">
                <th scope="row" className="p-3 align-top font-medium break-words">{purchase.title || "Sem título"}</th>
                <td>{purchase.type}</td>
                <td className="whitespace-nowrap text-right">{currency.format(purchase.estimatedCents / 100)}</td>
                <td className="whitespace-nowrap"><OpeningForecast date={purchase.scOpeningForecast} overdue={isScOpeningOverdue(purchase, today, missing)} /></td>
                <td className={missing ? "font-medium text-red-800" : undefined}>
                  {purchase.scNumber || "—"}{missing && <span className="sr-only"> ({missingScMessage})</span>}
                </td>
                <td className="whitespace-nowrap"><ForecastDate date={orderForecastDate(purchase.scNumber)} /></td>
                <td className={linkedOrder.issue ? "font-medium text-red-800" : undefined}>
                  {linkedOrder.numbers || "—"}{linkedOrder.issue && <span className="sr-only"> ({linkedOrder.issue})</span>}
                </td>
                <td className="whitespace-nowrap text-right">{linkedOrder.amount}</td>
                <td className="text-right"><button type="button" disabled={formOpen} onClick={() => setViewing(purchase)}
                  aria-label={`Visualizar ${purchase.title || purchase.description}`}
                  className="font-medium text-blue-700 hover:underline disabled:opacity-50">Visualizar</button></td>
              </tr>;
            })}</tbody>
          </table>}
      </div>
    </>}
    {viewing && <dialog ref={detailsDialog} onClose={() => setViewing(null)} aria-labelledby="procurement-details-heading"
      className="m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border bg-white p-6 shadow-xl backdrop:bg-slate-950/60">
      <h3 id="procurement-details-heading" className="break-words text-lg font-bold">{viewing.title || "Contratação sem título"}</h3>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-slate-500">Descrição da contratação</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words">{viewing.description}</dd>
        </div>
        <div><dt className="text-slate-500">Tipo de contratação</dt><dd className="mt-1">{viewing.type}</dd></div>
        <div><dt className="text-slate-500">Valor estimado</dt><dd className="mt-1">{currency.format(viewing.estimatedCents / 100)}</dd></div>
        <div><dt className="text-slate-500">Previsão de abertura da SC</dt><dd className="mt-1"><OpeningForecast
          date={viewing.scOpeningForecast} overdue={isScOpeningOverdue(viewing, today, missingViewedSc)} /></dd></div>
        <div>
          <dt className="text-slate-500">Número da SC</dt>
          <dd className={missingViewedSc ? "mt-1 font-medium text-red-800" : "mt-1"}>
            {viewing.scNumber || "—"}{missingViewedSc && <span className="sr-only"> ({missingScMessage})</span>}
          </dd>
        </div>
        <div><dt className="text-slate-500">Previsão de geração do pedido</dt><dd className="mt-1">
          <ForecastDate date={orderForecastDate(viewing.scNumber)} /></dd></div>
        <div>
          <dt className="text-slate-500">Número do pedido</dt>
          <dd className={viewedOrder.issue ? "mt-1 font-medium text-red-800" : "mt-1"}>
            {viewedOrder.numbers || "—"}{viewedOrder.issue && <span className="sr-only"> ({viewedOrder.issue})</span>}
          </dd>
        </div>
        <div><dt className="text-slate-500">Saldo do pedido</dt><dd className="mt-1">{viewedOrder.amount}</dd></div>
      </dl>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={() => detailsDialog.current?.close()} className="rounded-lg border px-4 py-2 text-sm font-medium">Fechar</button>
        {canManage && <button type="button" onClick={() => { detailsDialog.current?.close(); openEdit(viewing); }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">Editar</button>}
      </div>
    </dialog>}
  </section>;
}
