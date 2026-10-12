import { buildQuote, skipText } from "@/lib/enrich/engine";
import { resolveTargets } from "@/lib/enrich/targets";
import { EnrichTargetSchema } from "@/lib/schemas";
import { bad, enrichEnabled, json, rateLimited, readPrices, serverCapMicros, serverMaxPeople, sessionOr401 } from "@/lib/server";

/** The list-price cost of a run, before any call. Spends nothing. The cap shown is the server's, not the caller's. */
export async function POST(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const slow = rateLimited("quote", session);
  if (slow) return slow;
  const body = EnrichTargetSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("Pick people and at least one lookup.");
  const max = serverMaxPeople();
  const [{ people, truncated }, price] = await Promise.all([resolveTargets(session.store, body.data, max), readPrices()]);
  const quote = buildQuote(people, body.data.kinds, price.prices, price.source);
  const budget = await session.store.budget.status();
  return json({
    ...quote,
    lines: quote.lines.map((l) => ({ ...l, skippedText: skipText(l.skipped) })),
    capMicros: serverCapMicros(),
    maxPeople: max,
    truncated,
    unread: price.unread,
    budget,
    enabled: enrichEnabled(),
    demo: session.store.demo,
  });
}
