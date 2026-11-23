import type { SankhyaReportFields } from "../../lib/finance/sankhya-report-fields";

export default function SankhyaReportDetails({ fields }: { fields?: SankhyaReportFields }) {
  if (!fields || !Object.keys(fields).length) return null;
  return <details className="mt-2 text-xs text-slate-600">
    <summary className="cursor-pointer font-medium text-blue-800">Detalhes do Sankhya</summary>
    <dl className="mt-2 space-y-1">
      {Object.entries(fields).map(([label, values]) => <div key={label}>
        <dt className="font-medium">{label}</dt>
        <dd className="whitespace-pre-wrap break-words">{values.join(" · ")}</dd>
      </div>)}
    </dl>
  </details>;
}
