import { domainOf, normalizeEmail, normalizeLinkedIn, normalizeX, splitEmails, splitName, toIsoDate, linkedInUrl, workDomain } from "../normalize";
import type { PersonInput, SourceKind } from "../types";
import { parseCsv, toRecords } from "./csv";

export type ImportFormat = "linkedin" | "google" | "x" | "generic";

export interface ParseResult {
  format: ImportFormat;
  source: SourceKind;
  /** Header cells of the table that was read (empty for the X archive). */
  header: string[];
  people: PersonInput[];
  /** Rows that gave no person, with the 1-based row number in the file and the reason. */
  rejected: { row: number; reason: string }[];
  /** Total data rows seen, including rejected ones. */
  rows: number;
  /** Plain-language notes, for example "Skipped 3 lines of notes before the header". */
  notes: string[];
}

const low = (s: string) => s.trim().toLowerCase();

/** The index of the header row of a LinkedIn Connections.csv. The export puts a few lines of notes above it. */
export function findLinkedInHeader(rows: string[][]): number {
  return rows.findIndex((r) => {
    const h = r.map(low);
    return h.includes("first name") && h.includes("last name") && (h.includes("url") || h.includes("company") || h.includes("position"));
  });
}

/** Header cells of the Google Contacts exports (the current one and the older Outlook-style one). */
function isGoogleHeader(h: string[]): boolean {
  const l = h.map(low);
  const hasEmail = l.some((c) => /^e-?mail \d+ - value$/.test(c));
  const hasName = l.includes("first name") || l.includes("given name") || l.includes("file as");
  return hasEmail && hasName;
}

/** The X archive file data/following.js: JavaScript that assigns a JSON array to window.YTD.following.part0. */
export function looksLikeXArchive(text: string): boolean {
  return /window\.YTD\.following\.part\d+\s*=/.test(text.slice(0, 400)) || /^\s*\[\s*\{\s*"following"\s*:/.test(text.slice(0, 200));
}

/** Detects the format of a file from its content. The file name is only a hint for the X archive. */
export function detectFormat(text: string, filename = ""): ImportFormat {
  if (looksLikeXArchive(text) || /following\.js$/i.test(filename)) return "x";
  const rows = parseCsv(text);
  if (findLinkedInHeader(rows) >= 0) return "linkedin";
  if (rows[0] && isGoogleHeader(rows[0])) return "google";
  return "generic";
}

const base = (source: SourceKind): Pick<PersonInput, "emails" | "phones" | "tags" | "source" | "raw" | "full_name"> => ({ full_name: "", emails: [], phones: [], tags: [], source, raw: {} });

/** LinkedIn Connections.csv: First Name, Last Name, URL, Email Address, Company, Position, Connected On. LinkedIn leaves Email Address empty for most people. */
export function parseLinkedIn(text: string): ParseResult {
  const rows = parseCsv(text);
  const at = findLinkedInHeader(rows);
  const out: ParseResult = { format: "linkedin", source: "linkedin", header: [], people: [], rejected: [], rows: 0, notes: [] };
  if (at < 0) {
    out.notes.push("No header with First Name and Last Name was found.");
    return out;
  }
  if (at > 0) out.notes.push(`Skipped ${at} line${at === 1 ? "" : "s"} of notes above the header.`);
  const header = rows[at].map((h) => h.trim());
  out.header = header;
  const recs = toRecords(header, rows.slice(at + 1));
  const get = (r: Record<string, string>, ...names: string[]) => {
    for (const n of names) {
      const k = Object.keys(r).find((x) => low(x) === n);
      if (k && r[k]) return r[k];
    }
    return "";
  };
  recs.forEach((r, i) => {
    out.rows++;
    const first = get(r, "first name");
    const last = get(r, "last name");
    const full = [first, last].filter(Boolean).join(" ");
    const url = get(r, "url");
    if (!full) {
      out.rejected.push({ row: at + 2 + i, reason: "No name" });
      return;
    }
    const key = normalizeLinkedIn(url);
    const email = normalizeEmail(get(r, "email address", "email"));
    out.people.push({
      ...base("linkedin"),
      full_name: full,
      first_name: first || undefined,
      last_name: last || undefined,
      emails: email ? [email] : [],
      linkedin_url: key ? linkedInUrl(key) : undefined,
      company: get(r, "company") || undefined,
      company_domain: email ? (workDomain(email) ?? undefined) : undefined,
      title: get(r, "position") || undefined,
      connected_on: toIsoDate(get(r, "connected on")),
      raw: r,
    });
  });
  return out;
}

/** Google Contacts CSV (also what Gmail contacts export as). Handles "E-mail 1 - Value" style columns and several values in one cell. */
export function parseGoogle(text: string): ParseResult {
  const rows = parseCsv(text);
  const out: ParseResult = { format: "google", source: "google", header: [], people: [], rejected: [], rows: 0, notes: [] };
  if (!rows.length) return out;
  const header = rows[0].map((h) => h.trim());
  out.header = header;
  const recs = toRecords(header, rows.slice(1));
  const cols = (re: RegExp) => header.filter((h) => re.test(h));
  const emailCols = cols(/^e-?mail \d+ - value$/i);
  const phoneCols = cols(/^phone \d+ - value$/i);
  const first = (r: Record<string, string>, ...names: string[]) => {
    for (const n of names) {
      const k = header.find((h) => low(h) === n);
      if (k && r[k]) return r[k];
    }
    return "";
  };
  recs.forEach((r, i) => {
    out.rows++;
    let given = first(r, "first name", "given name");
    let family = first(r, "last name", "family name");
    const middle = first(r, "middle name", "additional name");
    let full = [given, middle, family].filter(Boolean).join(" ") || first(r, "name", "file as", "nickname");
    const org = first(r, "organization name", "organization 1 - name", "organization");
    const emails = [...new Set(emailCols.flatMap((c) => splitEmails(r[c])))];
    if (!full) full = org && !emails.length ? "" : (emails[0]?.split("@")[0] ?? "");
    if (!full) {
      out.rejected.push({ row: i + 2, reason: "No name and no email" });
      return;
    }
    if (!given && !family) ({ first: given, last: family } = splitName(full));
    const city = first(r, "address 1 - city");
    const country = first(r, "address 1 - country");
    const region = first(r, "address 1 - region");
    const location = [city, region, country].filter(Boolean).join(", ") || first(r, "address 1 - formatted").replace(/\s*\n\s*/g, ", ") || undefined;
    const websites = cols(/^website \d+ - value$/i).map((c) => r[c]).filter(Boolean);
    const li = websites.map(normalizeLinkedIn).find(Boolean);
    const x = websites.map(normalizeX).find(Boolean);
    const labels = first(r, "labels", "group membership").split(/\s*:::\s*/).map((l) => l.replace(/^\*\s*/, "").trim()).filter((l) => l && l !== "myContacts");
    out.people.push({
      ...base("google"),
      full_name: full,
      first_name: given || undefined,
      last_name: family || undefined,
      emails,
      phones: [...new Set(phoneCols.flatMap((c) => (r[c] ?? "").split(/\s*:::\s*/)).map((p) => p.trim()).filter(Boolean))],
      linkedin_url: li ? linkedInUrl(li) : undefined,
      x_url: x ? `https://${x}` : undefined,
      company: org || undefined,
      company_domain: emails.map(workDomain).find(Boolean) ?? undefined,
      title: first(r, "organization title", "organization 1 - title", "job title") || undefined,
      location,
      notes: first(r, "notes") || undefined,
      tags: labels,
      raw: r,
    });
  });
  return out;
}

/** X archive data/following.js. The archive holds account ids and profile links only, no names, so rows get a placeholder name. */
export function parseXFollowing(text: string): ParseResult {
  const out: ParseResult = { format: "x", source: "x", header: [], people: [], rejected: [], rows: 0, notes: ["The X archive lists account ids and links, not names. Names stay as placeholders until you enrich or edit them."] };
  const start = text.indexOf("[");
  let list: unknown;
  try {
    list = JSON.parse(text.slice(start));
  } catch {
    out.notes.push("The file is not valid JSON after the assignment.");
    return out;
  }
  if (!Array.isArray(list)) return out;
  list.forEach((entry, i) => {
    out.rows++;
    const f = (entry as { following?: { accountId?: string; userLink?: string } })?.following;
    const id = f?.accountId ?? "";
    const link = f?.userLink ?? "";
    if (!id && !link) {
      out.rejected.push({ row: i + 1, reason: "No account id" });
      return;
    }
    const handle = link.match(/(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})(?:$|[/?])/);
    const name = handle && handle[1] !== "intent" ? `@${handle[1]}` : `X account ${id}`;
    out.people.push({ ...base("x"), full_name: name, x_url: link || `https://x.com/i/user/${id}`, tags: ["x-following"], raw: { accountId: id, userLink: link } });
  });
  return out;
}

/** The fields a generic CSV column can feed. */
export const MAP_FIELDS = ["full_name", "first_name", "last_name", "email", "phone", "linkedin_url", "x_url", "company", "title", "location", "headline", "notes", "tags", "connected_on"] as const;
export type MapField = (typeof MAP_FIELDS)[number];
/** Column index per field. */
export type ColumnMapping = Partial<Record<MapField, number>>;

const GUESS: Record<MapField, RegExp> = {
  full_name: /^(full ?name|name|display ?name|contact|contact ?name)$/i,
  first_name: /^(first ?name|given ?name|first|forename)$/i,
  last_name: /^(last ?name|surname|family ?name|last)$/i,
  email: /^(e-?mail|e-?mail ?address|work ?e-?mail|primary ?e-?mail|email 1)$/i,
  phone: /^(phone|mobile|telephone|tel|phone ?number|cell)$/i,
  linkedin_url: /^(linkedin|linkedin ?url|linkedin ?profile|profile ?url|url)$/i,
  x_url: /^(x|twitter|x ?url|twitter ?url|x ?handle|twitter ?handle)$/i,
  company: /^(company|company ?name|organi[sz]ation|employer|org)$/i,
  title: /^(title|job ?title|position|role)$/i,
  location: /^(location|city|region|country|address|where)$/i,
  headline: /^(headline|bio|summary|about)$/i,
  notes: /^(notes?|comments?|description)$/i,
  tags: /^(tags?|labels?|groups?|lists?)$/i,
  connected_on: /^(connected ?on|date ?added|added|connected|since)$/i,
};

/** Guesses which column feeds each field from the header names. */
export function guessMapping(header: string[]): ColumnMapping {
  const m: ColumnMapping = {};
  for (const f of MAP_FIELDS) {
    const i = header.findIndex((h, idx) => GUESS[f].test(h.trim().replace(/[_-]/g, " ")) && !Object.values(m).includes(idx));
    if (i >= 0) m[f] = i;
  }
  return m;
}

/** Any CSV with a header, read through a column mapping the user can edit. */
export function parseGeneric(text: string, mapping?: ColumnMapping): ParseResult {
  const rows = parseCsv(text);
  const out: ParseResult = { format: "generic", source: "csv", header: [], people: [], rejected: [], rows: 0, notes: [] };
  if (!rows.length) return out;
  const header = rows[0].map((h) => h.trim());
  out.header = header;
  const map = mapping ?? guessMapping(header);
  if (!mapping) out.notes.push("Columns were matched from their names. Check the mapping before you import.");
  const cell = (r: string[], f: MapField) => (map[f] === undefined ? "" : (r[map[f]!] ?? "").trim());
  rows.slice(1).forEach((r, i) => {
    out.rows++;
    const email = splitEmails(cell(r, "email"));
    const li = normalizeLinkedIn(cell(r, "linkedin_url"));
    const x = normalizeX(cell(r, "x_url"));
    let first = cell(r, "first_name");
    let last = cell(r, "last_name");
    let full = cell(r, "full_name") || [first, last].filter(Boolean).join(" ");
    if (!full && email[0]) full = email[0].split("@")[0].replace(/[._-]+/g, " ");
    if (!full) {
      out.rejected.push({ row: i + 2, reason: "No name and no email" });
      return;
    }
    if (!first && !last) ({ first, last } = splitName(full));
    out.people.push({
      ...base("csv"),
      full_name: full,
      first_name: first || undefined,
      last_name: last || undefined,
      emails: email,
      phones: cell(r, "phone") ? [cell(r, "phone")] : [],
      linkedin_url: li ? linkedInUrl(li) : undefined,
      x_url: x ? `https://${x}` : undefined,
      company: cell(r, "company") || undefined,
      company_domain: email.map(workDomain).find(Boolean) ?? domainOf(cell(r, "company")) ?? undefined,
      title: cell(r, "title") || undefined,
      location: cell(r, "location") || undefined,
      headline: cell(r, "headline") || undefined,
      notes: cell(r, "notes") || undefined,
      tags: cell(r, "tags").split(/\s*[;|]\s*|\s*,\s*/).map((t) => t.trim()).filter(Boolean),
      connected_on: toIsoDate(cell(r, "connected_on")),
      raw: Object.fromEntries(header.map((h, k) => [h, (r[k] ?? "").trim()])),
    });
  });
  return out;
}

/** Most rows one import reads. A bigger file is cut and the result says so. */
export const IMPORT_ROW_LIMIT = 50_000;

/** Reads a file in the given format, or detects it. `mapping` only applies to the generic CSV. */
export function parseImport(text: string, opts: { filename?: string; format?: ImportFormat; mapping?: ColumnMapping } = {}): ParseResult {
  const format = opts.format ?? detectFormat(text, opts.filename);
  const res = format === "linkedin" ? parseLinkedIn(text) : format === "google" ? parseGoogle(text) : format === "x" ? parseXFollowing(text) : parseGeneric(text, opts.mapping);
  if (res.people.length > IMPORT_ROW_LIMIT) {
    res.notes.push(`The file has ${res.people.length} people. Only the first ${IMPORT_ROW_LIMIT} were read.`);
    res.people = res.people.slice(0, IMPORT_ROW_LIMIT);
  }
  return res;
}
