import type { StoragePort } from "../coordinated-storage";
import { withStorageWriteLock } from "../storage-write-lock";
import { orderRequisitionCodes } from "./calculations";
import { parseExcelDate } from "./import-values";
import type { FinanceData } from "./types";

export const SC_ORDER_FORECAST_KEY = "industrial-project-sc-order-forecasts:v1";
export type ScOrderForecast = { projectCode: string; scNumber: string; forecastDate: string };

export function scOrderKey(projectCode: string, scNumber: string) {
  return JSON.stringify([projectCode, scNumber]);
}

export function scsAwaitingOrders({ requisitions, orders }: Pick<FinanceData, "requisitions" | "orders">) {
  const orderedScs = new Set(orders.flatMap((order) => orderRequisitionCodes(order).map((code) => scOrderKey(order.projectCode, code))));
  return requisitions.filter((sc) => !sc.convertedOrderNumber && !orderedScs.has(scOrderKey(sc.projectCode, sc.code)));
}

function isForecast(input: unknown): input is ScOrderForecast {
  if (!input || typeof input !== "object") return false;
  const row = input as Partial<ScOrderForecast>;
  return typeof row.projectCode === "string" && !!row.projectCode.trim() &&
    typeof row.scNumber === "string" && !!row.scNumber.trim() &&
    typeof row.forecastDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.forecastDate);
}

export function loadScOrderForecasts(storage: StoragePort = window.localStorage): ScOrderForecast[] {
  const raw = storage.getItem(SC_ORDER_FORECAST_KEY);
  if (raw === null) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.every(isForecast) ||
    new Set(rows.map((row) => scOrderKey(row.projectCode, row.scNumber))).size !== rows.length) {
    throw new Error("As previsões de pedidos salvas são inválidas.");
  }
  return rows;
}

export function saveScOrderForecast(
  request: { projectCode: string; scNumber: string; forecastDate: string; expectedDate: string | null },
  storage: StoragePort = window.localStorage,
) {
  const { projectCode, scNumber, expectedDate } = request;
  const forecastDate = request.forecastDate ? parseExcelDate(request.forecastDate) : null;
  return withStorageWriteLock(async () => {
    const rows = loadScOrderForecasts(storage);
    const index = rows.findIndex((row) => row.projectCode === projectCode && row.scNumber === scNumber);
    if ((rows[index]?.forecastDate ?? null) !== expectedDate) {
      throw new Error("A previsão mudou. Reabra a seção Compras e tente novamente.");
    }
    if (forecastDate === null) {
      if (index !== -1) rows.splice(index, 1);
    } else {
      const forecast = { projectCode, scNumber, forecastDate };
      if (index === -1) rows.push(forecast);
      else rows[index] = forecast;
    }
    storage.setItem(SC_ORDER_FORECAST_KEY, JSON.stringify(rows));
    return rows;
  });
}
