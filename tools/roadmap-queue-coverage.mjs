// tools/roadmap-queue-coverage.mjs — which registered ROADMAP items has NO queue row naming it?
//
// WHY (delegate-landed 2026-10-29; ROADMAP 231/256 family). Four consecutive delegate sessions re-derived the same
// fact by hand with a regex over `cli.mjs queue`: the roadmap keeps registering items (235-262 landed in one day)
// while the queue stays at **0 claimable**, so "the team will pick it up" is false by construction and `pm` is the
// only seat that can create the rows. This makes that question one command instead of a 21 MB dump and a regex, and
// it prints its denominator, per ROADMAP 257 (a rate without a denominator is a defect).
//
// READ-ONLY: it opens the store via `cli.mjs queue` (the CLI's own reader) and never writes. It does NOT decide
// priority — releases and decomposition are `pm`'s verbs (docs/WORK-ITEM-LIFECYCLE.md).
//
// Usage: node tools/roadmap-queue-coverage.mjs [--min N] [--json] [--quiet]

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const minIdx = argv.indexOf("--min");
const MIN = minIdx >= 0 ? Number(argv[minIdx + 1]) : 200;
const json = argv.includes("--json");
const quiet = argv.includes("--quiet");
const t0 = Date.now();

// Registration forms actually present in docs/ROADMAP.md. Matching one form sees 87 of 263 items — the same trap
// doc-integrity-guard.mjs documents, so all three forms count here too.
const roadmap = readFileSync("docs/ROADMAP.md", "utf8");
const ids = new Set();
for (const re of [/^\*\*(\d{1,4})\.\s/gm, /^(\d{1,4})\.\s/gm, /^\|\s*(\d{1,4})\s*\|/gm])
  for (const m of roadmap.matchAll(re)) ids.add(Number(m[1]));
const registered = [...ids].filter((n) => n >= MIN).sort((a, b) => a - b);

// `cli.mjs queue` prints one JSON document plus a trailing `note:` line, so parse the JSON prefix only
// (docs/SELFDEV.md pitfall: json.load(sys.stdin) dies with "Extra data").
const r = spawnSync(process.execPath, ["cli.mjs", "queue"], {
  env: { ...process.env, DURIG_DB: process.env.DURIG_DB || "./selfdev.sqlite" },
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
if (r.status !== 0) {
  console.error("cli.mjs queue failed:", (r.stderr || "").slice(0, 400));
  process.exit(1);
}
const text = r.stdout;
const doc = JSON.parse(text.slice(0, text.lastIndexOf("}") + 1));
const items = doc.items || [];

// Map: roadmap id -> rows whose subject or body names it. This is a NAME match, not a foreign key: a row can work an
// item without writing the word ROADMAP, so a zero here means "no row says so in the form we can see".
const rowsFor = new Map();
for (const it of items) {
  const hay = `${it.subject || ""} ${it.body || ""}`;
  for (const m of hay.matchAll(/ROADMAP[^0-9]{0,6}(\d{1,4})\b/g)) {
    const n = Number(m[1]);
    if (!rowsFor.has(n)) rowsFor.set(n, []);
    rowsFor.get(n).push(it);
  }
}

const byStatus = {};
for (const it of items) byStatus[it.status] = (byStatus[it.status] || 0) + 1;
const claimable = items.filter((i) => i.status === "queued" || i.status === "claimed").length;

const covered = registered.filter((n) => rowsFor.has(n));
const bare = registered.filter((n) => !rowsFor.has(n));

if (!quiet) {
  console.log(`ROADMAP/QUEUE COVERAGE  (registry >= ${MIN}; cost ${((Date.now() - t0) / 1000).toFixed(1)}s, one queue read)`);
  console.log(`  queue rows: ${items.length} — ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(", ")}; CLAIMABLE ${claimable}`);
  console.log(`  registered items >= ${MIN}: ${registered.length}; named by >=1 row: ${covered.length}; with NO row naming them: ${bare.length}`);
  for (const n of bare) console.log(`    NO ROW   ${n}`);
  for (const n of covered) {
    const rows = rowsFor.get(n);
    const term = rows.every((x) => x.status === "done" || x.status === "cancelled");
    console.log(`    rows for ${n}: ${rows.length} [${rows.map((x) => `#${x.id}:${x.status}`).join(", ")}]${term ? "  <- every row naming it is TERMINAL, so the item is not tracked live" : ""}`);
  }
  console.log(
    `  DENOMINATOR/Caveat: a row that works an item without writing "ROADMAP <n>" is invisible to this match; ` +
      `this counts NAMES, not ownership. Releases and decomposition are pm's verbs.`,
  );
}
if (json) console.log(JSON.stringify({ registered, covered, bare, claimable, statuses: byStatus, rowsFor: Object.fromEntries([...rowsFor].map(([k, v]) => [k, v.map(x => ({ id: x.id, status: x.status }))])) }));
