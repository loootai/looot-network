import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { seedDemo } from "../demo/seed";
import { DemoRunner } from "../demo/demoRunner";
import { Budget } from "../lib/budget";
import { keysOf } from "../lib/dedupe";
import { applyFacts, buildQuote, runEnrich, skipText, type CallResult } from "../lib/enrich/engine";
import { ENRICH, FALLBACK_PRICES, KINDS, PRICES_AS_OF } from "../lib/enrich/providers";
import { parseImport } from "../lib/import/parsers";
import { DemoGranolaClient, GranolaApiError, granolaFromEnv, readGranola } from "../lib/import/granola";
import { previewImport, runImport } from "../lib/import/run";
import { fetchPrices, hasLoootToken, loootFromEnv, type PriceMap } from "../lib/looot";
import { toMicros, usd, usdPrecise } from "../lib/money";
import { specFrom } from "../lib/search/spec";
import { MemoryStore } from "../lib/store/memoryStore";
import type { EnrichKind, Person, PersonInput } from "../lib/types";
import { peopleToCsv, peopleToJson, peopleToMarkdown } from "./report";

const HELP = `looot-network: search your own network from the command line

Usage
  npm run network -- import <file...>                       Read the files, dedupe, report what is in them
  npm run network -- search "<query>" <file...>             Plain-language search over the files
  npm run network -- enrich <file...> [--query "<query>"]   Quote, and with a token run, paid lookups

Add --granola to import the people from your Granola meetings (Business plan). The key is read from GRANOLA_API_KEY.

Files are LinkedIn Connections.csv, Google Contacts CSV, an X following.js or any CSV with a header.
Use --demo instead of files to run on 200 invented people. No token, no network, no cost.

Options
  --kinds profile,company,email   Which lookups to run (enrich, default profile)
  --max-spend <usd>               Per-run spend cap in dollars (enrich, default 1)
  --dry-run                       Print the list-price cost and make no call (enrich). With --granola, count what an
                                  import would add and write nothing
  --granola                       Also import attendees of your Granola meetings (import, search, enrich)
  --since <date>                  Only Granola meetings created after this date (with --granola)
  --exclude-domain <domain>       Skip attendees on this domain, repeatable (with --granola)
  --self <email>                  Skip your own address, repeatable (with --granola)
  --limit <n>                     Most people in a search report (default 100)
  --out <dir>                     Where reports go (default ./out)
  --format json,csv,md            Report formats (default json,csv,md)
  --offline                       Use the dated prices in the code, read nothing from the catalog
  --demo                          Invented sample people
  --help

Environment
  GRANOLA_API_KEY                 Your Granola key (grn_...). Only for --granola. Never printed or sent to looot
  LOOOT_TOKEN                     Your looot key. Not needed for import, search, --dry-run or --demo
  LOOOT_API_URL                   Override the API base (default https://api.looot.ai)
  LOOOT_NETWORK_DIR               Folder for the budget file (default .looot-network)
  LOOOT_NETWORK_DAILY_USD         Default daily budget until saved in the web UI (default 5)
  LOOOT_NETWORK_MONTHLY_USD       Default monthly budget (default 25)

Exit codes: 0 done, 1 error, 2 refused (over the cap, over the budget, or no token).
`;

export interface Args {
  command?: "import" | "search" | "enrich";
  query?: string;
  files: string[];
  kinds: EnrichKind[];
  maxSpend: number;
  dryRun: boolean;
  granola: boolean;
  since?: string;
  excludeDomains: string[];
  selfEmails: string[];
  limit: number;
  out: string;
  formats: string[];
  offline: boolean;
  demo: boolean;
  help: boolean;
}

/** Parses argv. Throws on an unknown flag so a typo never runs a paid job with defaults. */
export function parseArgs(argv: string[]): Args {
  const a: Args = { files: [], kinds: ["profile"], maxSpend: 1, dryRun: false, granola: false, excludeDomains: [], selfEmails: [], limit: 100, out: "out", formats: ["json", "csv", "md"], offline: false, demo: false, help: false };
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    switch (t) {
      case "--kinds": {
        const ks = value(i++, t).split(",").map((s) => s.trim()).filter(Boolean);
        for (const k of ks) if (!(KINDS as string[]).includes(k)) throw new Error(`Unknown lookup ${k}. Use ${KINDS.join(", ")}.`);
        a.kinds = ks as EnrichKind[];
        break;
      }
      case "--max-spend": {
        const n = Number(value(i++, t));
        if (!Number.isFinite(n) || n < 0) throw new Error("--max-spend needs a dollar amount, for example 1");
        a.maxSpend = n;
        break;
      }
      case "--query": a.query = value(i++, t); break;
      case "--limit": {
        const n = Math.floor(Number(value(i++, t)));
        if (!Number.isFinite(n) || n < 1) throw new Error("--limit needs a number of people");
        a.limit = n;
        break;
      }
      case "--out": a.out = value(i++, t); break;
      case "--format": a.formats = value(i++, t).split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--dry-run": a.dryRun = true; break;
      case "--granola": a.granola = true; break;
      case "--since": {
        const v = value(i++, t);
        if (Number.isNaN(Date.parse(v))) throw new Error("--since needs a date, for example 2026-01-01");
        a.since = v;
        break;
      }
      case "--exclude-domain": a.excludeDomains.push(value(i++, t).toLowerCase()); break;
      case "--self": a.selfEmails.push(value(i++, t).toLowerCase()); break;
      case "--offline": a.offline = true; break;
      case "--demo": a.demo = true; break;
      case "--help": case "-h": a.help = true; break;
      default:
        if (t.startsWith("--")) throw new Error(`Unknown option ${t}. Run with --help.`);
        positional.push(t);
    }
  }
  if (!a.granola && (a.since || a.excludeDomains.length || a.selfEmails.length)) throw new Error("--since, --exclude-domain and --self only apply with --granola.");
  for (const f of a.formats) if (!["json", "csv", "md"].includes(f)) throw new Error(`Unknown format ${f}. Use json, csv or md.`);
  const [cmd, ...rest] = positional;
  if (cmd) {
    if (!["import", "search", "enrich"].includes(cmd)) throw new Error(`Unknown command ${cmd}. Use import, search or enrich.`);
    a.command = cmd as Args["command"];
  }
  if (a.command === "search") {
    a.query = rest[0];
    a.files = rest.slice(1);
  } else a.files = rest;
  return a;
}

/** A stable id from the dedupe keys, so the same file always gives the same people and the same idempotency keys. */
export function stableId(i: PersonInput): string {
  const k = keysOf(i);
  const basis = k.linkedin ?? k.emails[0] ?? k.nameCompany ?? k.x ?? i.full_name.toLowerCase();
  const h = createHash("sha256").update(basis).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function write(args: Args, name: string, people: Person[], md: string, meta: Record<string, unknown>, say: (s: string) => void) {
  fs.mkdirSync(args.out, { recursive: true });
  const written: string[] = [];
  const put = (ext: string, body: string) => {
    const f = path.join(args.out, `${name}.${ext}`);
    fs.writeFileSync(f, body);
    written.push(f);
  };
  if (args.formats.includes("json")) put("json", peopleToJson(people, meta));
  if (args.formats.includes("csv")) put("csv", peopleToCsv(people));
  if (args.formats.includes("md")) put("md", md);
  say(`Wrote ${written.join(", ")}`);
}

/** Reads Granola into the store through the same plan and commit as a file. With --dry-run it only counts. */
async function loadGranola(store: MemoryStore, args: Args, env: Record<string, string | undefined>, say: (s: string) => void): Promise<boolean> {
  const source = args.demo ? new DemoGranolaClient(store.people.filter((p) => p.email).map((p) => ({ name: p.full_name, email: p.email! }))) : granolaFromEnv(env);
  if (!source) {
    say("GRANOLA_API_KEY is not set, so Granola was not read. Create a key in Granola (Business plan), or use --demo.");
    return false;
  }
  const parsed = await readGranola(source, { createdAfter: args.since, excludeDomains: args.excludeDomains, selfEmails: args.selfEmails });
  const r = args.dryRun ? (await previewImport(store, parsed)).preview : await runImport(store, parsed, "Granola meetings");
  say(`Granola meetings: ${r.rows} people, ${r.added} ${args.dryRun ? "would be new" : "new"}, ${r.merged + r.unchanged} already known${args.dryRun ? ". Dry run: nothing was written." : "."}`);
  for (const n of parsed.notes) say(`  ${n}`);
  return true;
}

async function load(args: Args, env: Record<string, string | undefined>, say: (s: string) => void): Promise<MemoryStore | null> {
  const store = new MemoryStore({ demo: false, personId: stableId, budget: new Budget() });
  if (args.demo && !args.files.length) {
    const seed = seedDemo();
    store.people = seed.people;
    store.sources = seed.sources;
    store.imports = seed.imports;
    if (args.granola && !(await loadGranola(store, args, env, say))) return null;
    return store;
  }
  if (!args.files.length && !args.granola) {
    say("Give one or more files, or --demo. Run with --help.");
    return null;
  }
  for (const file of args.files) {
    const text = fs.readFileSync(file, "utf8");
    const parsed = parseImport(text, { filename: path.basename(file) });
    const r = await runImport(store, parsed, path.basename(file));
    say(`${path.basename(file)}: ${parsed.format}, ${r.rows} rows, ${r.added} new, ${r.merged + r.unchanged} already known, ${r.folded} repeated inside the file${r.rejected.length ? `, ${r.rejected.length} skipped` : ""}.`);
    for (const n of parsed.notes) say(`  ${n}`);
  }
  if (args.granola && !(await loadGranola(store, args, env, say))) return null;
  return store;
}

/** Runs the CLI. Returns the exit code: 0 done, 1 error, 2 refused. */
export async function main(argv: string[], env: Record<string, string | undefined> = process.env, say: (s: string) => void = (s) => process.stdout.write(`${s}\n`)): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    say((e as Error).message);
    return 1;
  }
  if (args.help || argv.length === 0) {
    say(HELP);
    return args.help ? 0 : 1;
  }
  if (!args.command) args.command = args.demo || args.files.length || args.granola ? "import" : undefined;
  if (!args.command) {
    say("Say what to do: import, search or enrich. Run with --help.");
    return 1;
  }
  try {
    if (args.demo && env.LOOOT_TOKEN?.trim()) {
      say("Demo mode refuses to run while LOOOT_TOKEN is set. Unset it, or drop --demo.");
      return 2;
    }
    const store = await load(args, env, say);
    if (!store) return args.granola ? 2 : 1;
    say(`${store.people.length} people.`);

    if (args.command === "import") {
      if (args.granola && args.dryRun) return 0;
      write(args, "network-people", store.people, peopleToMarkdown("Your network", store.people, { max: args.limit }), { source: "import" }, say);
      return 0;
    }

    if (args.command === "search") {
      if (args.query === undefined) {
        say('Give a query, for example: search "founders in Paris" contacts.csv');
        return 1;
      }
      const spec = specFrom(args.query, {}, { limit: Math.max(args.limit, 1), sort: "relevance" });
      const { people, total } = await store.search(spec);
      say(`Read as: ${spec.explain.length ? spec.explain.join("; ") : "nothing recognised, showing everyone"}`);
      say(`${total} match.`);
      write(args, "network-search", people, peopleToMarkdown(`Search: ${args.query}`, people, { total, explain: spec.explain, max: args.limit }), { query: args.query, explain: spec.explain, total }, say);
      return 0;
    }

    // enrich
    const scope = specFrom(args.query ?? "", {}, { limit: 5000, sort: "name" });
    const { people } = await store.search(scope);
    let prices: PriceMap = { ...FALLBACK_PRICES };
    let priceSource: "catalog" | "fallback" = "fallback";
    let unpriced: string[] = [];
    if (!args.demo && !args.offline) {
      const live = await fetchPrices(FALLBACK_PRICES, { baseUrl: env.LOOOT_API_URL });
      prices = live.prices;
      priceSource = live.source;
      unpriced = live.unread;
    }
    if (args.offline) say(`Offline: using the dated prices in the code (${PRICES_AS_OF}), not the live catalog.`);
    const quote = buildQuote(people, args.kinds, prices, priceSource);
    say(`${people.length} people in scope.`);
    for (const l of quote.lines) {
      const skip = skipText(l.skipped);
      say(`  ${l.label.padEnd(46)} ${l.provider.padEnd(16)} ${usdPrecise(l.priceMicros).padStart(9)} x ${String(l.calls).padStart(5)} = ${usdPrecise(l.totalMicros).padStart(9)}${skip ? `   left out: ${skip}` : ""}`);
    }
    const capMicros = toMicros(args.maxSpend);
    say(`Quoted ${usdPrecise(quote.totalMicros)} at list price. Per-run cap ${usd(capMicros)}. Prices: ${priceSource === "catalog" ? "read from the public looot catalog" : "dated fallback in the code"}.`);
    if (unpriced.length) say(`Live price unreadable for ${unpriced.join(", ")}. Those calls will be skipped.`);
    if (args.dryRun) {
      say("Dry run: no call was made and nothing was charged.");
      return 0;
    }
    if (quote.totalMicros === 0) {
      say("Nothing to look up for these people.");
      return 0;
    }
    if (!args.demo && !hasLoootToken(env)) {
      say("LOOOT_TOKEN is not set, so nothing was run. Add --dry-run to see the cost only, or --demo for sample data.");
      return 2;
    }
    if (!args.demo && quote.totalMicros > capMicros) {
      say(`The quote ${usdPrecise(quote.totalMicros)} is above the cap ${usd(capMicros)}. Raise --max-spend, narrow the people with --query, or the run will stop at the cap.`);
    }
    const runner = args.demo ? new DemoRunner() : loootFromEnv(env);
    const byId = new Map(people.map((p) => [p.id, p]));
    const summary = await runEnrich({
      people,
      kinds: args.kinds,
      looot: runner,
      prices,
      priceSource,
      unpriced,
      capMicros,
      ledger: new Budget(),
      demo: args.demo,
      apply: async (r: CallResult) => {
        for (const id of r.need.personIds) {
          const p = byId.get(id);
          const patch = p ? applyFacts(p, r, new Date().toISOString()) : null;
          if (p && patch) Object.assign(p, patch);
        }
      },
    });
    const c = summary.counts;
    say(`${args.demo ? "Demo run, no call made. " : ""}Spent ${usdPrecise(summary.spentMicros)} of ${usdPrecise(summary.quotedMicros)} quoted. ${c.ok} found (${c.replayed} from a stored result), ${c.failed} failed, ${c.pending} still running, ${c.skippedByCap} left at the cap, ${c.skippedByBudget} left at the period budget.`);
    if (c.pending > 0) say("A run that is still going is not a failure. Its money is held. Run the same command again later to collect it at no extra charge.");
    if (summary.budgetMessage) say(summary.budgetMessage);
    if (summary.aborted) say(summary.aborted);
    const done = people.filter((p) => p.enriched_at);
    write(args, "network-enrich", done, peopleToMarkdown("Enriched people", done, { max: args.limit }), { quotedMicros: summary.quotedMicros, spentMicros: summary.spentMicros, counts: c, demo: args.demo }, say);
    return summary.aborted || summary.budgetMessage ? 2 : 0;
  } catch (e) {
    say(e instanceof GranolaApiError ? `Granola answered ${e.status}${e.status === 401 || e.status === 403 ? ", so the key was refused" : ""}.` : (e as Error).message);
    return 1;
  }
}

if (process.argv[1] && /cli\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
