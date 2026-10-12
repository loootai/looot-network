#!/usr/bin/env bash
# Runs the migrations on a throwaway Postgres and checks them: row level security on every table, the search
# function against the in-memory search on the demo people, the budget functions, and the money constraints.
# Needs initdb, pg_ctl and psql on PATH (brew install postgresql@17). Touches no Supabase project. Needs no Docker.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v initdb >/dev/null 2>&1; then
  for d in /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@15/bin /usr/lib/postgresql/*/bin; do
    [ -x "$d/initdb" ] && PATH="$d:$PATH" && break
  done
fi
for bin in initdb pg_ctl psql; do
  command -v "$bin" >/dev/null 2>&1 || { echo "SKIPPED: $bin not found. Install PostgreSQL to run this check."; exit 0; }
done
dir="$root/.pgtest"
port="${PGPORT_TEST:-55442}"
rm -rf "$dir"; mkdir -p "$dir"
cleanup() { pg_ctl -D "$dir/db" stop -m fast >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
initdb -D "$dir/db" -U postgres -A trust >/dev/null
pg_ctl -D "$dir/db" -o "-p $port -k '' -c listen_addresses=127.0.0.1" -l "$dir/log" -w start >/dev/null
p() { psql -X -q -h 127.0.0.1 -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
p -f "$root/supabase/tests/auth_stub.sql"
for f in "$root"/supabase/migrations/*.sql; do p -f "$f"; done
p -c "grant usage on schema public to authenticated"
( cd "$root" && node_modules/.bin/tsx scripts/sqlParity.ts ) > "$dir/parity.sql"
out="$( { p -f "$dir/parity.sql"; p -f "$root/supabase/tests/checks.sql"; } 2>&1 | sed -E "s/^psql:.*NOTICE:  //")"
echo "$out"
fail() { echo "SQL check FAILED: $1"; exit 1; }
[[ "$out" != *"PARITY FAIL"* ]] || fail "search_people and the in-memory search disagree"
[[ "$(grep -c 'PARITY ok' <<<"$out")" == "15" ]] || fail "expected 15 parity checks"
for t in people imports person_sources saved_searches enrichments settings budget_reservations; do
  [[ "$out" == *"user2 sees 0 rows in $t"* ]] || fail "user 2 can read $t"
  [[ "$out" == *"user2 updated 0 rows in $t"* ]] || fail "user 2 can update $t"
  [[ "$out" == *"user2 deleted 0 rows in $t"* ]] || fail "user 2 can delete $t"
  [[ "$out" == *"forged owner refused: $t"* ]] || fail "forged owner_id accepted in $t"
done
for m in "user2 search sees 0 of 200" "user2 company_groups sees 0" "user1 search sees 200" "anon refused" "duplicate linkedin refused" "reserve ok" "reserve shared" "daily budget refused" "monthly budget refused" "release frees the budget" "settle counts as used" "two reservations cannot both pass" "settled key not charged again" "cost above nothing refused" "daily above monthly refused" "hostile text matched nothing" "tables without rls|0" "tables without forced rls|0" "public tables|7"; do
  [[ "$out" == *"$m"* ]] || fail "missing: $m"
done
echo "SQL check passed: 7 tables, 15 search parity queries, budget functions"
