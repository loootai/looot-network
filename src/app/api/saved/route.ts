import { bad, json, sessionOr401 } from "@/lib/server";
import { SavedSchema } from "@/lib/schemas";

export async function GET() {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  return json({ saved: await session.store.listSaved() });
}

/** Saves a search under a name. The same name replaces the old one. */
export async function POST(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const body = SavedSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("Give the search a name.");
  return json({ saved: await session.store.addSaved(body.data.name, body.data.query) });
}
