import { bad, json, sessionOr401 } from "@/lib/server";
import { guessMapping, parseImport } from "@/lib/import/parsers";
import { previewImport } from "@/lib/import/run";
import { ImportSchema } from "@/lib/schemas";

/** Reads a file and says what an import would do. Writes nothing. */
export async function POST(request: Request) {
  const session = await sessionOr401();
  if (!("store" in session)) return session;
  const body = ImportSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return bad("The file is empty or too large.");
  const parsed = parseImport(body.data.text, { filename: body.data.filename, format: body.data.format, mapping: body.data.mapping });
  const { preview } = await previewImport(session.store, parsed);
  return json({
    format: parsed.format,
    source: parsed.source,
    header: parsed.header,
    mapping: parsed.format === "generic" ? (body.data.mapping ?? guessMapping(parsed.header)) : null,
    sample: parsed.people.slice(0, 5).map((p) => ({ name: p.full_name, company: p.company ?? "", title: p.title ?? "", email: p.emails[0] ?? "", linkedin: p.linkedin_url ?? "", location: p.location ?? "" })),
    notes: parsed.notes,
    preview,
  });
}
