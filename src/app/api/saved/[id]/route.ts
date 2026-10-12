import { bad, json, sessionOr401 } from "@/lib/server";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const { id } = await ctx.params;
  return (await session.store.removeSaved(id)) ? json({ ok: true }) : bad("Not found.", 404, "not_found");
}
