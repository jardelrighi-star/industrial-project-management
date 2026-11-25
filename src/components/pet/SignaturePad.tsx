"use client";

import { useRef, useState, type PointerEvent } from "react";
import { maxSignaturePoints, type Point, type Strokes } from "../../lib/pet/documents";

export function SignatureLines({ strokes }: { strokes: Strokes }) {
  return strokes.map((stroke, index) => <polyline key={index}
    points={stroke.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="currentColor"
    strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />);
}

export default function SignaturePad({ label, strokes, onChange }: {
  label: string;
  strokes: Strokes;
  onChange: (strokes: Strokes) => void;
}) {
  const active = useRef<{ pointer: number; points: Point[] } | null>(null);
  const [current, setCurrent] = useState<Point[]>([]);
  const count = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  const full = count + current.length >= maxSignaturePoints || strokes.length >= 100;

  function point(event: PointerEvent<SVGSVGElement>): Point {
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    const scale = (value: number, size: number) => Math.round(1000 * Math.max(0, Math.min(1, value / size)));
    return [scale(event.clientX - left, width), scale(event.clientY - top, height)];
  }

  function append(event: PointerEvent<SVGSVGElement>) {
    const drawing = active.current;
    if (!drawing || drawing.pointer !== event.pointerId || count + drawing.points.length >= maxSignaturePoints) return;
    const next = point(event);
    const previous = drawing.points.at(-1);
    if (previous && previous[0] === next[0] && previous[1] === next[1]) return;
    drawing.points.push(next);
    setCurrent([...drawing.points]);
  }

  function finish(event: PointerEvent<SVGSVGElement>, save: boolean) {
    const drawing = active.current;
    if (!drawing || drawing.pointer !== event.pointerId) return;
    if (save) append(event);
    active.current = null;
    setCurrent([]);
    if (save && drawing.points.length > 1) onChange([...strokes, drawing.points]);
  }

  return <div className="space-y-2">
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label={`Área para assinatura de ${label}`}
      className="h-36 w-full touch-none select-none rounded-lg border border-dashed border-slate-400 bg-white text-slate-950"
      onPointerDown={(event) => {
        if (active.current || full || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const points = [point(event)];
        active.current = { pointer: event.pointerId, points };
        setCurrent(points);
      }}
      onPointerMove={append}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onLostPointerCapture={(event) => finish(event, false)}>
      <SignatureLines strokes={current.length ? [...strokes, current] : strokes} />
    </svg>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-slate-600">{strokes.length ? "Assinatura capturada" : "Assine com o dedo ou mouse"}</span>
      <button type="button" disabled={!strokes.length && !current.length}
        onClick={() => { active.current = null; setCurrent([]); onChange([]); }}
        className="min-h-11 rounded-lg border px-3 disabled:opacity-50">Limpar assinatura</button>
    </div>
    {full && <p className="text-sm text-slate-600">Limite de traços atingido. Limpe a assinatura para refazê-la.</p>}
  </div>;
}
