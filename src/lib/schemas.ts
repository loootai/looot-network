import { z } from "zod";
import { MAP_FIELDS } from "./import/parsers";

const source = z.enum(["linkedin", "google", "csv", "x", "granola", "manual", "demo"]);
export const MAX_IMPORT_CHARS = 25_000_000;

export const ImportSchema = z.object({
  text: z.string().min(1).max(MAX_IMPORT_CHARS),
  filename: z.string().max(200).default("import.csv"),
  format: z.enum(["linkedin", "google", "x", "generic"]).optional(),
  mapping: z.record(z.enum(MAP_FIELDS), z.number().int().min(0).max(500)).optional(),
});

const ui = {
  sources: z.array(source).max(7).optional(),
  tags: z.array(z.string().max(60)).max(10).optional(),
  hasEmail: z.boolean().nullable().optional(),
  hasLinkedin: z.boolean().nullable().optional(),
  company: z.string().max(200).nullable().optional(),
};

export const PeopleQuerySchema = z.object({
  q: z.string().max(500).default(""),
  sort: z.enum(["relevance", "name", "company", "recent"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/** Which people a paid run covers: explicit ids, or whatever a search matches. The server caps the count either way. */
export const EnrichTargetSchema = z
  .object({
    kinds: z.array(z.enum(["profile", "company", "email"])).min(1).max(3),
    ids: z.array(z.string().uuid()).max(5000).optional(),
    query: z.string().max(500).optional(),
    filters: z.object(ui).optional(),
    // The run's spend cap is never read from the request. Unknown keys such as maxCostUsd are dropped here.
  })
  .refine((v) => v.ids?.length || v.query !== undefined, { message: "Pick people by id or by a search." });

export const SavedSchema = z.object({ name: z.string().trim().min(1).max(80), query: z.string().max(500) });
export const BudgetSchema = z.object({ dailyUsd: z.number().positive().max(10_000), monthlyUsd: z.number().positive().max(100_000) });
export const filterShape = z.object(ui);

/** Body of POST /api/import/granola. The Granola key is never in the body, the server reads it from GRANOLA_API_KEY. */
export const GranolaImportSchema = z.object({
  dryRun: z.boolean().default(false),
  /** ISO date or timestamp. Only meetings created after it are read. */
  since: z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), "since must be a date").optional(),
  excludeDomains: z.array(z.string().trim().toLowerCase().max(200)).max(50).default([]),
  selfEmails: z.array(z.string().trim().toLowerCase().max(320)).max(20).default([]),
  maxNotes: z.number().int().min(1).max(500).default(200),
});
