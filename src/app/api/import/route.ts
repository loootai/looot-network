import { bad, json, sessionOr401 } from "@/lib/server";
import { parseImport } from "@/lib/import/parsers";
import { runImport } from "@/lib/import/run";
import { ImportSchema } from "@/lib/schemas";

/** Imports a file the user exported: dedupes inside it, matches against the network, writes the new people and the new details. */
export async function POST(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const body = ImportSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("The file is empty or too large.");
  const parsed = parseImport(body.data.text, { filename: body.data.filename, format: body.data.format, mapping: body.data.mapping });
  if (!parsed.people.length) return bad(parsed.notes[0] ?? "No people were found in this file.", 422, "nothing_to_import");
  const summary = await runImport(session.store, parsed, body.data.filename);
  return json({ ...summary, format: parsed.format, notes: parsed.notes });
}
