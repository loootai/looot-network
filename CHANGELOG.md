# Changelog

## 0.1.0

First release.

- Import LinkedIn Connections.csv (notes lines above the header handled), Google Contacts CSV, X following.js and any CSV with a column mapping step.
- Dedupe by email, LinkedIn URL, or name and company, inside a file and against what is stored.
- Supabase schema with row-level security per owner, full-text search, pg_trgm fuzzy match, and a rule-based plain-language query parser.
- Sidebar app: People, Search, Companies, Imports, Enrich, Settings. Profile drawer, saved searches, CSV export.
- Optional enrichment through looot (LinkedIn profile, company firmographics, work email) with a quote first, a per-run cap, a daily and monthly budget reserved atomically, one idempotency key per call, and pending runs held rather than failed.
- Sign-in allow-list (LOOOT_NETWORK_ALLOWED_EMAILS), same-origin and JSON checks on every state-changing request, security headers.
- Headless CLI with `--dry-run`, and a demo mode on 200 invented people.
