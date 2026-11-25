"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { onlinePost, onlineRequest } from "../../lib/online/client";
import { onlineMode } from "../../lib/online/state";
import { changePetDocuments, fieldVisible, maxPeople, PET_KEY, readPetDocuments, validateTopic,
  type Answer, type Answers, type PetDocument, type Signer } from "../../lib/pet/documents";
import { petTopics, type Field } from "../../lib/pet/form";
import { withStorageWriteLock } from "../../lib/storage-write-lock";
import SignaturePad, { SignatureLines } from "./SignaturePad";

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base";
const primaryClass = "min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const secondaryClass = "min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50";
const emptySigner: Signer = { name: "", strokes: [] };
const asSigner = (value?: Answer) => value && typeof value === "object" && !Array.isArray(value) ? value : emptySigner;
const showDate = (value: string) => value.split("-").reverse().join("/");

function SignerFields({ label, signer, company, onChange }: {
  label: string; signer: Signer; company?: boolean; onChange: (signer: Signer) => void;
}) {
  return <fieldset className="space-y-3 rounded-lg border bg-slate-50 p-3">
    <legend className="px-1 text-sm font-semibold">{label}</legend>
    {company && <label className="block text-sm">Empresa
      <input className={inputClass} maxLength={240} value={signer.company ?? ""} onChange={(event) => onChange({ ...signer, company: event.target.value })} />
    </label>}
    <label className="block text-sm">Nome
      <input className={inputClass} maxLength={240} value={signer.name} onChange={(event) => onChange({ ...signer, name: event.target.value })} />
    </label>
    <SignaturePad label={label} strokes={signer.strokes} onChange={(strokes) => onChange({ ...signer, strokes })} />
  </fieldset>;
}

function TopicField({ field, value, onChange }: { field: Field; value?: Answer; onChange: (value: Answer) => void }) {
  if (field.kind === "signature") {
    return <SignerFields label={field.required ? field.label : `${field.label} (opcional)`} signer={asSigner(value)} onChange={onChange} />;
  }
  if (field.kind === "people") {
    const people = (Array.isArray(value) ? value : []) as Signer[];
    return <div className="space-y-3">
      {people.map((person, index) => <div key={index} className="space-y-2">
        <SignerFields label={`${field.id === "workers" ? "Executante" : "Vigia"} ${index + 1}`} signer={person}
          company={field.id === "workers"} onChange={(changed) => onChange(people.map((entry, at) => index === at ? changed : entry))} />
        <button type="button" className={secondaryClass} onClick={() => onChange(people.filter((_, at) => index !== at))}>Remover participante {index + 1}</button>
      </div>)}
      <button type="button" className={secondaryClass} disabled={people.length >= maxPeople}
        onClick={() => onChange([...people, emptySigner])}>{field.id === "workers" ? "Adicionar executante" : "Adicionar vigia"}</button>
    </div>;
  }
  if (field.kind === "choice" || field.kind === "checks") {
    const choices = Array.isArray(value) ? value as string[] : [];
    return <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium">{field.label}</legend>
      <div className="flex flex-wrap gap-2">
        {field.options?.map((option) => {
          const checkbox = field.kind === "checks";
          return <label key={option} className="flex min-h-11 items-center gap-2 rounded-lg border bg-white px-3 text-sm has-checked:border-blue-700 has-checked:bg-blue-50">
            <input type={checkbox ? "checkbox" : "radio"} name={field.id} value={option}
              checked={checkbox ? choices.includes(option) : value === option}
              onChange={() => onChange(checkbox
                ? choices.includes(option) ? choices.filter((item) => item !== option) : [...choices, option]
                : option)} />
            {option}
          </label>;
        })}
      </div>
    </fieldset>;
  }
  const text = typeof value === "string" ? value : "";
  return <label className="block text-sm font-medium">{field.label}
    {field.kind === "textarea"
      ? <textarea className={inputClass} value={text} rows={4} maxLength={6000} onChange={(event) => onChange(event.target.value)} />
      : <input className={inputClass} type={field.kind} value={text} maxLength={240}
        min={field.kind === "number" ? 1 : undefined} max={field.kind === "number" ? maxPeople : undefined}
        onChange={(event) => onChange(event.target.value)} />}
  </label>;
}

function ReadAnswer({ value, field }: { value: Answer; field: Field }) {
  if (typeof value === "string") return <span className="whitespace-pre-wrap wrap-anywhere">{field.kind === "date" ? showDate(value) : value}</span>;
  if (field.kind === "checks") return (value as string[]).join(", ");
  const people = Array.isArray(value) ? value as Signer[] : [value];
  return <div className="grid gap-3 sm:grid-cols-2">{people.map((person, index) => <div key={index} className="rounded-lg border p-2">
    <p className="font-medium wrap-anywhere">{person.name}{person.company ? ` · ${person.company}` : ""}</p>
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label={`Assinatura de ${person.name}`} className="h-20 w-full">
      <SignatureLines strokes={person.strokes} />
    </svg>
  </div>)}</div>;
}

export default function PetSection() {
  const [documents, setDocuments] = useState<PetDocument[]>();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; step: number; answers: Answers } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const errorAlert = useRef<HTMLDivElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const currentStep = draft?.step;

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => onlineMode ? onlineRequest<PetDocument[]>("/api/pet") : readPetDocuments(localStorage.getItem(PET_KEY)))
      .then((saved) => { if (active) setDocuments(saved); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar as PETs."); });
    return () => { active = false; };
  }, [loadAttempt]);

  useEffect(() => {
    if (currentStep) stepHeading.current?.focus();
  }, [currentStep]);

  useEffect(() => {
    if (error) errorAlert.current?.focus();
  }, [error]);

  const current = documents?.find((document) => document.id === selected);
  const draftAnswers = draft ? { ...current?.opening, ...draft.answers } : {};
  const topic = currentStep ? petTopics[currentStep] : undefined;
  const fields = topic?.fields.filter((field) => fieldVisible(field, draftAnswers)) ?? [];

  function start(step: number) {
    setError("");
    if (step === 1) setSelected(null);
    setDraft({ id: step === 1 ? crypto.randomUUID() : current!.id, step, answers: {} });
  }

  function leaveDraft() {
    if (draft && Object.keys(draft.answers).length && !window.confirm("Sair e descartar o preenchimento desta etapa?")) return;
    setDraft(null);
    setError("");
  }

  async function advance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    setError("");
    try {
      validateTopic(draft.step, draftAnswers);
      if (draft.step !== 13 && draft.step !== 16) {
        setDraft({ ...draft, step: draft.step + 1 });
        return;
      }
      setBusy(true);
      const request = { action: draft.step === 13 ? "create" : "close", id: draft.id, answers: draft.answers };
      const saved = onlineMode ? await onlinePost<PetDocument[]>("/api/pet", request) : await withStorageWriteLock(async () => {
        const next = changePetDocuments(readPetDocuments(localStorage.getItem(PET_KEY)), request, "local", true);
        localStorage.setItem(PET_KEY, JSON.stringify(next));
        return next;
      });
      setDocuments(saved);
      setSelected(draft.id);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a PET.");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="pet-heading" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 id="pet-heading" className="text-2xl font-bold">PET</h1><p className="text-sm text-slate-600">Permissão de Entrada e Trabalho</p></div>
      {!draft && !current && documents && <button type="button" className={primaryClass} onClick={() => start(1)}>Nova PET</button>}
    </header>
    {!documents && !error && <p role="status">Carregando PETs…</p>}
    {error && <div role="alert" tabIndex={-1} ref={errorAlert} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {error}
      {!documents && <button type="button" className="ml-2 underline" onClick={() => { setError(""); setLoadAttempt((value) => value + 1); }}>Tentar novamente</button>}
    </div>}
    {draft && topic && <form onSubmit={(event) => { void advance(event); }} noValidate className="space-y-4 rounded-xl border bg-white p-4 sm:p-6">
      <h2 tabIndex={-1} ref={stepHeading} className="text-lg font-semibold text-blue-900">{draft.step}. {topic.title}</h2>
      <progress className="h-2 w-full accent-blue-700" aria-label="Progresso da PET"
        max={draft.step <= 13 ? 13 : 3} value={draft.step <= 13 ? draft.step : draft.step - 13} />
      {topic.statement && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-950">{topic.statement}</p>}
      {fields.length === 0 && <p className="text-sm text-slate-600">Este tópico não se aplica à atividade selecionada.</p>}
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => <div key={field.id} className={["textarea", "signature", "people"].includes(field.kind) ? "sm:col-span-2" : "min-w-0"}>
          <TopicField field={field} value={draft.answers[field.id]}
            onChange={(value) => setDraft((previous) => previous && ({ ...previous, answers: { ...previous.answers, [field.id]: value } }))} />
        </div>)}
      </fieldset>
      <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
        <button type="button" disabled={busy} className={secondaryClass} onClick={leaveDraft}>Sair</button>
        <div className="flex flex-wrap gap-2">
          {draft.step !== 1 && draft.step !== 14 && <button type="button" disabled={busy} className={secondaryClass}
            onClick={() => { setError(""); setDraft({ ...draft, step: draft.step - 1 }); }}>Voltar</button>}
          <button type="submit" disabled={busy} className={primaryClass}>
            {busy ? "Salvando…" : draft.step === 13 ? "Salvar PET" : draft.step === 16 ? "Salvar encerramento" : "Seguinte"}
          </button>
        </div>
      </div>
    </form>}
    {!draft && current && <section className="space-y-4 rounded-xl border bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={secondaryClass} onClick={() => setSelected(null)}>Voltar à lista</button>
        {!current.ending && <button type="button" className={primaryClass} onClick={() => start(14)}>Encerrar</button>}
      </div>
      <h2 className="text-xl font-semibold wrap-anywhere">PET {String(current.opening.number)}</h2>
      <p className="font-medium text-blue-900">{current.ending?.cancelled === "Sim" ? "Cancelada" : current.ending ? "Encerrada" : "Salva · aguardando encerramento"}</p>
      {Object.entries(petTopics).slice(0, current.ending ? 16 : 13).map(([step, section]) => <details key={step} className="rounded-lg border p-3">
        <summary className="cursor-pointer py-2 font-medium">{step}. {section.title}</summary>
        <dl className="space-y-3 py-2 text-sm">
          {section.statement && <div><dt className="sr-only">Declaração</dt><dd>{section.statement}</dd></div>}
          {section.fields.map((field) => {
            const value = (Number(step) <= 13 ? current.opening : current.ending)?.[field.id];
            return value === undefined ? null : <div key={field.id}>
              <dt className="text-slate-600">{field.label}</dt><dd className="mt-1"><ReadAnswer value={value} field={field} /></dd>
            </div>;
          })}
        </dl>
      </details>)}
    </section>}
    {!draft && !current && documents && <section aria-label="PETs salvas" className="rounded-xl border bg-white p-4">
      <h2 className="text-lg font-semibold">PETs salvas</h2>
      {!documents.length ? <p className="mt-2 text-sm text-slate-600">Nenhuma PET salva.</p> : <ul className="mt-2 divide-y">
        {[...documents].reverse().map((document) => <li key={document.id}>
          <button type="button" onClick={() => { setError(""); setSelected(document.id); }}
            className="flex min-h-11 w-full flex-wrap items-start justify-between gap-2 py-3 text-left">
            <span className="min-w-0">
              <span className="block font-semibold wrap-anywhere text-blue-800">PET {String(document.opening.number)}</span>
              <span className="block text-sm wrap-anywhere text-slate-600">{String(document.opening.location)}</span>
            </span>
            <span className="text-sm text-slate-600">{document.ending?.cancelled === "Sim" ? "Cancelada" : document.ending ? "Encerrada" : "Em aberto"}</span>
          </button>
        </li>)}
      </ul>}
    </section>}
  </section>;
}
