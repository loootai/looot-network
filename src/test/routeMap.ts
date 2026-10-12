import fs from "node:fs";
import path from "node:path";
import { isPublicPath, PUBLIC_ROUTES } from "../lib/routes";

export interface RouteEntry {
  /** URL path such as /api/people/[id]. */
  url: string;
  file: string;
  methods: string[];
}

const ROOT = path.resolve(import.meta.dirname, "..", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const urlOf = (file: string) => "/" + path.relative(ROOT, path.dirname(file)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).join("/");

/** Every route handler under src/app, read from the file tree so a new route is picked up with no edit here. */
export function routeMap(): RouteEntry[] {
  return walk(ROOT)
    .filter((f) => /[\\/]route\.ts$/.test(f))
    .map((file) => {
      const src = fs.readFileSync(file, "utf8");
      const methods = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      return { url: urlOf(file), file, methods };
    })
    .sort((a, b) => a.url.localeCompare(b.url));
}

/** Every page.tsx and the layout of the private group, with the source text, so a page that skips the gate fails the test. */
export function pageMap(): { url: string; file: string; src: string; isPublic: boolean }[] {
  return walk(ROOT)
    .filter((f) => /[\\/](page|layout)\.tsx$/.test(f) && f !== path.join(ROOT, "layout.tsx"))
    .map((file) => ({ url: urlOf(file) + (file.endsWith("layout.tsx") ? " (layout)" : ""), file, src: fs.readFileSync(file, "utf8"), isPublic: isPublicPath(urlOf(file)) }));
}

export { PUBLIC_ROUTES };

/** Names of the exported server actions in src/app/actions.ts. */
export function actionNames(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "actions.ts"), "utf8");
  return [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
}
