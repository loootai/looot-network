import type { GranolaSource } from "./importer";
import type { GranolaListNotesResponse, GranolaNote } from "./types";

const OWNER = { name: "Demo Owner", email: "owner@demo.example.com" };

function note(n: number, title: string, when: string, attendees: { name: string | null; email: string }[]): GranolaNote {
  const id = `not_${String(n).padStart(14, "0")}`;
  return {
    id, object: "note", title, owner: OWNER, created_at: when, updated_at: when, deleted_at: null,
    web_url: `https://notes.granola.ai/d/demo-${n}`,
    calendar_event: { event_title: title, invitees: attendees.map((a) => ({ email: a.email })), organiser: OWNER.email, calendar_event_id: `demo-${n}`, scheduled_start_time: when, scheduled_end_time: null },
    attendees, summary_text: "", summary_markdown: null, private_notes_text: null, transcript: null,
  };
}

/** A few invented meetings. `known` are emails already in the demo network, so the demo shows both a merge and a new person. */
export function demoGranolaNotes(known: { name: string; email: string }[] = []): GranolaNote[] {
  const fresh = [
    { name: "Ottoline Brandt", email: "ottoline@greywater.example.com" },
    { name: "Hamish Okeke", email: "hamish@greywater.example.com" },
    { name: null, email: "priya.raman@tidemark.example.com" },
  ];
  const out: GranolaNote[] = [
    note(1, "Greywater intro call", "2026-10-02T14:00:00Z", [fresh[0], fresh[1]]),
    note(2, "Tidemark pricing review", "2026-10-06T09:30:00Z", [fresh[2]]),
    note(3, "Greywater follow-up", "2026-10-09T16:00:00Z", [fresh[0]]),
  ];
  known.slice(0, 3).forEach((k, i) => out.push(note(4 + i, `Catch-up with ${k.name.split(" ")[0]}`, `2026-10-0${3 + i}T11:00:00Z`, [k])));
  return out;
}

/** Stands in for GranolaClient in demo mode and in tests. Reads no network and needs no key. */
export class DemoGranolaClient implements GranolaSource {
  private readonly notes: GranolaNote[];
  constructor(known: { name: string; email: string }[] = []) {
    this.notes = demoGranolaNotes(known);
  }
  async *iterateNotes(): AsyncGenerator<GranolaListNotesResponse["notes"][number]> {
    for (const n of this.notes) yield n;
  }
  async getNote(noteId: string): Promise<GranolaNote> {
    const n = this.notes.find((x) => x.id === noteId);
    if (!n) throw new Error(`Unknown demo note ${noteId}`);
    return n;
  }
}
