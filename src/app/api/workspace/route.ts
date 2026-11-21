import { FINANCE_KEY } from "../../../lib/coordinated-storage";
import { PROCUREMENT_PLAN_KEY } from "../../../lib/projects/procurement-plan";
import { SC_ORDER_FORECAST_KEY } from "../../../lib/finance/sc-order-forecast";
import { commitWorkspace, loadWorkspace, OnlineError, onlineRoute, readRequest, requireMember, response } from "../../../lib/online/server";
import { changeProcurement, changeReviews, changeScOrderForecast, replaceWorkspace, scopeWorkspace } from "../../../lib/online/workspace";

export function GET() {
  return onlineRoute(async () => {
    const member = await requireMember();
    return response(await scopeWorkspace(member, await loadWorkspace(member.workspaceId)));
  });
}

export function POST(request: Request) {
  return onlineRoute(async () => {
    const member = await requireMember();
    const input = await readRequest(request);
    const current = await loadWorkspace(member.workspaceId);
    let payload = { ...current.payload };
    let result: Record<string, unknown> = {};
    try {
      switch (input.action) {
        case "replace":
          payload = await replaceWorkspace(member, current, input);
          break;
        case "procurement":
          result = await changeProcurement(member, payload, input);
          break;
        case "review":
          await changeReviews(member, payload, input);
          break;
        case "scOrderForecast":
          await changeScOrderForecast(member, payload, input);
          break;
        default:
          throw new OnlineError(400, "Operação desconhecida.");
      }
    } catch (error) {
      if (error instanceof OnlineError) throw error;
      if (error instanceof Error && error.constructor === Error) throw new OnlineError(422, error.message);
      throw new OnlineError(422, "Não foi possível validar os dados enviados.");
    }
    const scoped = input.action === "replace" ? null : await scopeWorkspace(member, { ...current, payload });
    await commitWorkspace(member.workspaceId, { version: current.version, payload });
    if (scoped) {
      const key = input.action === "review" ? FINANCE_KEY : input.action === "scOrderForecast" ? SC_ORDER_FORECAST_KEY : PROCUREMENT_PLAN_KEY;
      result.payload = { [key]: scoped.payload[key] };
    }
    return response(result);
  });
}
