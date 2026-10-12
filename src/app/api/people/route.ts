import { bad, json, sessionOr401 } from "@/lib/server";
import { PeopleQuerySchema } from "@/lib/schemas";
import { filtersFromParams } from "@/lib/search/params";
import { specFrom } from "@/lib/search/spec";

/** Search the network. The text is read by the rule-based parser, the control filters narrow it. */
export async function GET(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const sp = new URL(request.url).searchParams;
  const parsed = PeopleQuerySchema.safeParse(Object.fromEntries(sp));
  if (!parsed.success) return bad("The search is not valid.");
  const spec = specFrom(parsed.data.q, filtersFromParams(sp), parsed.data);
  const { people, total } = await session.store.search(spec);
  return json({ people, total, explain: spec.explain, limit: spec.limit, offset: spec.offset });
}
