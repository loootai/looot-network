import { describe, expect, it } from "vitest";
import { parseQuery, ROLE_GROUPS } from "./parse";

const q = (s: string) => parseQuery(s);

describe("parseQuery", () => {
  it("reads roles, a place and an 'at' phrase", () => {
    const r = q("founders in Paris at fintech");
    expect(r.roles).toEqual(ROLE_GROUPS.founder);
    expect(r.locations).toEqual(["paris"]);
    expect(r.companies).toEqual(["fintech"]);
    expect(r.terms).toEqual([]);
  });
  it("reads 'who works at Stripe'", () => {
    const r = q("who works at Stripe");
    expect(r.companies).toEqual(["stripe"]);
    expect(r.roles).toEqual([]);
    expect(r.terms).toEqual([]);
  });
  it("keeps multi-word places and companies, and splits on 'or'", () => {
    const r = q("engineers at Google or Meta in San Francisco");
    expect(r.roles).toEqual(ROLE_GROUPS.engineer);
    expect(r.companies).toEqual(["google", "meta"]);
    expect(r.locations).toEqual(["san francisco"]);
  });
  it("understands '@', 'from' and 'based in'", () => {
    expect(q("designers @ Figma").companies).toEqual(["figma"]);
    expect(q("people based in Lisbon").locations).toEqual(["lisbon"]);
    expect(q("investors from Berlin").locations).toEqual(["berlin"]);
  });
  it("reads flags and sources", () => {
    const r = q("CTOs with email from linkedin");
    expect(r.roles).toEqual(ROLE_GROUPS.cto);
    expect(r.hasEmail).toBe(true);
    expect(r.sources).toEqual(["linkedin"]);
    expect(q("anyone with linkedin").hasLinkedin).toBe(true);
    expect(q("people without email").hasEmail).toBe(false);
  });
  it("reads tags and names", () => {
    expect(q("tagged fintech").tags).toEqual(["fintech"]);
    expect(q("#investor-intro").tags).toEqual(["investor-intro"]);
    expect(q("named Odile Fenwick").name).toBe("odile fenwick");
  });
  it("sends everything it does not recognise to free-text terms", () => {
    const r = q("fintech payments");
    expect(r.terms).toEqual(["fintech", "payments"]);
    expect(r.roles).toEqual([]);
    expect(q("Odile").terms).toEqual(["odile"]);
  });
  it("combines a role with leftover words", () => {
    const r = q("head of engineering payments");
    expect(r.roles).toContain("head of engineering");
    expect(r.terms).toEqual(["payments"]);
  });
  it("handles plurals and capitalisation of roles", () => {
    expect(q("VPs").roles).toEqual(ROLE_GROUPS.vp);
    expect(q("Product Managers in London").roles).toEqual(ROLE_GROUPS["product manager"]);
  });
  it("returns an empty query for blank input and explains each filter", () => {
    expect(q("   ").isEmpty).toBe(true);
    const r = q("founders in Paris");
    expect(r.isEmpty).toBe(false);
    expect(r.explain).toEqual(["role: founder, co-founder, cofounder", "place: paris"]);
  });
  it("never throws on odd input", () => {
    for (const s of ["'; drop table people; --", "%%%", "in", "at", "with", "\\", "a".repeat(5000)]) expect(() => q(s)).not.toThrow();
  });
});
