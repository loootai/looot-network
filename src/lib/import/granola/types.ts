/**
 * Types for the Granola public API, copied from the docs read 2026-10-12:
 * https://docs.granola.ai/api-reference/get-note
 * https://docs.granola.ai/api-reference/list-notes
 * https://docs.granola.ai/api-reference/get-transcript
 */

/** A Granola user: name may be null, email is always present. */
export interface GranolaUser {
  name: string | null;
  email: string;
}

/** One list entry. The list endpoint returns no attendees, so each note needs a get-note call. */
export interface GranolaNoteSummary {
  id: string;
  object: "note";
  title: string | null;
  owner: GranolaUser;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface GranolaListNotesResponse {
  notes: GranolaNoteSummary[];
  hasMore: boolean;
  cursor: string | null;
}

export interface GranolaCalendarEvent {
  event_title: string | null;
  /** Invitees carry an email only, no name. */
  invitees: { email: string }[];
  organiser: string | null;
  calendar_event_id: string | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
}

export interface GranolaNote extends GranolaNoteSummary {
  web_url: string;
  calendar_event: GranolaCalendarEvent | null;
  attendees: GranolaUser[];
  summary_text: string;
  summary_markdown: string | null;
  /** Only returned to the note's creator, otherwise null. The importer never reads it. */
  private_notes_text: string | null;
  transcript: unknown[] | null;
}

export interface ListNotesParams {
  created_after?: string;
  created_before?: string;
  updated_after?: string;
  folder_id?: string;
  space_id?: string;
  /** 1 to 30, docs default 10. */
  page_size?: number;
  cursor?: string;
}

/** Thrown for any non-2xx answer. The body is never included, so it cannot leak note content. */
export class GranolaApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly retryAfterSeconds?: number;
  constructor(status: number, path: string, retryAfterSeconds?: number) {
    super(`Granola API ${status} on ${path}`);
    this.name = "GranolaApiError";
    this.status = status;
    this.path = path;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
