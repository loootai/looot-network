# Changelog

## Unreleased

- Fix sign-in and other form posts from Chrome refused with "Cross-site request refused". The app sends `Referrer-Policy: no-referrer`, so Chrome posts with `Origin: null`. The same-origin check now accepts `Origin: null` when `Sec-Fetch-Site` is `same-origin`, and still refuses it otherwise.
- README: banner, screenshots, demo video and a live company-enrichment run.

## 0.1.1

- Granola meeting import. People who attended your meetings become contacts with source "granola", the last-met date and meeting title kept as provenance, merged through the same dedupe path as the CSV sources. Server-side key (`GRANOLA_API_KEY`), `POST /api/import/granola` behind the allow-list, `import --granola` in the CLI with `--dry-run`, `--since`, `--exclude-domain` and `--self`. Migration `20261012000300_granola_source.sql` adds the source to the imports check.
- Demo mode shows the source with invented meetings.
- New skill `skills/looot-meeting-prep/`.
- Not tested against a live Granola account. Two response shapes (the list sample and `Retry-After`) were guessed from the docs. All HTTP in the tests is mocked.

## 0.1.0

First release.

- Import LinkedIn Connections.csv (notes lines above the header handled), Google Contacts CSV, X following.js and any CSV with a column mapping step.
- Dedupe by email, LinkedIn URL, or name and company, inside a file and against what is stored.
- Supabase schema with row-level security per owner, full-text search, pg_trgm fuzzy match, and a rule-based plain-language query parser.
- Sidebar app: People, Search, Companies, Imports, Enrich, Settings. Profile drawer, saved searches, CSV export.
- Optional enrichment through looot (LinkedIn profile, company firmographics, work email) with a quote first, a per-run cap, a daily and monthly budget reserved atomically, one idempotency key per call, and pending runs held rather than failed.
- Sign-in allow-list (LOOOT_NETWORK_ALLOWED_EMAILS), same-origin and JSON checks on every state-changing request, security headers.
- Headless CLI with `--dry-run`, and a demo mode on 200 invented people.
