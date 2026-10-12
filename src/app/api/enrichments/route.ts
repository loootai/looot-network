import { json, sessionOr401 } from "@/lib/server";

/** The latest paid calls, with what each cost. */
export async function GET() {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  return json({ enrichments: await session.store.listEnrichments(200) });
}
