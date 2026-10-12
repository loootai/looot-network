import { bad, json, sessionOr401 } from "@/lib/server";
import { BudgetSchema } from "@/lib/schemas";
import { toMicros } from "@/lib/money";

/** Used, held and left for today and this month. */
export async function GET() {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  return json(await session.store.budget.status());
}

/** The owner saves the daily and monthly budget. The per-run cap is not set here: it comes from the server's environment. */
export async function PUT(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  if (session.store.demo) return bad("The demo has no budget to change.", 409, "demo");
  const body = BudgetSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("Budgets must be positive dollar amounts.");
  try {
    await session.store.budget.setLimits({ dailyMicros: toMicros(body.data.dailyUsd), monthlyMicros: toMicros(body.data.monthlyUsd) });
  } catch (e) {
    return bad((e as Error).message, 422);
  }
  return json(await session.store.budget.status());
}
