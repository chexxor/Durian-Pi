#!/usr/bin/env node
// tools/backlog-burn.mjs — is the backlog actually shrinking, and at what rate?
//
// WHY THIS EXISTS (measured 2026-11-12, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0 — re-measure before quoting): `cli.mjs status` and `tools/queue-drain-audit.mjs` give a single
// census — a snapshot with no direction. "Finish the backlog" is a RATE question: rows close while new rows are
// minted, so a fleet can be busy every minute and still grow. `tools/broker-keepalive.mjs:272` already appends a
// queue snapshot every 10th tick to `.spike/fleet-ledger.jsonl`, so the rate is already recorded; this tool reads
// it back.
//
// Trigger symptom: "the team is busy but the queue never empties / nothing is ever finished".
// Cost: < 1 s (one BOUNDED read of the JSONL ledger — no store open, no git, no provider).
// Exit codes: 0 = read OK; 2 = usage / no ledger / no queue snapshots in it.
//
// usage:
//   node tools/backlog-burn.mjs [--ledger .spike/fleet-ledger.jsonl] [--hours N]
//
// THE ARITHMETIC IS NOT HERE. src/fleetledger.mjs `fleetLedgerVerdict` is the ONE derivation of "rows closed vs
// open rows vs GROWING"; `src/checkup.mjs`'s `queue-pressure` rule quotes that same `verdictLine`, so the tool's
// words and the gate's words cannot disagree (#5047). If this tool ever prints a sentence the rule does not quote
// verbatim, one of them has been re-spelled — fix the shared module, not the caller.
//
// Measured cost, re-run before quoting: 0.04 s against the live ledger (1,191 lines); host Linux, Fedora Linux 45
// (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0; `last_verified: 2026-11-15`.
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

import { fleetLedgerVerdict, readFleetLedger, LEDGER_STATES } from "../src/fleetledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

function arg(name, fallback) {
  const i = process.argv.findIndex((a) => a === name || a.startsWith(name + "="));
  if (i < 0) return fallback;
  return process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1];
}

const want = arg("--ledger", ".spike/fleet-ledger.jsonl");
const hours = Number(arg("--hours", 0));
// An absolute --ledger is read from where it is; a relative one is always relative to the repo the tool lives
// in, not the shell's cwd, so a session in a seat worktree still reads ITS fleet ledger.
const absolute = want.startsWith("/") || /^[A-Za-z]:[\\/]/.test(want);
const root = absolute ? dirname(want) : REPO;
const path = absolute ? basename(want) : want;

const record = readFleetLedger({ root, path });
if (!record.ok) {
  console.error(`cannot read ledger ${record.path}: ${record.reason ?? "unreadable"}`);
  process.exit(2);
}
const v = fleetLedgerVerdict(record.text, { hours });
if (!v) {
  console.error(`no queue snapshots in ${record.path} — run tools/broker-keepalive.mjs --once first`);
  process.exit(2);
}

const perHour = (d) => (v.spanMins > 0 ? d / (v.spanMins / 60) : 0);
const sign = (n) => (n >= 0 ? "+" : "") + n;

console.log(
  `backlog burn ${v.firstAt} -> ${v.lastAt}  (ledger has ${v.snapshots} queue snapshots; ${v.inWindow} in the ${hours > 0 ? hours + "h" : "all"} window; span ${v.spanMins} min)`
);
console.log(`  ledger ${record.path} (${record.bytes} B${record.truncated ? `, read as the newest ${record.text.length} B tail — the older part is not in this verdict` : ""}${v.malformed ? `, ${v.malformed} unparseable line(s) ignored` : ""})`);
if (v.fellBack) console.log(`  note: no snapshot in the last ${hours} h — using the whole ledger (${v.snapshots} snapshots)`);
for (const k of LEDGER_STATES) {
  const d = (v.last.queue[k] ?? 0) - (v.first.queue[k] ?? 0);
  console.log(`  ${k.padEnd(10)} ${v.first.queue[k] ?? 0} -> ${v.last.queue[k] ?? 0}   delta ${sign(d)}   ${perHour(d).toFixed(1)}/h`);
}
console.log(`  verdict: ${v.verdictLine}`);
if (v.staleMins > 0) console.log(`  note: the newest snapshot is ${v.staleMins} min old — the fleet ledger stops being appended while the broker is down, so this window is not "now"`);
const wt = (s) => (typeof s.worktrees === "number" ? s.worktrees : null);
console.log(
  `  refs ${v.first.refs} -> ${v.last.refs} (${v.last.refs - v.first.refs})` +
    (wt(v.first) !== null && wt(v.last) !== null ? `, worktrees ${wt(v.first)} -> ${wt(v.last)} (${wt(v.last) - wt(v.first)})` : "")
);
if (v.last.mainSha) {
  if (!v.first.mainSha) console.log(`  main ${v.last.mainSha} (first snapshots in this ledger predate the mainSha field, so no comparison is possible)`);
  else console.log(`  main ${v.first.mainSha} -> ${v.last.mainSha}` + (v.first.mainSha === v.last.mainSha ? "  (NOT MOVING: nothing landed)" : "  (main moved — a landing is only PROVEN when refs fall; a delegate commit also moves main)"));
}
process.exit(0);
