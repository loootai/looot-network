import { json, sessionOr401 } from "@/lib/server";

export async function GET(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const q = new URL(request.url).searchParams.get("q");
  return json({ companies: await session.store.companies(q) });
}
