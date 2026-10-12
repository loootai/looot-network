import { toCsv } from "../lib/import/csv";
import type { Person } from "../lib/types";

export const REPORT_COLUMNS = ["full_name", "email", "company", "title", "location", "linkedin_url", "tags", "source_kinds", "connected_on"];

const row = (p: Person) => ({ full_name: p.full_name, email: p.email, company: p.company, title: p.title, location: p.location, linkedin_url: p.linkedin_url, tags: p.tags, source_kinds: p.source_kinds, connected_on: p.connected_on });

export const peopleToCsv = (people: Person[]) => toCsv(people.map(row), REPORT_COLUMNS) + "\n";
export const peopleToJson = (people: Person[], meta: Record<string, unknown> = {}) => JSON.stringify({ ...meta, count: people.length, people }, null, 2) + "\n";

const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "-";

/** A markdown table of people, at most `max` rows, with a line saying how many were left out. */
export function peopleToMarkdown(title: string, people: Person[], opts: { total?: number; explain?: string[]; max?: number } = {}): string {
  const max = opts.max ?? 100;
  const lines = [`# ${title}`, ""];
  if (opts.explain?.length) lines.push(`Read as: ${opts.explain.join("; ")}`, "");
  lines.push(`${opts.total ?? people.length} people.`, "", "| Name | Company | Title | Place | Email |", "| --- | --- | --- | --- | --- |");
  for (const p of people.slice(0, max)) lines.push(`| ${cell(p.full_name)} | ${cell(p.company)} | ${cell(p.title)} | ${cell(p.location)} | ${cell(p.email)} |`);
  if (people.length > max) lines.push("", `${people.length - max} more are in the JSON and CSV files.`);
  return lines.join("\n") + "\n";
}
