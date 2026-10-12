// Runs before `npm run demo`. The demo has no sign-in, so it refuses to start next to real credentials:
// anyone who reached it could read a real project or spend a real balance.
const env = process.env;
const real = [];
if (env.LOOOT_TOKEN?.trim()) real.push("LOOOT_TOKEN is set");
const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
if (url && !/\.invalid\b|YOUR-PROJECT/i.test(url)) real.push("NEXT_PUBLIC_SUPABASE_URL points at a project");
if (real.length > 0) {
  console.error(`The demo has no sign-in and will not start next to real credentials (${real.join(", ")}).`);
  console.error("Run it in a shell where those are unset, or run the real app with LOOOT_NETWORK_ALLOWED_EMAILS set.");
  process.exit(1);
}
