#!/usr/bin/env node
// tools/tranche-evidence.mjs — "do these contracts still hold at THIS tree?" in ONE bounded call.
//
// SYMPTOM this answers (the trigger that loads this instrument): a session is at a NEWER tree than the one
// a tranche's evidence was measured on, and it must re-prove a whole SET of contracts — a census, the gate's
// own demo, the mocked-plane demos, and the per-area pairs — without retyping ten commands and reading ten
// exit codes by hand. Retyping them is the defect this tool removes: a re-check run by hand loses its exit
// codes (a `spawnSync` report that reads `r.code` prints `exit=undefined` and looks green), and a session
// that re-proves nothing carries the older tree's claims forward as truth (pitfall 398's shape, and cost
// claim drift that pitfall 409 reached SIX block lines of while every gate stayed exit 0).
//
// WHAT IT ANSWERS, each a measurement with its predicate named:
//   1. one row per contract: name, the exact command, the EXIT IT IS EXPECTED TO PRINT, the exit it printed,
//      the wall seconds, and the byte counts of its own stdout and stderr;
//   2. which rows hold (exit === expect and the child was not killed by the per-child bound) and which do
//      NOT — the finding names the row, never the first row (the re-check is per row, so one red does not
//      hide behind nine greens);
//   3. a child over the per-child bound is RED with the bound named in its `reason`, never a pass and never
//      a silent skip (an unmeasured claim is not a pass — the same rule `tools/cost-claim-audit.mjs` uses);
//   4. the tool's OWN cost in seconds and its host line (OS + distro + kernel + node, never user@hostname).
//
// RULES (the decision this tool makes, declared not inferred):
//   * EXPECTED exits, not "zero is green": the queue census prints exit 1 because the band rule is SUPPOSED
//      to fail (that failing `check` rule is half of this tranche's contract). A child that fails as DECLARED
//      holds; a child that fails UNDECLARED is red. The expectation is data in the row, so the table is reviewable.
//   * a row's stderr bytes are reported even when its exit matches, because the exit code is not the falsifier
//      (pitfall 405: piping an instrument printed a stack and still exited 0; `wc -c` on `.err` is the proof).
//   * the tool spawns ONLY its own fixed rows — nothing external is run, so it cannot be talked into a write
//      verb; every default row is a census, a demo, or a test area (fixture scratch only, read-only store).
//   * FLAGS ARRIVE ONLY IN `=` FORM. The space form and any unknown flag REFUSE with exit 2 and name what it
//      refused (pitfall 394/398: an ignored flag is a false green).
//   * `--dry-run` runs NOTHING and writes NOTHING: it prints the rows and their expectations, so a session can
//      see the unit of work before paying it (a plan names no removals and proves no run).
//
// Run: node tools/tranche-evidence.mjs                        # the tranche's default table, this tree
//       node tools/tranche-evidence.mjs --only=census,docs-area
//       node tools/tranche-evidence.mjs --skip=docs-area       # drop the 60 s row for a fast loop
//       node tools/tranche-evidence.mjs --dry-run
//       node tools/tranche-evidence.mjs --budget=200 --json=.spike/tranche-out.json
//       node tools/tranche-evidence.mjs --table=<rows.json>   # a fixture table (the demo's seam)
//      `--json=<path>` writes the machine-readable report to that path (the tool writes nowhere else).
//
// COST: measured by TWO runs of THIS tool at the clean tree `530d79cb7` carries (2026-11-16, host read in the
// same call as each measurement, never quoted from memory; the PRIOR pair of runs at the tree `e474eb006` carries
// printed 111.15 s / 49.95 s — superseded, not explained, a re-read rather than a re-derivation):
//   `node tools/tranche-evidence.mjs --json=.spike/tranche-run-D.json` → exit 0, 10 rows, 0 mismatched, own
//   cost 110.48 s (children 110.5 s), tool stderr 0 B — per row census 1.36 s (expect 1, the band rule firing)
//   · gate-sanity 6.53 s · notices 0.27 s · view 2.11 s · readapi 5.10 s · check-area 9.00 s · rig-area 20.59 s
//   · burn-verdict 0.03 s · docs-area 60.15 s (8/8) · cli-check 5.34 s (exit 1, 772 B of its own stderr = the
//   provider-slot refusals, which is why its exit is DECLARED 1 and still HOLDS).
//   `node tools/tranche-evidence.mjs --skip=docs-area --json=.spike/tranche-run-D2.json` → exit 0, 9 rows,
//   0 mismatched, own cost 49.72 s (children 49.7 s).
// So the WHOLE set is ~110 s and the fast loop is ~50 s: the 60 s docs row is most of the slow form's price, and
// the tool adds only ~0.1 s of spawn overhead on top of its children. Re-run rather than quote — these are one
// run's walls. THE FAST FORM CAN PRINT exit 1 WITHOUT A REGRESSION: contention can kill one member of an area
// (SELFDEV pitfall 421) — a mismatched row prints its OWN last words and the named pin then passes standalone
// twice at the same tree; re-run THAT row standalone before believing the red, and never weaken the row.
// So the WHOLE set is ~111 s and the fast loop is ~50 s: the 60 s docs row is most of the slow form's price, and
// the tool adds only ~0.1 s of spawn overhead on top of its children. Re-run rather than quote — these are one
// run's walls. Host measured on: **Linux**, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`,
// node v24.22.1, git 2.56.0.
//
// ADDENDUM 2026-11-16 (delegate, the queue-backlog window — the band above is a FLOOR, not a ceiling; the
// number is re-read, never widened by eye): the SAME tool at the trees this window carries printed **142.86 s**
// (`node tools/tranche-evidence.mjs --json=.spike/tranche-118.json` at the tree `8a57d3bb1` carries → exit 0,
// 10 rows / 0 mismatched, `.err` 0 B: census 4.03 s · gate-sanity 11.12 s · notices 0.36 s · view 2.76 s ·
// readapi 6.16 s · check-area 17.98 s · rig-area 26.04 s · burn-verdict 0.04 s · docs-area 66.42 s (8/8) ·
// cli-check 7.95 s) and **128.55 s** (`--json=.spike/tranche-119.json` at the tree `50d4ae9d0` carries → exit 0,
// same 10 rows, every row HOLDS, `.err` 0 B, store `stat -c '%y %s'` unchanged before and after). So the honest
// band for the WHOLE set on this box is **110–146 s** — widened IN PLACE 2026-11-16 by a FOURTH run, because the
// band is a measurement and a fourth data point that falls outside it is a lie, not a rounding: `timeout 250 node
// tools/tranche-evidence.mjs --json=.spike/tranche-131.json` at the tree `f1ab2a3ed` carries → **exit 0, 10 rows /
// 0 mismatched, cost 146.13 s** (children 146.1 s, `.err` 0 B), per row census 3.45 s · gate-sanity 12.96 s ·
// notices 0.36 s · view 3.22 s · readapi 6.68 s · check-area 19.85 s · rig-area 26.42 s · burn-verdict 0.03 s ·
// docs-area 65.53 s · cli-check 7.63 s — NOT ~110 s: the price slides with the area costs it
// re-runs (`check-area` 9.00 → 17.98 s and `docs-area` 60.15 → 66.42 s as the docs and runbook counts grew —
// §39/§43 name that mechanism), so a `timeout` on this call must round up ABOVE the ceiling: `timeout 250`.
//
// Exit: 0 = every row held; 1 = at least one row did not (or a row was killed by the bound);
//       2 = usage (a flag in the space form, an unknown flag, a `--only`/`--skip` name matching no row).
//
// last_verified: 2026-11-16 at tree `530d79cb7` — the pinned demo `node tools/tranche-evidence-test.mjs` exits
// 0 (34 checks, 0 FAIL, stderr 0 B; its recorded RED is exit 1, 31 FAIL lines naming the missing tool — see
// that file's header, METHOD 1 of docs/failing-first-recipe.md), and the tool's own contract set is proven by
// the run above (10 rows, 0 mismatched; `stat -c '%y %s' selfdev.sqlite` read before and after the call — the
// store did not move).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// The DEFAULT table: this tranche's contracts (goal mwh73rd1-izyq72), each with the exit it is DECLARED to
// print. `expect: 1` rows are rules that are SUPPOSED to fail while the backlog is out of band.
const DEFAULT_ROWS = [
  { name: "census", cmd: "DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs", expect: 1, why: "the band rule fires while open work is out of band" },
  { name: "gate-sanity", cmd: "node demo/queue-pressure.test.mjs", expect: 0, why: "task-1's gate plus the mint-rate SANITY leg" },
  { name: "notices", cmd: "node demo/notice-not-work.test.mjs", expect: 0, why: "task-2: a notice is not claimable work and is acked on read" },
  { name: "view", cmd: "node demo/status-view-bound.test.mjs", expect: 0, why: "task-3: the view NAMES work / notice / registration" },
  { name: "readapi", cmd: "node scripts/test.mjs --area readapi --jobs 4", expect: 0, why: "task-3's pin lives in the readapi area" },
  { name: "check-area", cmd: "node scripts/test.mjs --area check --jobs 4", expect: 0, why: "the new rule plus doc-count-drift and starter" },
  { name: "rig-area", cmd: "node scripts/test.mjs --area rig --jobs 4", expect: 0, why: "workable() and the mint gate on the base plane" },
  { name: "burn-verdict", cmd: "node tools/backlog-burn.mjs", expect: 0, why: "the fleet LEDGER's verdict sentence the finding quotes" },
  { name: "docs-area", cmd: "timeout 200 node scripts/test.mjs --area docs --jobs 4", expect: 0, why: "the per-area pair a docs carrier owes (§39)" },
  { name: "cli-check", cmd: "DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json --json", expect: 1, why: "the check rule FAILS while the residuals are open" },
];

function hostLine() {
  // Hostname-free on purpose (operator ruling 2026-11-04): OS + distro + kernel + node, never user@hostname.
  const u = spawnSync("uname", ["-s"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  const k = spawnSync("uname", ["-r"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  let distro = "unknown";
  try {
    const rel = readFileSync("/etc/os-release", "utf8");
    distro = (rel.match(/^PRETTY_NAME="([^"]+)"/m) ?? [])[1] ?? "unknown";
  } catch {
    /* non-Fedora hosts: the OS and kernel still name the box adequately */
  }
  return `${u}, ${distro}, kernel ${k}, node ${process.version}`;
}

const T0 = Date.now();
const args = { table: null, only: [], skip: [], budget: 200, json: null, dry: false };

// Flags in `=` form ONLY. The space form and an unknown flag are REFUSED, not defaulted (pitfall 394/398).
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) {
    process.stderr.write(`REFUSED: ${a} is not a flag; this tool takes --name=value only\n`);
    process.exit(2);
  }
  const eq = a.indexOf("=");
  if (eq < 0) {
    if (a === "--dry-run") {
      args.dry = true;
      continue;
    }
    process.stderr.write(`REFUSED: ${a} arrived in the space form; this tool takes only --name=value (an ignored flag is a false green)\n`);
    process.exit(2);
  }
  const key = a.slice(2, eq);
  const val = a.slice(eq + 1);
  if (key === "table") args.table = val;
  else if (key === "json") args.json = val;
  else if (key === "only") args.only = val.split(",").map((x) => x.trim()).filter(Boolean);
  else if (key === "skip") args.skip = val.split(",").map((x) => x.trim()).filter(Boolean);
  else if (key === "budget") args.budget = Number(val) || 200;
  else {
    process.stderr.write(`REFUSED: unknown flag --${key}=${val}\n`);
    process.exit(2);
  }
}

let rows;
if (args.table) {
  const parsed = JSON.parse(readFileSync(args.table, "utf8"));
  rows = Array.isArray(parsed) ? parsed : parsed?.rows;
  if (!Array.isArray(rows)) {
    process.stderr.write(`REFUSED: --table=${args.table} is not an array of {name,cmd,expect}\n`);
    process.exit(2);
  }
} else {
  rows = DEFAULT_ROWS;
}

function subset(list, want, chosen, flag) {
  if (!want.length) return list;
  const picked = list.filter((r) => want.includes(r.name));
  const missing = want.filter((w) => !list.some((r) => r.name === w));
  if (missing.length) {
    process.stderr.write(`REFUSED: --${flag} names ${missing.join(",")} which matches no row (a subset that reads as the whole set)\n`);
    process.exit(2);
  }
  return chosen === "only" ? picked : list.filter((r) => !want.includes(r.name));
}
rows = subset(rows, args.only, "only", "only");
rows = subset(rows, args.skip, "skip", "skip");

if (args.dry) {
  process.stdout.write(`tranche-evidence DRY RUN (${rows.length} row(s), nothing run, nothing written)\n`);
  for (const r of rows) process.stdout.write(`  ${r.name} :: expect=${r.expect} :: ${r.cmd}\n`);
  process.stdout.write(`tranche-evidence cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}\n`);
  process.exit(0);
}

const out = [];
let total = 0;
for (const r of rows) {
  const t0 = Date.now();
  // The exit code is read from the SHELL MARKER, never from spawnSync's field. Measured on this rig's node
  // (v24.22.1) by printing `Object.keys(spawnSync(...))`: the result is `{status,signal,output,pid,stdout,stderr}`
  // — there is NO `exitCode` key at all, for a direct spawn OR a `bash -c` child. So `r.exitCode` reads
  // `undefined`, and `undefined === r.expect` is a FALSE GREEN row. The marker is the proof; `status` is not
  // read here at all, so the verdict does not depend on which field a given node names the exit code.
  const res = spawnSync("bash", ["-c", `{ ${r.cmd}
}
__te=$?
printf '__TE_EXIT=%s' "$__te"
`], { encoding: "utf8", cwd: process.cwd(), timeout: args.budget * 1000 });
  const secs = (Date.now() - t0) / 1000;
  total += secs;
  const raw = res.stdout ?? "";
  const m = raw.match(/__TE_EXIT=(\d+)\s*$/);
  const killed = !m;
  const exit = m ? Number(m[1]) : null;
  const so = m ? raw.slice(0, m.index) : raw;
  const se = res.stderr ?? "";
  const lines = so.split(/\r?\n/).filter((l) => /passed|PASS|checks|verdict|cost:|ok /i.test(l));
  out.push({
    name: r.name,
    cmd: r.cmd,
    expect: r.expect,
    exit,
    signal: res.signal ?? "none",
    wallS: Number(secs.toFixed(2)),
    holds: !killed && exit === r.expect,
    reason: killed ? `over the per-child budget ${args.budget} s` : r.why,
    outBytes: Buffer.byteLength(so),
    errBytes: Buffer.byteLength(se),
    // The falsifier for a red row is the child's OWN words, not its byte count: report the tail of its stderr
    // (and stdout, when stderr was silent) so one bounded call carries the diagnosis, not just `err=785B`.
    errTail: se.slice(-700),
    outTail: so.slice(-300),
    tally: lines.length ? lines[lines.length - 1].trim().slice(0, 200) : "",
  });
}

const bad = out.filter((r) => !r.holds);
const report = {
  rows: out,
  verdict: { rows: out.length, mismatched: bad.length, wallS: Number(total.toFixed(1)), costS: Number(((Date.now() - T0) / 1000).toFixed(2)), host: hostLine() },
};

for (const r of out) {
  process.stdout.write(`  ${r.name} :: expect=${r.expect} exit=${r.exit} signal=${r.signal} wall=${r.wallS.toFixed(2)}s out=${r.outBytes}B err=${r.errBytes}B ${r.holds ? "HOLDS" : "DOES NOT HOLD"}\n`);
  if (!r.holds) {
    process.stdout.write(`    reason: ${r.reason} :: ${r.name} is the row that regressed\n`);
    const t = (r.errTail || r.outTail || "").trim();
    if (t) process.stdout.write(`    the child's own last words: ${t}\n`);
  }
  if (r.tally) process.stdout.write(`    tally: ${r.tally}\n`);
}
process.stdout.write(`verdict: ${report.verdict.rows} row(s), ${report.verdict.mismatched} mismatched · cost ${report.verdict.costS} s (children ${report.verdict.wallS} s) · host: ${report.verdict.host}\n`);
if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2) + "\n");
process.exit(bad.length ? 1 : 0);
