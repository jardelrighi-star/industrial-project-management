import { PortfolioWorkbookReadError } from "../../lib/projects/portfolio-workbook";

export type PortfolioPanelState = { open: boolean; selectedFile: File | null; error: string; notice: string };
export const initialPortfolioPanelState: PortfolioPanelState = { open: false, selectedFile: null, error: "", notice: "" };
export type PortfolioPanelAction =
  | { type: "toggle" }
  | { type: "select"; file: File }
  | { type: "error" | "notice"; message: string };

/** Opening/closing is a local state transition: it never starts an Excel read or drops the chosen file. */
export function portfolioPanelReducer(state: PortfolioPanelState, action: PortfolioPanelAction): PortfolioPanelState {
  if (action.type === "toggle") return { ...state, open: !state.open, error: "", notice: "" };
  if (action.type === "select") return { ...state, selectedFile: action.file, error: "", notice: "" };
  return { ...state, [action.type]: action.message };
}

export function portfolioSelectionError(cause: unknown): string {
  if (cause instanceof PortfolioWorkbookReadError) return cause.message;
  if (process.env.NODE_ENV === "development") console.error("[Carteira de Projetos] Falha ao acessar o arquivo selecionado", cause);
  return "Não foi possível acessar o arquivo selecionado. Ele foi mantido para uma nova tentativa. Tente novamente ou escolha outra cópia em formato .xlsx.";
}
