import {
  GranolaApiError,
  type GranolaListNotesResponse,
  type GranolaNote,
  type ListNotesParams,
} from "./types";

export const GRANOLA_BASE_URL = "https://public-api.granola.ai";

export interface GranolaClientOptions {
  /** A grn_ key from Granola, Settings, Connectors, API keys (Business or Enterprise plan). */
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Retries on 429 only. Docs: burst 25 per 5 s, sustained 5 per s. Default 3. */
  maxRetries?: number;
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Minimal read-only Granola client: list notes, get a note. Sends the key as a bearer token. */
export class GranolaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GranolaClientOptions) {
    if (!opts.apiKey) throw new Error("Granola apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? GRANOLA_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Lists one page of notes (summaries only). */
  async listNotes(params: ListNotesParams = {}): Promise<GranolaListNotesResponse> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const q = qs.toString();
    return this.get<GranolaListNotesResponse>(`/v1/notes${q ? `?${q}` : ""}`);
  }

  /** Yields every note summary, following the cursor until hasMore is false. */
  async *iterateNotes(params: Omit<ListNotesParams, "cursor"> = {}): AsyncGenerator<GranolaListNotesResponse["notes"][number]> {
    let cursor: string | undefined;
    for (;;) {
      const page = await this.listNotes({ page_size: 30, ...params, cursor });
      for (const n of page.notes) yield n;
      if (!page.hasMore || !page.cursor) return;
      cursor = page.cursor;
    }
  }

  /** Reads one note. The transcript is never requested. */
  async getNote(noteId: string): Promise<GranolaNote> {
    if (!/^not_[a-zA-Z0-9]{14}$/.test(noteId)) throw new Error(`Bad Granola note id: ${noteId}`);
    return this.get<GranolaNote>(`/v1/notes/${noteId}`);
  }

  private async get<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(this.baseUrl + path, {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 429 && attempt < this.maxRetries) {
        // Retry-After is not documented by Granola; fall back to exponential backoff.
        const ra = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt);
        continue;
      }
      const ra = Number(res.headers.get("retry-after"));
      throw new GranolaApiError(res.status, path.split("?")[0], Number.isFinite(ra) && ra > 0 ? ra : undefined);
    }
  }
}
