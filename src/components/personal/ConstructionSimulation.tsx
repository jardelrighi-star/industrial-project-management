"use client";

import { useState } from "react";

const controls = [
  { label: "Orçamento base da obra", min: 500_000, max: 1_500_000, step: 1_000, initial: 1_000_000 },
  { label: "Contingência para imprevistos", min: 0, max: 25, step: 1, initial: 10, percent: true },
  { label: "Recursos a acumular", min: 0, max: 200_000, step: 1_000, initial: 112_000 },
  { label: "Financiamento", min: 0, max: 800_000, step: 1_000, initial: 500_000 },
  { label: "Reserva de emergência separada", min: 0, max: 150_000, step: 1_000, initial: 50_000 },
] as const;

const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const exactReais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function ConstructionSimulation() {
  const [values, setValues] = useState<number[]>(() => controls.map((control) => control.initial));
  const [ownFunds, setOwnFunds] = useState("");
  const [base, contingency, savings, financing, reserve] = values;
  const cash = Math.max(0, Number(ownFunds) || 0);
  const available = cash + savings + financing - reserve;
  const multiplier = 1 + contingency / 100;
  const cost = base * multiplier;
  const balance = available - cost;
  const results = [
    ["Verba disponível", available],
    ["Custo com contingência", cost],
    [balance < 0 ? "Déficit de recursos" : "Superávit de recursos", balance],
    ["Orçamento base máximo", Math.max(0, available / multiplier)],
  ] as const;

  return <section aria-labelledby="personal-heading" className="space-y-4">
    <h1 id="personal-heading" className="text-2xl font-bold">Pessoal</h1>
    <div className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-4 font-semibold text-slate-950">Viabilidade financeira da construção</h2>
      <div className="space-y-3">
        {controls.map((control, index) => {
          const display = "percent" in control ? `${values[index]}%` : reais.format(values[index]);
          return <div key={control.label}>
            <div className="flex items-start justify-between gap-3 text-sm">
              <label htmlFor={`construction-range-${index}`} className="font-medium text-slate-700">{control.label}</label>
              <output className="shrink-0 font-semibold tabular-nums text-slate-950">{display}</output>
            </div>
            <input id={`construction-range-${index}`} type="range" min={control.min} max={control.max} step={control.step}
              value={values[index]} aria-valuetext={display}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                setValues((previous) => previous.map((current, position) => position === index ? value : current));
              }}
              className="mt-1 h-11 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-2 focus-visible:outline-blue-700
                [&::-webkit-slider-runnable-track]:h-6 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-100
                [&::-webkit-slider-thumb]:mt-0.5 [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-slate-300 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm
                [&::-moz-range-track]:h-6 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-slate-100
                [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-slate-300 [&::-moz-range-thumb]:bg-white" />
          </div>;
        })}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-slate-200 pt-4" aria-live="polite">
        {results.map(([label, amount], index) => <div key={index} className="min-w-0">
          <dt className="text-sm text-slate-600">{label}</dt>
          <dd className={`mt-1 text-lg font-semibold wrap-anywhere tabular-nums ${index === 2 && amount < 0 ? "text-red-700" : "text-slate-950"}`}>{reais.format(amount)}</dd>
        </div>)}
      </dl>
      <label htmlFor="construction-own-funds" className="mt-4 block text-sm font-medium text-slate-700">Recursos da venda e do FGTS (R$)</label>
      <input id="construction-own-funds" type="number" inputMode="decimal" min="0" step="0.01" value={ownFunds}
        onChange={(event) => setOwnFunds(event.currentTarget.value)}
        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base sm:w-56" />
      <p className="mt-2 text-sm text-slate-600">Considera {exactReais.format(cash)} da venda e do FGTS. Não considera rendimentos financeiros.</p>
    </div>
  </section>;
}
