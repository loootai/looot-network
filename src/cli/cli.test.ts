import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, parseArgs, stableId } from "./cli";

const ex = (f: string) => path.resolve(import.meta.dirname, "../../examples", f);
let out: string;
let lines: string[];
const say = (s: string) => void lines.push(s);
const run = (argv: string[], env: Record<string, string | undefined> = {}) => main([...argv, "--out", out], env, say);

beforeEach(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), "network-cli-"));
  lines = [];
  process.env.LOOOT_NETWORK_DIR = path.join(out, "state");
});
afterEach(() => {
  fs.rmSync(out, { recursive: true, force: true });
  delete process.env.LOOOT_NETWORK_DIR;
});

describe("parseArgs", () => {
  it("reads a command, a query and files", () => {
    const a = parseArgs(["search", "founders in Paris", "a.csv", "b.csv", "--limit", "5"]);
    expect(a).toMatchObject({ command: "search", query: "founders in Paris", files: ["a.csv", "b.csv"], limit: 5 });
  });
  it("throws on a typo instead of running with defaults", () => {
    expect(() => parseArgs(["enrich", "--max-sped", "5"])).toThrow(/Unknown option --max-sped/);
    expect(() => parseArgs(["enrich", "--kinds", "phone"])).toThrow(/Unknown lookup phone/);
    expect(() => parseArgs(["enrich", "--max-spend", "abc"])).toThrow(/dollar amount/);
    expect(() => parseArgs(["frobnicate"])).toThrow(/Unknown command/);
  });
});

describe("import", () => {
  it("reads three files, dedupes across them and writes json, csv and markdown", async () => {
    const code = await run(["import", ex("linkedin-Connections.example.csv"), ex("google-contacts.example.csv"), ex("generic.example.csv")]);
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/linkedin-Connections\.example\.csv: linkedin, 4 rows, 4 new/);
    expect(lines.join("\n")).toMatch(/google-contacts\.example\.csv: google, 3 rows, 2 new, 1 already known/);
    const json = JSON.parse(fs.readFileSync(path.join(out, "network-people.json"), "utf8"));
    expect(json.count).toBe(7);
    expect(fs.readFileSync(path.join(out, "network-people.csv"), "utf8").split("\n")[0]).toBe("full_name,email,company,title,location,linkedin_url,tags,source_kinds,connected_on");
    expect(fs.readFileSync(path.join(out, "network-people.md"), "utf8")).toContain("| Odile Fenwick-Marsh |");
  });
  it("gives the same ids for the same file, so idempotency keys stay stable", async () => {
    await run(["import", ex("linkedin-Connections.example.csv"), "--format", "json"]);
    const a = JSON.parse(fs.readFileSync(path.join(out, "network-people.json"), "utf8")).people.map((p: { id: string }) => p.id);
    await run(["import", ex("linkedin-Connections.example.csv"), "--format", "json"]);
    const b = JSON.parse(fs.readFileSync(path.join(out, "network-people.json"), "utf8")).people.map((p: { id: string }) => p.id);
    expect(a).toEqual(b);
    expect(a[0]).toBe(stableId({ full_name: "Odile Fenwick-Marsh", emails: [], phones: [], tags: [], source: "linkedin", raw: {}, linkedin_url: "https://www.linkedin.com/in/odile-fenwick-marsh-example" }));
  });
  it("reports a missing file as an error", async () => {
    expect(await run(["import", "nope.csv"])).toBe(1);
  });
});

describe("search", () => {
  it("answers a plain-language query and says how it read it", async () => {
    const code = await run(["search", "founders in Paris", ex("linkedin-Connections.example.csv"), ex("google-contacts.example.csv")]);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Read as: role: founder, co-founder, cofounder; place: paris");
    const json = JSON.parse(fs.readFileSync(path.join(out, "network-search.json"), "utf8"));
    expect(json.people.map((p: { full_name: string }) => p.full_name)).toEqual(["Odile Fenwick-Marsh"]);
  });
  it("runs on the demo people", async () => {
    expect(await run(["search", "who works at Brightwell", "--demo"])).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(out, "network-search.json"), "utf8")).count).toBeGreaterThan(5);
  });
});

describe("enrich", () => {
  it("--dry-run prints the list-price cost and makes no call, with or without a token", async () => {
    const code = await run(["enrich", ex("linkedin-Connections.example.csv"), "--kinds", "profile,email", "--dry-run", "--offline"], { LOOOT_TOKEN: "tok_real" });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toMatch(/LinkedIn profile: current company, title, place\s+anyapi\s+\$0\.0012 x\s+3 = \s+\$0\.0036/);
    // 3 profile calls at $0.0012 and 2 email calls at $0.003598 (Teodor has an email, Ibrahim has no LinkedIn URL).
    expect(text).toContain("Quoted $0.010796 at list price");
    expect(text).toContain("Dry run: no call was made and nothing was charged.");
    expect(fs.existsSync(path.join(out, "state", "budget.json"))).toBe(false);
  });
  it("refuses a real run without a token, with exit code 2", async () => {
    expect(await run(["enrich", ex("linkedin-Connections.example.csv"), "--offline"])).toBe(2);
    expect(lines.join("\n")).toContain("LOOOT_TOKEN is not set");
  });
  it("runs the demo with no charge and no token", async () => {
    expect(await run(["enrich", "--demo", "--query", "founders in Paris", "--kinds", "profile,company", "--format", "json"])).toBe(0);
    expect(lines.join("\n")).toMatch(/Demo run, no call made\. Spent \$0\.0000/);
  });
  it("refuses the demo next to a real token", async () => {
    expect(await run(["enrich", "--demo"], { LOOOT_TOKEN: "tok_real" })).toBe(2);
  });
});
