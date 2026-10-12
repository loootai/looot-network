import type { SourceKind } from "../types";

/** A search after the rule-based parser has read it. Categories are joined with AND, values inside one category with OR. */
export interface ParsedQuery {
  raw: string;
  /** Role words matched as whole words against title and headline. */
  roles: string[];
  /** Company names. A person matches when the company contains it, or when the word appears in their profile text. */
  companies: string[];
  locations: string[];
  /** Free words, each matched as a prefix of a word in the profile text, with a fuzzy fallback on names. */
  terms: string[];
  name: string | null;
  hasEmail: boolean | null;
  hasLinkedin: boolean | null;
  sources: SourceKind[];
  tags: string[];
  isEmpty: boolean;
  /** One line per filter the parser found, shown under the search box so the reading is never hidden. */
  explain: string[];
}

/** Role words and the title text each one stands for. */
export const ROLE_GROUPS: Record<string, string[]> = {
  founder: ["founder", "co-founder", "cofounder"],
  ceo: ["ceo", "chief executive"],
  cto: ["cto", "chief technology"],
  cfo: ["cfo", "chief financial"],
  coo: ["coo", "chief operating"],
  cmo: ["cmo", "chief marketing"],
  vp: ["vp", "vice president"],
  head: ["head of"],
  director: ["director"],
  manager: ["manager"],
  engineer: ["engineer", "developer", "software engineer"],
  designer: ["designer", "design lead"],
  "product manager": ["product manager", "product owner"],
  investor: ["investor", "venture", "vc", "angel", "partner at"],
  recruiter: ["recruiter", "talent", "sourcer"],
  sales: ["sales", "account executive", "business development"],
  marketing: ["marketing", "growth"],
  consultant: ["consultant", "advisor", "adviser"],
  researcher: ["researcher", "scientist", "professor", "phd"],
  "data scientist": ["data scientist", "machine learning", "ml engineer"],
  owner: ["owner", "president", "managing director"],
};

/** Spoken forms to the key of ROLE_GROUPS. Longest phrases are tried first. */
const ROLE_WORDS: [RegExp, string][] = [
  [/\bproduct managers?\b|\bpms?\b/, "product manager"],
  [/\bdata scientists?\b/, "data scientist"],
  [/\bhead of ([a-z]+)\b/, "head"],
  [/\bco-?founders?\b|\bfounders?\b/, "founder"],
  [/\bceos?\b|\bchief executives?\b/, "ceo"],
  [/\bctos?\b/, "cto"],
  [/\bcfos?\b/, "cfo"],
  [/\bcoos?\b/, "coo"],
  [/\bcmos?\b/, "cmo"],
  [/\bvps?\b|\bvice presidents?\b/, "vp"],
  [/\bdirectors?\b/, "director"],
  [/\bmanagers?\b/, "manager"],
  [/\bengineers?\b|\bdevelopers?\b|\bprogrammers?\b/, "engineer"],
  [/\bdesigners?\b/, "designer"],
  [/\binvestors?\b|\bvcs?\b|\bangels?\b/, "investor"],
  [/\brecruiters?\b/, "recruiter"],
  [/\bsales\b|\baccount executives?\b/, "sales"],
  [/\bmarketers?\b|\bmarketing\b/, "marketing"],
  [/\bconsultants?\b|\badvis[eo]rs?\b/, "consultant"],
  [/\bresearchers?\b|\bscientists?\b|\bprofessors?\b/, "researcher"],
  [/\bowners?\b|\bpresidents?\b/, "owner"],
];

const SOURCE_WORDS: [RegExp, SourceKind][] = [
  [/\blinkedin\b/, "linkedin"],
  [/\bgoogle(?: contacts)?\b|\bgmail\b/, "google"],
  [/\b(?:x|twitter)(?: following)?\b/, "x"],
  [/\bgranola\b/, "granola"],
  [/\bcsv\b/, "csv"],
];

const FILLER = new Set(["who", "whom", "whose", "people", "person", "everyone", "anyone", "someone", "anybody", "show", "me", "find", "list", "get", "all", "my", "our", "the", "a", "an", "contacts", "contact", "connections", "connection", "network", "that", "which", "are", "is", "do", "does", "work", "works", "working", "worked", "job", "jobs", "have", "has", "had", "know", "knows", "i", "we", "of", "for", "to", "and", "or", "with", "in", "at", "from", "named", "called", "tagged", "based", "near", "without", "no", "email", "emails", "linkedin"]);

const KEYWORD = /\b(?:in|at|from|with|without|who|that|which|named|called|tagged|based|near|and|working|works|work)\b|[@,]/;

/** The words after a keyword up to the next keyword, split on "or" and commas. */
function phraseAfter(rest: string): { values: string[]; consumed: number } {
  const m = rest.match(/^\s*([^,@]*?)(?=\s+(?:in|at|from|with|without|who|that|which|named|called|tagged|based|near|and|working|works|work)\b|[@,]|$)/);
  const text = (m?.[1] ?? "").trim();
  const values = text.split(/\s+or\s+/).map((v) => v.replace(/^(the|a|an)\s+/, "").trim()).filter((v) => v && !FILLER.has(v));
  return { values, consumed: m ? m[0].length : 0 };
}

/**
 * Reads a plain-language search with fixed rules and no model. It finds roles ("founders", "CTOs"), places ("in Paris",
 * "based in Lisbon"), companies ("at Stripe", "works at Google or Meta"), flags ("with email"), sources ("from LinkedIn"),
 * tags ("tagged fintech", "#intro") and names ("named Ada Lovelace"). Whatever is left becomes free-text terms.
 */
export function parseQuery(input: string): ParsedQuery {
  const raw = input.slice(0, 500);
  let s = ` ${raw.toLowerCase().replace(/[“”"]/g, " ").replace(/\s+/g, " ").trim()} `;
  const out: ParsedQuery = { raw, roles: [], companies: [], locations: [], terms: [], name: null, hasEmail: null, hasLinkedin: null, sources: [], tags: [], isEmpty: false, explain: [] };

  // Hash tags.
  s = s.replace(/#([a-z0-9][a-z0-9_-]*)/g, (_, t: string) => {
    out.tags.push(t);
    return " ";
  });
  // Flags.
  s = s.replace(/\bwithout (?:an? )?e-?mails?\b/, () => ((out.hasEmail = false), " "));
  s = s.replace(/\bwith (?:an? )?(?:known )?e-?mails?\b/, () => ((out.hasEmail = true), " "));
  s = s.replace(/\b(?:with|has|have) (?:a )?linkedin(?: profile| url)?\b/, () => ((out.hasLinkedin = true), " "));
  // Sources: "from linkedin", "imported from google".
  s = s.replace(/\b(?:imported )?from ((?:linkedin|google contacts|google|gmail|x following|twitter|x|csv))\b/g, (_, w: string) => {
    for (const [re, k] of SOURCE_WORDS) if (re.test(w) && !out.sources.includes(k)) out.sources.push(k);
    return " ";
  });
  // Names.
  s = s.replace(/\b(?:named|called) ([a-z'’.-]+(?: [a-z'’.-]+){0,2})\b/, (_, n: string) => {
    out.name = n.trim();
    return " ";
  });
  // Tags.
  s = s.replace(/\btagged ([a-z0-9][a-z0-9_-]*)\b/g, (_, t: string) => {
    out.tags.push(t);
    return " ";
  });
  // Places and companies: scan the keywords left to right.
  const kw = /\b(based in|located in|living in|lives in|near|in|from|works at|work at|working at|worked at|employed at|at|for)\b|@/g;
  let rebuilt = "";
  let last = 0;
  for (let m = kw.exec(s); m; m = kw.exec(s)) {
    const key = m[0];
    const before = s.slice(last, m.index);
    const { values, consumed } = phraseAfter(s.slice(m.index + key.length));
    const place = /^(based in|located in|living in|lives in|near|in|from)$/.test(key);
    const company = /^(works at|work at|working at|worked at|employed at|at|for|@)$/.test(key);
    if (!values.length || (key === "for" && !values.length)) continue;
    rebuilt += before + " ";
    last = m.index + key.length + consumed;
    kw.lastIndex = last;
    for (const v of values) {
      const list = place ? out.locations : company ? out.companies : null;
      if (list && !list.includes(v)) list.push(v);
    }
  }
  rebuilt += s.slice(last);
  s = ` ${rebuilt} `;

  // Roles.
  for (const [re, group] of ROLE_WORDS) {
    s = s.replace(re, (whole, arg?: string) => {
      const words = group === "head" && arg ? [`head of ${arg}`] : ROLE_GROUPS[group];
      for (const w of words) if (!out.roles.includes(w)) out.roles.push(w);
      return " ".repeat(whole.length);
    });
  }

  // What is left.
  for (const w of s.split(/[^a-z0-9À-ɏ'’+.-]+/).map((x) => x.replace(/^['’.+-]+|['’.+-]+$/g, ""))) {
    if (!w || FILLER.has(w) || KEYWORD.test(` ${w} `) && w.length < 3) continue;
    if (!out.terms.includes(w)) out.terms.push(w);
  }

  if (out.roles.length) out.explain.push(`role: ${out.roles.join(", ")}`);
  if (out.locations.length) out.explain.push(`place: ${out.locations.join(" or ")}`);
  if (out.companies.length) out.explain.push(`company: ${out.companies.join(" or ")}`);
  if (out.name) out.explain.push(`name: ${out.name}`);
  if (out.tags.length) out.explain.push(`tag: ${out.tags.join(", ")}`);
  if (out.sources.length) out.explain.push(`source: ${out.sources.join(", ")}`);
  if (out.hasEmail !== null) out.explain.push(out.hasEmail ? "has an email" : "has no email");
  if (out.hasLinkedin) out.explain.push("has a LinkedIn URL");
  if (out.terms.length) out.explain.push(`words: ${out.terms.join(", ")}`);
  out.isEmpty = !out.explain.length;
  return out;
}
