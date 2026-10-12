import { bad, json, rateLimited, sessionOr401 } from "@/lib/server";
import { GranolaApiError, DemoGranolaClient, granolaFromEnv, readGranola } from "@/lib/import/granola";
import { previewImport, runImport } from "@/lib/import/run";
import { GranolaImportSchema } from "@/lib/schemas";
import { IS_DEMO } from "@/lib/store";
import { seedDemo } from "@/demo/seed";

/**
 * Imports the people who attended your Granola meetings. The key comes from GRANOLA_API_KEY on the server and is
 * never read from the request. People go through the same dedupe and merge as a CSV. With dryRun nothing is written.
 */
export async function POST(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const limited = rateLimited("granola", session);
  if (limited) return limited;
  const body = GranolaImportSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return bad("The request is not valid.");
  const o = body.data;

  const known = IS_DEMO ? seedDemo().people.filter((p) => p.email).map((p) => ({ name: p.full_name, email: p.email! })) : [];
  const source = IS_DEMO ? new DemoGranolaClient(known) : granolaFromEnv();
  if (!source) return bad("Set GRANOLA_API_KEY on the server to import from Granola. It needs a Granola Business plan.", 409, "granola_not_configured");

  let parsed;
  try {
    parsed = await readGranola(source, { createdAfter: o.since, excludeDomains: o.excludeDomains, selfEmails: o.selfEmails, maxNotes: o.maxNotes });
  } catch (e) {
    if (e instanceof GranolaApiError) return bad(e.status === 401 || e.status === 403 ? "Granola refused the key." : `Granola answered ${e.status}.`, 502, "granola_error");
    throw e;
  }
  if (!parsed.people.length) return bad(parsed.notes[0] ?? "No people were found.", 422, "nothing_to_import");

  if (o.dryRun) {
    const { preview } = await previewImport(session.store, parsed);
    return json({ dryRun: true, ...preview, format: parsed.format, notes: parsed.notes });
  }
  const summary = await runImport(session.store, parsed, "Granola meetings");
  return json({ ...summary, format: parsed.format, notes: parsed.notes });
}
