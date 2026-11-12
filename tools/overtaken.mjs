#!/usr/bin/env node
// tools/overtaken.mjs — which backlog rows have been overtaken by events, and which only LOOK overtaken.
//
// The question this answers: "can any of these rows be cancelled or closed because the world moved on?"
// The trap it exists for: `check`'s `duplicate-item` rule prescribes "cancel #id as a duplicate of #twin",
// and on the live rig (2026-11-12T19:3xZ) 17 of the 18 exact-subject pairs had a CANCELLED twin — meaning
// the live row is the re-issue and the SURVIVOR, so following the rule would have destroyed 17 live
// intents. `src/overtaken.mjs` decides by the TWIN'S STATUS; this wrapper supplies the data.
//
// COST (measured on Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1):
//   ~6-8 s — six queue reads through the CLI (one per status) plus one `check` read. No git, no suite.
//
// Usage:
//   node tools/overtaken.mjs [--db ./selfdev.sqlite] [--json] [--limit 25]
//
// Exit: 0 always (it is a census, not a gate). The delegate/pm act on it; this tool cancels nothing.

import { spawnSync } from "node:child_process";
import { classifyOvertaken, verdictText } from "../src/overtaken.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const has = (name) => args.includes(name);
const DB = String(flag("--db", process.env.DURIG_DB || "./selfdev.sqlite"));
const LIMIT = Number(flag("--limit", 25));

function run(argv, { allowExit1 = false } = {}) {
  const r = spawnSync("node", argv, {
    capture: true,
    timeout: 120_000,
    encoding: "utf8",
    // `queue --status done` is ~5 MB on a 4,800-done rig; the default 1 MB buffer TRUNCATES it and the
    // truncation surfaces as "Unterminated string in JSON", which reads like store corruption (measured).
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DURIG_DB: DB },
  });
  // `check` exits 1 BY DESIGN when a rule finds an error-severity gap, and still writes its JSON
  // document on stdout. Treating that exit as a failure made every duplicate class empty — a silent
  // zero that reads exactly like "nothing to cancel" (measured 2026-11-12T19:3xZ).
  if (r.status !== 0 && !(allowExit1 && r.status === 1)) {
    throw new Error(`${argv.join(" ")} exit ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 200)}`);
  }
  return r.stdout;
}

function parseDoc(text) {
  const at = text.indexOf("{");
  if (at === -1) throw new Error("no JSON document in the reply");
  return JSON.parse(text.slice(at));
}

console.error(`[overtaken] reading the queue from ${DB} (six status reads + one check)…`);
const statuses = ["queued", "held", "deferred", "claimed", "done", "cancelled"];
const rows = [];
for (const status of statuses) {
  const doc = parseDoc(run(["cli.mjs", "queue", "--status", status, "--json", "--no-body"]));
  for (const r of doc.items ?? []) {
    rows.push({ id: String(r.id), status: r.status ?? status, blockedBy: (r.blockedBy ?? []).map(String), notice: r.notice === true, subject: r.subject ?? "" });
  }
}

// `check` is where the duplicate pairs are computed (the rule lives in src/checkup.mjs); reuse it rather
// than re-implementing the same-intent matcher a second time (a rule kept in two places drifts).
let findings = [];
try {
  const doc = parseDoc(run(["cli.mjs", "check", "--json"], { allowExit1: true }));
  findings = (doc.findings ?? []).filter((f) => f.id === "duplicate-item");
} catch (err) {
  console.error(`[overtaken] check could not run (${String(err.message).slice(0, 120)}); the duplicate classes will be empty`);
}
const duplicateFindings = findings.map((f) => {
  const twin = /terminal #(\d+)/.exec(f.detail ?? "");
  const overlap = /overlap ([0-9.]+)/.exec(f.detail ?? "");
  return { id: String(f.subject ?? "").replace("#", ""), twin: twin ? twin[1] : null, overlap: overlap ? Number(overlap[1]) : null };
});

const result = classifyOvertaken(rows, duplicateFindings);
console.error(`[overtaken] ${rows.length} rows read, ${duplicateFindings.length} duplicate findings`);

if (has("--json")) {
  console.log(JSON.stringify({ db: DB, rows: rows.length, ...result }, null, 2));
  process.exit(0);
}

console.log(`OVERTAKEN CENSUS  ${DB}  ${rows.length} rows  (${statuses.join("/")})`);
console.log(verdictText(result.counts));
for (const [name, list] of Object.entries(result.classes)) {
  if (list.length === 0) continue;
  const label =
    name === "settled-duplicate"
      ? "SAFE TO CANCEL — twin is DONE"
      : name === "survivor-of-cancel"
        ? "DO NOT CANCEL — twin is CANCELLED, this row is the re-issue"
        : name === "notice"
          ? "coordination notices (retention rule #7279, not overtaken)"
          : "gate already DONE — claimable, not blocked";
  console.log(`\n${label}: ${list.length}`);
  for (const row of list.slice(0, LIMIT)) {
    const extra = row.twin ? ` twin=#${row.twin}` : row.gateDone ? ` gate=${row.gateDone.map((g) => `#${g}`).join(",")}` : "";
    console.log(`  #${row.id} ${row.status}${extra}`);
  }
  if (list.length > LIMIT) console.log(`  … ${list.length - LIMIT} more (raise --limit)`);
}
console.log("\nnext: the delegate/pm cancels `safeCancelIds` only; the survivor list is evidence NOT to cancel.");
