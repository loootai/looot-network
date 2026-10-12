import { describe, expect, it } from "vitest";
import { seedDemo } from "@/demo/seed";
import { companyGroups, searchMemory } from "./memory";
import { rpcParams, specFrom } from "./spec";
import { similarity, trigrams, wordSimilarity } from "./trigram";

const { people } = seedDemo();
const run = (q: string, ui = {}) => searchMemory(people, specFrom(q, ui, { limit: 500 }));

describe("seed", () => {
  it("has 200 invented people with example.com addresses only", () => {
    expect(people).toHaveLength(200);
    for (const p of people) for (const e of p.emails) expect(e).toMatch(/@[a-z0-9-]+\.example\.com$/);
    expect(new Set(people.map((p) => p.id)).size).toBe(200);
  });
});

describe("memory search", () => {
  it("founders in Paris at fintech", () => {
    const r = run("founders in Paris at fintech");
    expect(r.total).toBeGreaterThan(0);
    for (const p of r.people) {
      expect(`${p.title} ${p.headline}`).toMatch(/founder/i);
      expect(p.location).toMatch(/Paris/);
      expect(`${p.company} ${p.headline} ${p.tags.join(" ")}`.toLowerCase()).toContain("fintech");
    }
  });
  it("who works at Stripe finds nobody in the demo, and who works at Brightwell finds that company", () => {
    expect(run("who works at Stripe").total).toBe(0);
    const r = run("who works at Brightwell");
    expect(r.total).toBeGreaterThan(5);
    expect(r.people.every((p) => /brightwell/i.test(p.company ?? "") || /brightwell/i.test(p.headline ?? ""))).toBe(true);
  });
  it("narrows with every filter and ignores letter case", () => {
    const all = run("investors").total;
    expect(run("INVESTORS in london").total).toBeLessThanOrEqual(all);
    const withEmail = run("engineers with email");
    expect(withEmail.people.every((p) => p.email)).toBe(true);
    expect(run("people from linkedin").people.every((p) => p.source_kinds.includes("linkedin"))).toBe(true);
  });
  it("finds a person by a typo in the name", () => {
    const target = people.find((p) => p.first_name === "Odile")!;
    expect(run("Odille").people.some((p) => p.id === target.id)).toBe(true);
  });
  it("blank search returns everyone, paged, with the total", () => {
    const s = searchMemory(people, specFrom("", {}, { limit: 25, offset: 50, sort: "name" }));
    expect(s.total).toBe(200);
    expect(s.people).toHaveLength(25);
    const names = s.people.map((p) => p.full_name.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  it("control filters narrow the text", () => {
    const a = run("", { company: "Brightwell Payments" });
    expect(a.total).toBeGreaterThan(5);
    expect(a.people.every((p) => p.company === "Brightwell Payments")).toBe(true);
    expect(run("", { tags: ["Climate"] }).people.every((p) => p.tags.includes("climate"))).toBe(true);
  });
  it("groups companies", () => {
    const g = companyGroups(people);
    expect(g.reduce((n, c) => n + c.people, 0)).toBe(people.filter((p) => p.company).length);
    expect(g[0].people).toBeGreaterThanOrEqual(g[1].people);
    expect(companyGroups(people, "bright")[0].company).toBe("Brightwell Payments");
  });
});

describe("rpcParams", () => {
  it("passes the parsed filters as parameters and nothing else", () => {
    const p = rpcParams(specFrom("founders in Paris at fintech with email", { sources: ["linkedin"], company: "Acme Inc" }, { sort: "recent", limit: 10, offset: 20 }));
    expect(p).toEqual({
      p_terms: [],
      p_roles: ["founder", "co-founder", "cofounder"],
      p_companies: ["fintech"],
      p_locations: ["paris"],
      p_name: null,
      p_company_exact: "acme inc",
      p_has_email: true,
      p_has_linkedin: null,
      p_sources: ["linkedin"],
      p_tags: [],
      p_sort: "recent",
      p_limit: 10,
      p_offset: 20,
    });
  });
  it("keeps hostile text as data and caps the page size", () => {
    const p = rpcParams(specFrom("'; drop table people; --", {}, { limit: 99999 }));
    expect(p.p_terms).toEqual(["drop", "table"]);
    expect(p.p_limit).toBe(5000);
    expect(JSON.stringify(p)).not.toContain(";");
  });
});

describe("trigram", () => {
  it("matches pg_trgm on a known pair", () => {
    // pg_trgm: show_trgm('cat') is {"  c"," ca","cat","at "}. 'cats' adds "ats" and "ts ", so 3 shared of 6 distinct is 0.5.
    expect([...trigrams("cat")].sort()).toEqual(["  c", " ca", "at ", "cat"]);
    expect(similarity("cat", "cats")).toBe(0.5);
    expect(wordSimilarity("paris", "Paris, France")).toBe(1);
    expect(wordSimilarity("zzz", "Paris")).toBe(0);
  });
});
