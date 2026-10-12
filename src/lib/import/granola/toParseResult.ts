import type { ParseResult } from "../parsers";
import type { ImportedContact } from "./importer";

const day = (iso: string) => iso.slice(0, 10);

/** A readable name for an invitee who has none: "jo.smith@acme.example.com" becomes "Jo Smith". */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local.split(/[._+-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? words.join(" ") : email;
}

/**
 * Turns Granola attendees into the same ParseResult the CSV parsers return, so they go through planImport
 * and the same dedupe and merge path. The last-met date and meeting title sit in `raw`, which the profile
 * drawer shows as provenance. `connected_on` is the first meeting date and only fills an empty field.
 */
export function granolaToParseResult(contacts: ImportedContact[], notes: string[] = []): ParseResult {
  return {
    format: "granola",
    source: "granola",
    header: [],
    people: contacts.map((c) => {
      const full_name = c.name?.trim() || nameFromEmail(c.email);
      const parts = full_name.split(/\s+/);
      return {
        full_name,
        first_name: parts[0],
        last_name: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
        emails: [c.email],
        phones: [],
        company_domain: c.companyDomain ?? undefined,
        tags: ["granola"],
        connected_on: day(c.firstMeetingAt),
        source: "granola" as const,
        raw: {
          Email: c.email,
          Name: c.name ?? "",
          "Last met": day(c.lastMeetingAt),
          "Meeting title": c.lastMeetingTitle ?? "",
          Meetings: String(c.meetingCount),
          "Note ids": c.noteIds.join(" "),
        },
      };
    }),
    rejected: [],
    rows: contacts.length,
    notes,
  };
}
