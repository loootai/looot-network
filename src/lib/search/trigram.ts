/** Trigrams the way pg_trgm builds them: words are split on non-alphanumerics, each padded with two spaces in front and one behind. */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
};

/** pg_trgm similarity(): shared trigrams over all distinct trigrams. */
export const similarity = (a: string, b: string) => jaccard(trigrams(a), trigrams(b));

/**
 * An approximation of pg_trgm word_similarity(): the best similarity between the first text and one word, or two
 * neighbouring words, of the second. The database function is the reference, this one drives the demo and the CLI.
 */
export function wordSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const words = b.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let best = 0;
  for (let i = 0; i < words.length; i++) {
    best = Math.max(best, jaccard(ta, trigrams(words[i])));
    if (i + 1 < words.length) best = Math.max(best, jaccard(ta, trigrams(`${words[i]} ${words[i + 1]}`)));
  }
  return best;
}
