/** Public reader messages are authored; technical exceptions stay in cause and development logs. */
export class PortfolioWorkbookReadError extends Error {}

export const PORTFOLIO_READ_FAILURE = "Não foi possível ler este arquivo Excel. Ele pode estar corrompido ou usar uma estrutura incompatível com o ExcelJS. Abra-o no Excel ou LibreOffice, salve uma nova cópia em .xlsx e tente novamente.";
