import { EXPORT_COLUMNS, filtersFromParams } from "@/lib/search/params";
import { toCsv } from "@/lib/import/csv";
import { bad, NO_STORE, sessionOr401 } from "@/lib/server";
import { PeopleQuerySchema } from "@/lib/schemas";
import { EXPORT_LIMIT, specFrom } from "@/lib/search/spec";

/** The people a search matches, as CSV. Personal data: the answer is never cached. */
export async function GET(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const sp = new URL(request.url).searchParams;
  const parsed = PeopleQuerySchema.safeParse({ q: sp.get("q") ?? "", sort: sp.get("sort") ?? "name" });
  if (!parsed.success) return bad("The search is not valid.");
  const spec = specFrom(parsed.data.q, filtersFromParams(sp), { sort: parsed.data.sort, limit: EXPORT_LIMIT });
  const { people } = await session.store.search(spec);
  const csv = toCsv(people as unknown as Record<string, unknown>[], EXPORT_COLUMNS);
  return new Response(csv + "\n", { headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="network-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
