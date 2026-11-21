const calendar = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  calendar: "gregory",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function projectCalendarDate(now = new Date()): string {
  const { year, month, day } = Object.fromEntries(calendar.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${year}-${month}-${day}`;
}
