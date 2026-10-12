import { applyFacts, runEnrich, type CallResult } from "@/lib/enrich/engine";
import { resolveTargets } from "@/lib/enrich/targets";
import { ENRICH } from "@/lib/enrich/providers";
import { EnrichTargetSchema } from "@/lib/schemas";
import { bad, enrichEnabled, json, rateLimited, readPrices, runnerForRequest, serverCapMicros, serverMaxPeople, sessionOr401 } from "@/lib/server";

export const maxDuration = 300;

/**
 * Runs a paid lookup. The people and the price are worked out here, and the cap comes from the server's environment:
 * the body can say who and what, never how much. Needs LOOOT_NETWORK_ENRICH=1 and a LOOOT_TOKEN, except in the demo.
 */
export async function POST(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const slow = rateLimited("enrich", session);
  if (slow) return slow;
  if (!enrichEnabled()) return bad("Enrichment is off. Set LOOOT_NETWORK_ENRICH=1 and LOOOT_TOKEN on the server to turn it on.", 409, "enrich_off");
  const body = EnrichTargetSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("Pick people and at least one lookup.");
  const { store } = session;
  const { people, truncated } = await resolveTargets(store, body.data, serverMaxPeople());
  if (truncated) return bad(`One run covers at most ${serverMaxPeople()} people. Narrow the search.`, 422, "too_many_people");
  const price = await readPrices();
  const runner = runnerForRequest();
  if (!store.demo) await store.budget.reconcile(runner as { getRun(id: string): Promise<{ status: string }> }).catch(() => {});
  const byId = new Map(people.map((p) => [p.id, p]));
  const apply = async (r: CallResult) => {
    const at = new Date().toISOString();
    for (const id of r.need.personIds) {
      const p = byId.get(id);
      if (!p) continue;
      const patch = applyFacts(p, r, at);
      if (patch) Object.assign(p, patch);
      await store.recordEnrichment(
        { person_id: id, kind: r.need.kind, idempotency_key: r.need.key, endpoint_id: ENRICH[r.need.kind].endpointId, looot_run_id: r.runId ?? null, status: r.status === "ok" ? "ok" : r.status === "pending" ? "pending" : r.status.startsWith("skipped") ? "skipped" : "failed", list_price_micros: r.listPriceMicros, cost_micros: id === r.need.personIds[0] ? r.costMicros : 0, message: r.message ?? null },
        patch,
      );
    }
  };
  const summary = await runEnrich({ people, kinds: body.data.kinds, looot: runner, prices: price.prices, priceSource: price.source, unpriced: price.unread, capMicros: serverCapMicros(), ledger: store.budget, demo: store.demo, apply });
  return json({
    demo: summary.demo,
    capMicros: summary.capMicros,
    quotedMicros: summary.quotedMicros,
    spentMicros: summary.spentMicros,
    counts: summary.counts,
    budgetMessage: summary.budgetMessage,
    aborted: summary.aborted,
    calls: summary.results.map((r) => ({ kind: r.need.kind, people: r.need.personIds.length, status: r.status, costMicros: r.costMicros, message: r.message ?? null })),
    budget: await store.budget.status(),
  });
}
