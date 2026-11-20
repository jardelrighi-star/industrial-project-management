import type { FinanceRepository } from "./repository";
import type { ActualCost, ActualCostReview, ActualCostReviewAction, ActualCostReviewSnapshot, FinanceData } from "./types";

export function actualCostReviewIdentity(cost: ActualCost): string | null {
  const source = cost.sankhya;
  if (cost.traceability.sourceSystem !== "Sankhya" || !source ||
    ![source.companyCode, source.internalNoteId, source.productCode, source.costCenterCode].every((id) => id && !/^0+$/.test(id))) return null;
  return JSON.stringify([source.companyCode, source.internalNoteId, source.productCode, source.costCenterCode]);
}

function snapshot(cost: ActualCost): ActualCostReviewSnapshot {
  return {
    revision: JSON.stringify([
      cost.projectCode, cost.fiscalDocument, cost.date, cost.amount, cost.supplier, cost.description ?? "",
      cost.assetDescription ?? "", cost.sankhya?.identification ?? "", cost.sankhya?.operationCode ?? "",
      cost.sankhya?.partnerCode ?? "",
    ]),
    projectCode: cost.projectCode,
    fiscalDocument: cost.fiscalDocument,
    amount: cost.amount,
    description: [cost.description, cost.assetDescription].filter(Boolean).join(" · "),
    supplier: cost.supplier,
    internalNoteId: cost.sankhya?.internalNoteId,
  };
}

export function indexActualCostReviews(data: FinanceData) {
  const costs = new Map<string, ActualCost[]>();
  const reviews = new Map((data.actualCostReviews ?? []).map((review) => [review.identity, review]));
  for (const cost of data.actualCosts) {
    const identity = actualCostReviewIdentity(cost);
    if (!identity) continue;
    const group = costs.get(identity) ?? [];
    group.push(cost);
    costs.set(identity, group);
  }
  const identityByCost = new Map<ActualCost, string>();
  for (const [identity, group] of [...costs]) {
    for (const cost of group) {
      // Within a repeated ERP key, reviews can follow only the exact exported version.
      const versionIdentity = JSON.stringify([identity, snapshot(cost).revision]);
      if (group.length === 1 && !reviews.has(versionIdentity)) {
        identityByCost.set(cost, identity);
      } else {
        identityByCost.set(cost, versionIdentity);
        const matches = costs.get(versionIdentity) ?? [];
        matches.push(cost);
        costs.set(versionIdentity, matches);
      }
    }
  }
  return { costs, reviews, identityByCost };
}

export function evaluateActualCost(cost: ActualCost, index: ReturnType<typeof indexActualCostReviews>) {
  const identity = index.identityByCost.get(cost);
  if (cost.reviewUnavailable) return { status: "unavailable", reason: "duplicate" } as const;
  if (!identity || index.costs.get(identity)?.length !== 1) {
    return { status: "unavailable", reason: identity ? "duplicate" : "missing" } as const;
  }
  const review = index.reviews.get(identity);
  const last = review?.events.at(-1);
  const current = snapshot(cost);
  const status = last?.action === "rejected" ? "rejected" : !last ? "pending" :
    last.action === "returned" || review?.requiresReview || last.cost.revision !== current.revision ? "review_again" : last.action;
  return { status, identity, review, current } as const;
}

export function rejectedActualCosts(index: ReturnType<typeof indexActualCostReviews>) {
  return [...index.reviews.values()].flatMap((review) => {
    const rejection = review.events.at(-1);
    if (rejection?.action !== "rejected") return [];
    const matches = index.costs.get(review.identity) ?? [];
    return [{ review, rejection, current: matches.length === 1 ? snapshot(matches[0]) : null, ambiguous: matches.length > 1 }];
  }).reverse();
}

/** Once the imported record has changed or vanished, only a fresh decision recognizes it again. */
export function reconcileActualCostReviews(data: FinanceData): FinanceData {
  if (!data.actualCostReviews?.length) return data;
  const { costs } = indexActualCostReviews(data);
  return {
    ...data,
    actualCostReviews: data.actualCostReviews.map((review) => {
      const last = review.events.at(-1);
      if (review.requiresReview || !last || last.action === "rejected" || last.action === "returned") return review;
      const matches = costs.get(review.identity);
      if (matches?.length === 1 && snapshot(matches[0]).revision === last.cost.revision) return review;
      return { ...review, requiresReview: true };
    }),
  };
}

export type ActualCostReviewTarget = { identity: string; expectedEvents: number; expectedRevision: string | null };

type ActualCostReviewDecision = { action: ActualCostReviewAction; actor: string; note: string; actorId?: string };

function nextActualCostReview(
  { costs, reviews }: ReturnType<typeof indexActualCostReviews>,
  target: ActualCostReviewTarget, decision: ActualCostReviewDecision, at: string,
): ActualCostReview {
  const review = reviews.get(target.identity);
  const events = review?.events ?? [];
  const last = events.at(-1);
  const matches = costs.get(target.identity) ?? [];
  const current = matches.length === 1 ? snapshot(matches[0]) : null;
  if (events.length !== target.expectedEvents || (current?.revision ?? null) !== target.expectedRevision) {
    throw new Error("O lançamento ou a revisão mudou. Atualize a tela antes de tentar novamente.");
  }
  const analystDecision = decision.action === "analyst_validated" || decision.action === "analyst_rejected";
  const finalDecision = last?.action === "analyst_validated" || last?.action === "analyst_rejected";
  const finalForCurrent = finalDecision && !review?.requiresReview && current?.revision === last.cost.revision;
  if (analystDecision ? last?.action !== "rejected" || matches.length > 1 || (decision.action === "analyst_validated" && !current) :
    !current || last?.action === "rejected" || finalForCurrent) {
    throw new Error("Esta ação não está disponível para o lançamento.");
  }
  // The analyst's decision addresses the version originally contested by the manager.
  const auditedCost = analystDecision ? last!.cost : current!;
  return {
    identity: target.identity,
    events: [...events, { ...decision, at, cost: auditedCost }],
  };
}

export async function recordActualCostReviews(
  repository: FinanceRepository,
  targets: readonly ActualCostReviewTarget[],
  request: ActualCostReviewDecision,
): Promise<FinanceData> {
  const actor = request.actor.trim();
  const note = request.note.trim();
  if (!targets.length || new Set(targets.map((target) => target.identity)).size !== targets.length) {
    throw new Error("Selecione pelo menos um lançamento válido.");
  }
  if (!actor) throw new Error("Informe seu nome.");
  if ((request.action === "rejected" || request.action === "analyst_validated") && !note) throw new Error("Informe o motivo da decisão.");
  const data = await repository.load();
  const index = indexActualCostReviews(data);
  const at = new Date().toISOString();
  const decision = { action: request.action, actor, note, ...(request.actorId ? { actorId: request.actorId } : {}) };
  const updates = targets.map((target) => nextActualCostReview(index, target, decision, at));
  for (const review of updates) index.reviews.set(review.identity, review);
  const next = { ...data, actualCostReviews: [...index.reviews.values()] };
  if (repository.saveIfCurrent) await repository.saveIfCurrent(next, data);
  else await repository.save(next);
  return next;
}

export function recordActualCostReview(repository: FinanceRepository, request: ActualCostReviewTarget & ActualCostReviewDecision) {
  return recordActualCostReviews(repository, [request], request);
}
