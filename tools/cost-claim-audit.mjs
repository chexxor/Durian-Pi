#!/usr/bin/env node
// tools/cost-claim-audit.mjs — "does this doc's `Run these first` block still tell the truth about COST?"
//
// TRIGGER (the symptom that loads this instrument): a session is about to follow a pointer's `Run these first`
// block, or a doc gate passed while a cost claim in that block was FALSE. A cost claim is a MEASUREMENT, not a
// constant: `docs/runbooks/session-start-cost.md` §37 says a cost names its flags, and §43's THIRD/EIGHTH
// addenda measured ONE instrument drifting 1.1 -> 1.5 -> 2.3 s over three clean trees. The same drift had
// already reached SIX of the thirteen commands in `docs/NEXT.md`'s block (2026-11-16, pitfall 409) while EVERY
// doc gate stayed exit 0 — a drifted cost reads as truth because nothing re-runs it. This tool re-runs the
// block and says which line lies.
//
// WHAT IT ANSWERS, each a measurement with its predicate named:
//   1. every command in the block that carries a cost claim, with stated vs measured and the RATIO;
//   2. which claims hold inside the tolerance and which do NOT (the finding names the line number);
//   3. which claims could NOT be measured and why (`REFUSED` — not on the read-only allow-list, or `UNMEASURED`
//      — over the time budget). An unmeasured claim is never counted as a pass (the same rule that makes
//      `tools/queue-pressure.mjs` print `NOT MEASURED` rather than 0 for an absent read path).
//   4. the audit's OWN cost in seconds and its host line (OS + distro + kernel + node, never user@hostname).
//
// RULES (the decision the tool makes, declared not inferred):
//   - ONE claim per line: the FIRST `<num> s` (or `<lo>-<hi> s`, or `~<num> s`) in the line's `#` note. The split
//      is the LAST ` #` in the line, so a command whose own text contains ` #` is not this block's shape.
//   - TOLERANCE, two-sided and named: a claim is OFF when measured > statedHi × tol (under-stated, the drift
//      shape) or measured < statedLo ÷ tol (over-stated, the claim that flatters the loop). Default tol 2 —
//      HALF a loop is a mis-measurement, TWICE is the class that changes what the session decides. `--tolerance`
//      overrides and the override is printed on every line, so a widened tolerance is visible, not silent.
//      `--tolerance` overrides and the override is printed, so a widened tolerance is visible, not silent.
//   - ALLOW-LIST, not a deny-list: only shapes this tool can prove it will not write with. A read-only shape is
//      `node` + a script under `scripts/`, `demo/`, `tools/` or a root `cli.mjs` whose VERB is a read, `git` + a
//      read verb, or `node -e`. Anything else — a broker `serve`, a bulk `--apply`, `set -a`/sourcing a key file,
//      `nohup`, any `git` write verb — is REFUSED with the token that refused it. New tokens go in FORBIDDEN_WORDS (word match) or FORBIDDEN_SUB (substring), in
//      the open, next time a session meets a shape this instrument did not know.
//   - BUDGET: `--budget <s>` (default 240 s of child wall) so the audit itself stays inside one bounded tool
//      call. Costs are measured IN BLOCK ORDER, which is what a session that follows the block actually pays:
//      the same store read measured 2.2 s alone and 4.1 s as the block's first child (a cold page cache and
//      sequential load), so the block's numbers are the in-order ones or the audit contradicts itself.
//      call (AGENTS.md: every call carries a timeout, 600 s hard ceiling). A command whose stated cost cannot
//      fit the remaining budget is reported `UNMEASURED (budget)`, never skipped in silence.
//   - EXIT: 0 when every claim that WAS measured holds; 1 when any claim is OFF, or under `--strict` when a
//      claim was refused/unpriced or the doc yielded no claims at all (nothing to check is not proof).
//
// USAGE (the exact call, and the measured cost — see `last_verified` below):
//   node tools/cost-claim-audit.mjs                          # audits docs/NEXT.md's own block
//   node tools/cost-claim-audit.mjs --doc <path> [--doc …]   # more docs
//   node tools/cost-claim-audit.mjs --tolerance 2 --budget 60 --json
//   node tools/cost-claim-audit.mjs --strict                 # refused/unpriced claims also fail
//
// IT WRITES NOTHING — it spawns the block's commands as CHILDREN and keeps its own report on stdout. Two of
// those commands write by design (`tools/broker-keepalive.mjs` appends the fleet ledger, a `--area` run writes
// fixture scratch); both are read-only against the store, and this tool passes no new flags to either.
//
// Pinned by: tools/cost-claim-audit-test.mjs (the `toolchain` area) — a fixture doc, cheap `node -e` commands,
// every outcome (a, b, c, refused, unpriced, range, budget, no-claims) asserted on the mocked plane in ~2 s.
//
// last_verified: 2026-11-16 — `node tools/cost-claim-audit.mjs` at the clean tree `fb36568a2` (Linux, Fedora
// Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1): see its own `cost:` line for the
// wall and the findings it printed that day. Re-measure rather than trust this line.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DEFAULT_TOL = 2;
const DEFAULT_BUDGET_S = 240;
const CLI_READ_VERBS = ["check", "watch", "status", "ps", "queue", "events", "help"];
const GIT_READ_VERBS = ["log", "rev-parse", "status", "diff", "show", "ls-files", "ls-remote", "merge-tree", "worktree", "branch", "count-objects", "blame", "cat-file"];
// Tokens are matched as WORDS (or as a leading flag) so a script NAMED like a verb is not refused by its name:
// `tools/broker-serve.mjs --status` is a read, `cli.mjs serve` is a lease. New shapes go in this list, in the open.
const FORBIDDEN_WORDS = [["serve", "a broker lease (wakes seats, spends provider)"], ["send_work", "a seat turn (provider spend)"], ["nohup", "a detached job (nothing to measure here)"]];
const FORBIDDEN_SUB = [["--apply", "a queue transition (pm's verb, not a measurement)"], ["--confirm", "a queue transition (pm's verb, not a measurement)"], ["--writes", "a doc write (`tools/pointer-table-trim.mjs` moves pointer rows only WITH this flag; a measurement never writes a doc)"], ["set -a", "sources keys out of tree (a credential read, not a measurement)"], ["source ", "sources a file (a credential read, not a measurement)"], ["git push", "the operator's grant (AGENTS.md)"], ["git stash", "the forbidden-verb list (docs/failing-first-recipe.md)"], ["git reset", "the forbidden-verb list"], ["git checkout", "the forbidden-verb list"], ["git clean", "the forbidden-verb list"], ["git restore", "the forbidden-verb list"], [" -D", "a force-delete shape (the forbidden-verb list)"], ["--force", "a force shape (the forbidden-verb list)"], ["rm ", "a file write"], ["mv ", "a file write"], ["worktree add", "a worktree write"]];


function parseArgs(argv) {
  const a = { docs: [], tol: DEFAULT_TOL, budget: DEFAULT_BUDGET_S, json: false, strict: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i];
    if (k === "--doc") a.docs.push(val());
    else if (k === "--tolerance") a.tol = Number(val());
    else if (k === "--budget") a.budget = Number(val());
    else if (k === "--only") a.only = val();
    else if (k === "--json") a.json = true;
    else if (k === "--strict") a.strict = true;
    else if (k.startsWith("--doc=")) a.docs.push(k.slice(6));
    else if (k.startsWith("--tolerance=")) a.tol = Number(k.slice(12));
    else if (k.startsWith("--budget=")) a.budget = Number(k.slice(9));
    else if (k.startsWith("--only=")) a.only = k.slice(7);
    else if (k === "-h" || k === "--help") {
      console.log("see the header block of this file for USAGE");
      process.exit(0);
    } else throw new Error(`unparsed flag ${k} — see the header's USAGE`);
  }
  if (!a.docs.length) a.docs = ["docs/NEXT.md"];
  return a;
}

// THE CLAIM SHAPE — first `<num> s`, `<lo>-<hi> s` or `~<num> s` in the note.
function claim(note) {
  const m = note.match(/(~?)(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*s\b/);
  if (!m) return null;
  const lo = Number(m[2]);
  const hi = m[3] ? Number(m[3]) : lo;
  return { lo, hi, text: m[0].trim() };
}

// THE ALLOW-LIST — what a command may be spawned as, or why it may not.
function plan(raw) {
  let cmd = raw.trim();
  if (/^cd(\s|$)/.test(cmd)) return { run: false, kind: "SKIPPED", reason: "navigation, not a measurement" };
  const env = [];
  for (;;) {
    const m = cmd.match(/^([A-Z_][A-Z0-9_]*=(\S+|"[^"]*"))\s+/);
    if (!m) break;
    env.push(m[1]);
    cmd = cmd.slice(m[0].length);
  }
  if (/^timeout(\s|$)/.test(cmd)) {
    const parts = cmd.split(/\s+/);
    let i = 1;
    while (i < parts.length && parts[i].startsWith("-")) i += (parts[i] === "-k" || parts[i] === "--kill-after" || parts[i] === "--signal") ? 2 : 1;
    if (i < parts.length && /^\d+$/.test(parts[i])) i++;
    cmd = parts.slice(i).join(" ");
  }
  const wHit = FORBIDDEN_WORDS.find(([token]) => new RegExp(`(^|\s)${token}(\s|$)`).test(cmd) || cmd.includes(`--${token}`));
  if (wHit) return { run: false, kind: "REFUSED", reason: wHit[1] };
  const sHit = FORBIDDEN_SUB.find(([token]) => cmd.includes(token));
  if (sHit) return { run: false, kind: "REFUSED", reason: sHit[1] };
  const parts = cmd.split(/\s+/);
  if (parts[0] === "node" && parts[1] === "-e") return { run: true, env, cmd };
  if (parts[0] === "git") {
    if (!GIT_READ_VERBS.includes(parts[1])) return { run: false, kind: "REFUSED", reason: `git ${parts[1] ?? "?"} is not a read verb on this allow-list` };
    return { run: true, env, cmd };
  }
  if (parts[0] !== "node") return { run: false, kind: "REFUSED", reason: `first word ${parts[0] || "(empty)"} is not node/git` };
  const script = parts[1];
  if (/^cli\.mjs$/.test(script)) {
    const verb = parts[2];
    if (!CLI_READ_VERBS.includes(verb)) return { run: false, kind: "REFUSED", reason: `cli.mjs ${verb ?? "?"} is not a read verb on this allow-list` };
    return { run: true, env, cmd };
  }
  const m = script.match(/^(scripts|demo|tools)\/([\w.-]+\.(mjs|js))$/);
  if (!m) return { run: false, kind: "REFUSED", reason: `${script} is not under scripts/, demo/ or tools/` };
  return { run: true, env, cmd };
}

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

function auditDoc(doc, args) {
  const lines = readFileSync(doc, "utf8").split(/\r?\n/);
  const rows = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      inBlock = !inBlock;
      continue;
    }
    if (!inBlock) continue;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const idx = line.lastIndexOf(" #");
    const cmdRaw = idx > 0 ? line.slice(0, idx) : line;
    const note = idx > 0 ? line.slice(idx + 2) : "";
    if (!cmdRaw.trim()) continue;
    if (args.only && !cmdRaw.includes(args.only)) continue;
    const c = claim(note);
    const p = plan(cmdRaw);
    rows.push({ doc, line: i + 1, cmd: cmdRaw.trim(), note, claim: c, plan: p });
  }
  return rows;
}

const args = parseArgs(process.argv.slice(2));
const t0 = Date.now();
let budgetMs = args.budget * 1000;
// `--json` prints ONE machine-readable document and nothing else, so a caller can `JSON.parse` stdout; the
// human report is the same content on the same measurements, just not interleaved.
const report = [];
const say = (s) => report.push(s);

const audited = [];
for (const doc of args.docs) {
  const rows = auditDoc(doc, args);
  audited.push(...rows);
  const priced = rows.filter((r) => r.claim);
  say(`cost-claim-audit — ${doc}: ${rows.length} command(s) in fenced blocks, ${priced.length} carry a cost claim`);
  for (const r of rows) {
    let verdict = "";
    let measured = null;
    if (!r.claim) {
      verdict = r.plan.run ? "UNPRICED" : `NOT MEASURED (${r.plan.kind.toLowerCase()}: ${r.plan.reason})`;
    } else if (!r.plan.run) {
      verdict = `NOT MEASURED (${r.plan.kind.toLowerCase()}: ${r.plan.reason})`;
    } else {
      const need = Math.max(30_000, Math.round(r.claim.hi * 1000 * 4));
      if (need > budgetMs) {
        verdict = `NOT MEASURED (budget: needs >= ${(need / 1000) | 0} s of the ${budgetMs / 1000 | 0} s left)`;
      } else {
        const t = Date.now();
        const r2 = spawnSync("/bin/sh", ["-c", r.plan.cmd], {
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          timeout: need,
          env: { ...process.env, ...Object.fromEntries(r.plan.env.map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1).replace(/^"|"$/g, "")]; })) },
        });
        measured = (Date.now() - t) / 1000;
        budgetMs -= Date.now() - t;
        r.status = r2.status === null ? "killed at the timeout" : r2.status;
        // A non-zero exit in a fifth of a second is the pitfall 396 shape — `timeout 60 VAR=x cmd` execs the
        // env prefix and exits 127 in 0.001 s. A cost measured that way is not the command's cost, so it is
        // NOT MEASURED, not a number that reads as truth.
        if (r2.status !== 0 && measured < 0.2) {
          verdict = `NOT MEASURED (exit ${r.status} in ${measured.toFixed(3)} s — the command may not have run)`;
        } else {
          const ratio = measured / r.claim.hi;
          r.ratio = ratio;
          if (measured > r.claim.hi * args.tol) verdict = `OFF — under-stated x${ratio.toFixed(2)}`;
          else if (measured < r.claim.lo / args.tol) verdict = `OFF — over-stated x${(measured / r.claim.lo).toFixed(2)}`;
          else verdict = `HOLDS x${ratio.toFixed(2)} (tol ${args.tol})`;
        }
      }
    }
    say(`  L${r.line} ${r.cmd}${r.claim ? ` — stated ${r.claim.text}` : " — stated (none)"} → ${measured !== null ? `measured ${measured.toFixed(2)} s, ` : ""}${verdict}`);
    r.verdict = verdict;
  }
}

const off = audited.filter((r) => /^OFF/.test(r.verdict ?? ""));
const unmeasured = audited.filter((r) => /^(NOT MEASURED|UNPRICED)/.test(r.verdict ?? ""));
const cost = (Date.now() - t0) / 1000;
const ratios = audited.filter((r) => typeof r.ratio === "number").sort((a, b) => b.ratio - a.ratio);
say(`  audit cost: ${cost.toFixed(2)} s (child budget ${args.budget} s) · host: ${hostLine()}`);
if (ratios.length) say(`  worst ratios: ${ratios.slice(0, 3).map((r) => `L${r.line} x${r.ratio.toFixed(2)}`).join(" · ")} · measured: ${ratios.length} claim(s)`);
say(`  verdict: ${off.length} claim(s) OFF tolerance ${args.tol}, ${unmeasured.length} NOT MEASURED${off.length ? " — the doc's cost block lies, re-measure IN PLACE" : " — every measured claim holds"}`);
if (args.json) {
  process.stdout.write(`${JSON.stringify({
    docs: args.docs,
    tol: args.tol,
    budgetS: args.budget,
    claims: audited.length,
    priced: audited.filter((r) => r.claim).length,
    measured: ratios.length,
    strict: args.strict,
    off,
    unmeasured,
    costMs: Date.now() - t0,
    host: hostLine(),
  }, null, 1)}\n`);
} else {
  for (const line of report) console.log(line);
}
if (off.length) process.exit(1);
if (args.strict && (unmeasured.length || !audited.length)) process.exit(1);
process.exit(0);
