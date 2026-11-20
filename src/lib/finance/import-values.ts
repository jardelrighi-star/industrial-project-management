/** Parse decimal BRL exactly, rounding half away from zero to integer cents. */
export function parseBrlCents(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("Valor monetário ausente ou inválido");
  let decimal = String(value).trim().replace(/^R\$\s*/, "");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Valor monetário inválido");
    decimal = value.toFixed(8);
  } else if (decimal.includes(",")) {
    if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(decimal)) throw new Error("Formato monetário inválido");
    decimal = decimal.replaceAll(".", "").replace(",", ".");
  } else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(decimal)) {
    decimal = decimal.replaceAll(".", "");
  }
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match) throw new Error("Formato monetário inválido");
  const fraction = (match[3] ?? "").padEnd(3, "0");
  const cents = BigInt(match[2]) * BigInt(100) + BigInt(fraction.slice(0, 2)) + BigInt(Number(fraction[2]) >= 5 ? 1 : 0);
  const result = Number(match[1] === "-" ? -cents : cents);
  if (!Number.isSafeInteger(result)) throw new Error("Valor monetário fora do limite suportado");
  return result;
}

/** Excel's fictitious 1900-02-29 (serial 60) is rejected; fractions represent time. */
export function parseExcelDate(value: unknown, date1904 = false): string {
  let result: string;
  if (typeof value === "number") {
    const days = Math.floor(value);
    if (!Number.isFinite(value) || days < (date1904 ? 0 : 1) || (!date1904 && days === 60)) throw new Error("Data serial do Excel inválida");
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const date = new Date(epoch + (days - (!date1904 && days > 60 ? 1 : 0)) * 86400000);
    if (!Number.isFinite(date.getTime())) throw new Error("Data serial fora do limite");
    result = date.toISOString().slice(0, 10);
  } else if (value instanceof Date && Number.isFinite(value.getTime())) {
    result = value.toISOString().slice(0, 10);
  } else if (typeof value === "string") {
    const input = value.trim();
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
    result = br ? `${br[3]}-${br[2]}-${br[1]}` : input;
  } else throw new Error("Data ausente ou inválida");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) throw new Error("Data inválida");
  return result;
}
