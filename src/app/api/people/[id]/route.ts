import { bad, json, sessionOr401 } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

/** One person with the file rows behind them and the paid calls made for them. */
export async function GET(_request: Request, ctx: Ctx) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const { id } = await ctx.params;
  const detail = await session.store.getDetail(id);
  return detail ? json(detail) : bad("Not found.", 404, "not_found");
}

/** Removes one person and the file rows behind them. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const { id } = await ctx.params;
  return (await session.store.deletePerson(id)) ? json({ ok: true }) : bad("Not found.", 404, "not_found");
}
