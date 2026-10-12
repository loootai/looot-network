import { importAttendees, type GranolaSource, type ImportOptions } from "./importer";
import { granolaToParseResult } from "./toParseResult";
import type { ParseResult } from "../parsers";

/** Reads attendees from Granola and returns them as a ParseResult, ready for planImport and runImport. */
export async function readGranola(source: GranolaSource, opts: ImportOptions = {}): Promise<ParseResult> {
  const contacts = await importAttendees(source, opts);
  const notes = contacts.length ? [`${contacts.length} people from your Granola meetings.`] : ["No attendees were found in your Granola meetings."];
  return granolaToParseResult(contacts, notes);
}
