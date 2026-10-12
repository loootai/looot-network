#!/usr/bin/env node
// Takes the README screenshots from a running demo server with headless Chrome.
// Uses only Node built-ins (Node 22+) and the Chrome DevTools protocol, no browser package.
//   NEXT_PUBLIC_DEMO=1 npm run build && NEXT_PUBLIC_DEMO=1 npx next start -p 3277
//   node scripts/screenshots.mjs http://localhost:3277 docs/screenshots [name-filter]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3277";
const out = process.argv[3] ?? "docs/screenshots";
const only = process.argv[4];
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = Number(process.env.CDP_PORT ?? 9347);
const D = { w: 1440, h: 900, mobile: false };
const M = { w: 390, h: 844, mobile: true };

const click = (text, sel = "button,a,[role=tab],[role=radio]") => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent !== null && e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return "missing: ${text}"; el.click(); return "ok"; })()`;
const key = (k) => `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`;

/** name, path, viewport, steps run after load (strings are evaluated, numbers are waits in ms, {upload} sets a file input). */
const FIRST = "00000000-0000-4000-8000-000000000001";
const SHOTS = [
  ["people", "/", D],
  ["people-drawer", `/?person=${FIRST}`, D, [900]],
  ["people-filtered", "/?q=climate&source=linkedin&email=1", D],
  ["search", "/search", D],
  ["search-results", "/search?q=founders%20in%20Paris%20at%20fintech", D],
  ["search-company", "/search?q=who%20works%20at%20Brightwell", D],
  ["companies", "/companies", D],
  ["imports", "/imports", D],
  ["imports-preview", "/imports", { ...D, h: 1250 }, [{ upload: "examples/linkedin-Connections.example.csv" }, 1500]],
  ["imports-mapping", "/imports", { ...D, h: 1500 }, [{ upload: "examples/generic.example.csv" }, 1500]],
  ["enrich", "/enrich", D],
  ["enrich-quote", "/enrich", { ...D, h: 1300 }, [click("Get the quote"), 1500]],
  ["enrich-quote-all", "/enrich", { ...D, h: 1500 }, [click("Company firmographics", "label"), click("Work email from the LinkedIn profile", "label"), click("Get the quote"), 1500]],
  ["settings", "/settings", D],
  ["people-dark", "/?theme=dark", D, [500]],
  ["people-drawer-dark", `/?person=${FIRST}&theme=dark`, D, [1200]],
  ["search-results-dark", "/search?q=founders%20in%20Paris%20at%20fintech&theme=dark", D, [500]],
  ["enrich-quote-dark", "/enrich?theme=dark", { ...D, h: 1300 }, [500, click("Get the quote"), 1500]],
  ["settings-dark", "/settings?theme=dark", D, [500]],
  ["m-people", "/", M],
  ["m-people-drawer", `/?person=${FIRST}`, M, [900]],
  ["m-search", "/search", M],
  ["m-search-results", "/search?q=founders%20in%20Paris%20at%20fintech", M],
  ["m-companies", "/companies", M],
  ["m-imports", "/imports", M],
  ["m-enrich-quote", "/enrich", M, [click("Get the quote"), 1500]],
  ["m-settings", "/settings", M],
  ["m-people-dark", "/?theme=dark", M, [500]],
  ["m-search-results-dark", "/search?q=founders%20in%20Paris%20at%20fintech&theme=dark", M, [500]],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(path.join(process.cwd(), ".shots-profile-"));
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const stop = () => {
  proc.kill();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Chrome may still be writing its profile. The OS clears the temp folder later.
  }
};
process.on("exit", stop);

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await sleep(200);
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  } catch { ws = undefined; }
}
if (!ws) throw new Error("Chrome did not start");
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const n = ++id;
  waiting.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});

mkdirSync(out, { recursive: true });
const report = [];
for (const [name, url, vp, steps = []] of SHOTS) {
  if (only && !name.includes(only)) continue;
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: vp.mobile ? 2 : 1, mobile: vp.mobile });
  if (vp.mobile) await s("Emulation.setTouchEmulationEnabled", { enabled: true });
  await s("Page.navigate", { url: base + url });
  await sleep(1800);
  const notes = [];
  for (const step of steps) {
    if (typeof step === "number") await sleep(step);
    else if (typeof step === "object") {
      const doc = await s("DOM.getDocument", {});
      const node = await s("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
      await s("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [path.resolve(step.upload)] });
      await sleep(250);
    } else {
      const r = await s("Runtime.evaluate", { expression: step, returnByValue: true });
      if (typeof r.result.value === "string" && r.result.value.startsWith("missing")) notes.push(r.result.value);
      await sleep(250);
    }
  }
  const overflow = await s("Runtime.evaluate", { expression: "document.documentElement.scrollWidth - window.innerWidth", returnByValue: true });
  if (overflow.result.value > 0) notes.push(`page scrolls sideways by ${overflow.result.value}px`);
  if (process.env.EVAL) notes.push(JSON.stringify((await s("Runtime.evaluate", { expression: process.env.EVAL, returnByValue: true })).result.value));
  const shot = await s("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(out, `${name}.png`), Buffer.from(shot.data, "base64"));
  await send("Target.closeTarget", { targetId });
  report.push(`${name}${notes.length ? `  !! ${notes.join("; ")}` : ""}`);
}
console.log(report.join("\n"));
ws.close();
stop();
process.exit(0);
