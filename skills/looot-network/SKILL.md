---
name: looot-network
description: Search someone's own exported network (LinkedIn Connections.csv, Google Contacts CSV, X following.js, any CSV) in plain language, and optionally enrich people through looot with a quote first. Use when asked to find people in a contact list, "who do I know at X", "founders in Paris", or to replace a Happenstance-style network search.
---

# looot-network

Runs the looot-network CLI from a clone of https://github.com/loootai/looot-network. Node 20.9+, `npm install --ignore-scripts`.

The user exports their own files. Never scrape LinkedIn, never ask for a password, never ask for a LinkedIn login. If they have no export yet, point them to "Imports" in the README for how to get each one.

1. See what is in the files. No token, no cost:
   `npm run network -- import <Connections.csv> [contacts.csv ...]`
   Report the counts it prints: people, new, already known, skipped.
2. Search in plain language:
   `npm run network -- search "founders in Paris at fintech" <files...>`
   The line "Read as:" says how the rules read the query (role, place, company, tag, source, email flags). If it reads wrongly, rewrite the query. Results are in `out/network-search.md`, `.csv` and `.json`.
3. Enrichment is optional and paid. Quote first, no charge:
   `npm run network -- enrich <files...> --query "<query>" --kinds profile,email --max-spend 1 --dry-run`
   Show the user the table and the total. Ask before spending.
4. Real run, needs `LOOOT_TOKEN` in the environment:
   `npm run network -- enrich <files...> --query "<query>" --kinds profile --max-spend 1`
   Exit code 2 means refused (no token, over the budget, bad token). Do not raise `--max-spend` on your own. A line saying calls are "still running" is not a failure: run the same command again later and it collects them at no extra charge.
5. A fact is only reported when a file or a looot answer gave it. A person with no place has no place in the files; LinkedIn's Connections.csv has no locations.

Try it without a key: add `--demo` instead of files. The web app (`npm run demo`) shows the same engine in a sidebar UI.
