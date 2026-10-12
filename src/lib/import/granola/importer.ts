import type { GranolaListNotesResponse, GranolaNote, ListNotesParams } from "./types";

/** What the importer needs from Granola. GranolaClient and the demo stand-in both fit. */
export interface GranolaSource {
  iterateNotes(params?: Omit<ListNotesParams, "cursor">): AsyncIterable<GranolaListNotesResponse["notes"][number]>;
  getNote(noteId: string): Promise<GranolaNote>;
}

/** A person met in at least one Granola meeting. */
export interface ImportedContact {
  email: string;
  /** Null when only a calendar invite carried the address. */
  name: string | null;
  /** Lowercased email domain, null for free-mail addresses. */
  companyDomain: string | null;
  meetingCount: number;
  firstMeetingAt: string;
  lastMeetingAt: string;
  /** Title of the most recent meeting, from the calendar event or the note. */
  lastMeetingTitle: string | null;
  noteIds: string[];
  source: "granola";
}

export interface ImportOptions {
  /** Your own addresses. Always excluded. The note owner is excluded too. */
  selfEmails?: string[];
  /** Domains to skip, such as your own company and internal tools. */
  excludeDomains?: string[];
  createdAfter?: string;
  /** Stop after this many notes. Default 200. Each note costs one Granola request. */
  maxNotes?: number;
}

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
  "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com",
]);

/** Returns the company domain of an address, or null for free-mail and malformed input. */
export function companyDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d && !FREE_MAIL_DOMAINS.has(d) ? d : null;
}

/** Folds one note into the contact map. Attendees give names, calendar invitees add bare emails. */
export function addNoteToContacts(
  map: Map<string, ImportedContact>,
  note: GranolaNote,
  skip: { selfEmails: Set<string>; excludeDomains: Set<string> },
): void {
  const when = note.calendar_event?.scheduled_start_time ?? note.created_at;
  const title = note.calendar_event?.event_title ?? note.title ?? null;
  const people: { email: string; name: string | null }[] = [
    ...(note.attendees ?? []).map((a) => ({ email: a.email, name: a.name })),
    ...(note.calendar_event?.invitees ?? []).map((i) => ({ email: i.email, name: null })),
  ];
  const seenInNote = new Set<string>();
  for (const p of people) {
    const email = p.email?.trim().toLowerCase();
    if (!email || !email.includes("@") || seenInNote.has(email)) {
      if (email && p.name) {
        const ex = map.get(email);
        if (ex && !ex.name) ex.name = p.name;
      }
      continue;
    }
    seenInNote.add(email);
    if (skip.selfEmails.has(email) || email === note.owner.email.toLowerCase()) continue;
    const domain = companyDomainOf(email);
    if (domain && skip.excludeDomains.has(domain)) continue;
    const ex = map.get(email);
    if (!ex) {
      map.set(email, {
        email, name: p.name, companyDomain: domain, meetingCount: 1,
        firstMeetingAt: when, lastMeetingAt: when, lastMeetingTitle: title, noteIds: [note.id], source: "granola",
      });
    } else {
      ex.meetingCount += 1;
      ex.name ??= p.name;
      if (when < ex.firstMeetingAt) ex.firstMeetingAt = when;
      if (when > ex.lastMeetingAt) {
        ex.lastMeetingAt = when;
        ex.lastMeetingTitle = title;
      }
      ex.noteIds.push(note.id);
    }
  }
}

/** Pulls attendees from the user's own Granola notes. Makes list calls plus one get-note call per note. */
export async function importAttendees(client: GranolaSource, opts: ImportOptions = {}): Promise<ImportedContact[]> {
  const skip = {
    selfEmails: new Set((opts.selfEmails ?? []).map((e) => e.toLowerCase())),
    excludeDomains: new Set((opts.excludeDomains ?? []).map((d) => d.toLowerCase())),
  };
  const map = new Map<string, ImportedContact>();
  let n = 0;
  const max = opts.maxNotes ?? 200;
  for await (const summary of client.iterateNotes({ created_after: opts.createdAfter })) {
    if (n++ >= max) break;
    if (summary.deleted_at) continue;
    addNoteToContacts(map, await client.getNote(summary.id), skip);
  }
  return [...map.values()].sort((a, b) => b.meetingCount - a.meetingCount || a.email.localeCompare(b.email));
}

/** What an enrichment pass would ask looot to do. Counts only. Prices come from a looot quote, not from here. */
export interface EnrichmentPlan {
  contacts: number;
  contactsWithoutName: number;
  distinctCompanyDomains: number;
  freeMailContacts: number;
  /** Email-keyed person lookups and domain-keyed company lookups, to send to a looot quote first. */
  quoteRequest: { personLookups: string[]; companyLookups: string[] };
}

/** Builds the list to quote before any paid run. Calls nothing. */
export function planEnrichment(contacts: ImportedContact[]): EnrichmentPlan {
  const domains = new Set(contacts.map((c) => c.companyDomain).filter((d): d is string => !!d));
  return {
    contacts: contacts.length,
    contactsWithoutName: contacts.filter((c) => !c.name).length,
    distinctCompanyDomains: domains.size,
    freeMailContacts: contacts.filter((c) => !c.companyDomain).length,
    quoteRequest: { personLookups: contacts.map((c) => c.email), companyLookups: [...domains].sort() },
  };
}
