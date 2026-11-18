#!/usr/bin/env node
// tools/check-summarize.mjs — "what does this `check --json` artifact actually SAY, in ~1 KB?"
//
// TRIGGER (the symptom that loads this instrument): a session ran `cli.mjs check <rig> --json` and has a ~122 KB
// artifact in front of it (measured at `6c6691664`: 121,809 B, 31 checks, 207 findings), and it needs the verdict,
// the per-rule tally and one named finding — not a scroll of 207 objects. Every recent window re-derived that
// tally by hand with a `node -e` over the artifact; a hand tally has NO exit code, so it cannot be grepped red,
// and a session that re-derives nothing carries an older tree's per-rule counts forward as truth (pitfall 398's
// shape, and the same class cost-claim drift reached SIX lines of `docs/NEXT.md` while every gate stayed exit 0).
// A procedure retyped every session is a defect in the product (AGENTS.md: instruments, 2026-11-11) — this is the
// instrument for that procedure.
//
// WHAT IT ANSWERS, each with its predicate named:
//   1. the verdict: the artifact's own `pass`, and the count of `checks[].status` that read `fail`;
//   2. the PER-RULE tally, ordered most-frequent first — the rule key is `String(f.id).split(/[^A-Za-z0-9_-]/)[0]`,
//      because the live artifact has NO `findings[].rule` key (a reader who reaches for one counts `undefined`);
//   3. the per-SEVERITY tally and the artifact's own `summary` claims SIDE BY SIDE, with every disagreement named;
//   4. the DENOMINATOR the verdict was measured over — the `rig` file, `db` and `command` the artifact names,
//      because the band a fleet runs under is a property of the rig FILE (pitfall 439: `cli.mjs check` with no
//      argument resolves a 2-seat rig and prints band 20 for the same store a 12-seat rig calls band 120);
//   5. `--grep <pattern>`: the findings that name it, with a count — and exit 1 when it matched nothing;
//   6. the tool's OWN cost in ms and its host line (OS + distro + kernel + node, never user@hostname).
//
// RULES (the decision this tool makes, declared not inferred):
//   * EXIT 2 = refusal (argv-contract): unknown option, missing `--artifact`, an unreadable artifact, `--top 0`.
//      Exit 1 on this plane already means "measured FAIL", and a reader who cannot tell a typo from a measurement
//      cannot tell a green from a red — so a refusal never exits 1.
//   * EXIT 1 = the artifact was READ but is red: it is not a check document (no `findings[]` and no `checks[]`),
//      its JSON did not parse (a TRUNCATED capture — a `spawnSync` left without `maxBuffer: 64 * 1024 * 1024`
//      clips a 122 KB report, and an empty tally over a clipped read reads as "clean"), its `summary` disagrees
//      with the findings it was handed, `pass` is true while a check reports `fail`, or `--grep` matched nothing.
//   * THE SELF-CHECK IS THE WHOLE VALUE. `summary.total`, `summary.error` and `summary["fix-now"]` are claims the
//      producer makes about itself; recounting them costs nothing and a summary that disagrees with its own
//      findings is a bug in the producer — one this instrument would otherwise read as a clean verdict.
//   * an artifact whose JSON begins after a log preamble is parsed from the first `{`, and the bytes skipped are
//      PRINTED (`preambleBytes`) — a skip that is not visible is a read that cannot be re-verified.
//   * `--top <n>` caps the per-rule rows and PRINTS `droppedRules`, so a truncated tally is visible; `--full`
//      prints all of them. `--top 0` refuses rather than printing the empty tally that reads as clean.
//   * this tool WRITES NOTHING unless `--out <path>` is named, and never rewrites its input.
//
// COST: reads one artifact and prints ~1 KB. `last_verified:` line below carries the measured pair.
// Host: read IN THE SAME COMMAND as the numbers (SELFDEV pitfall 396's probe), never `user@hostname`.

import { parseOpts, REFUSE_EXIT } from "./argv-contract.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

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

const t0 = Date.now();

const o = parseOpts(process.argv.slice(2), {
  value: ["artifact", "out", "grep", "top"],
  bool: ["json", "full"],
  numeric: ["top"],
  usage: "--artifact <path> · [--json] · [--full] · [--out <path>] · [--top <n>] · [--grep <pattern>]",
});

const die = (cause) => {
  // `REFUSED cause:` is the shape tools/keycheck.mjs ships; keep it so one grep finds every refusal.
  process.stderr.write(`REFUSED cause:${cause}\n`);
  process.stderr.write(`known options: ${o.usage}\n`);
  process.exit(REFUSE_EXIT);
};

const artifactPath = o.get("artifact");
if (artifactPath === null) die("no --artifact — this tool reads a `check --json` document; with no artifact there is no measurement, only a guess");

let raw;
try {
  raw = readFileSync(artifactPath, "utf8");
} catch (e) {
  die(`the artifact ${artifactPath} could not be read (${e.code ?? "unreadable"}) — a missing capture is not a clean check`);
}

// The preamble rule: `cli.mjs check --json` prints JSON at byte 0, but a capture redirected behind a provider
// WARNING line does not. Tolerate it, and REPORT the skip.
const first = raw.indexOf("{");
const preambleBytes = first < 0 ? 0 : first;
let doc = null;
let parseError = null;
if (first < 0) {
  parseError = "no `{` in the file";
} else {
  try {
    doc = JSON.parse(raw.slice(first));
  } catch (e) {
    parseError = e.message;
  }
}

const topWanted = o.has("full") ? Infinity : (() => {
  const n = o.num("top", 10);
  if (n < 1) die("--top <1 REFUSES: an empty tally is not proof of a clean check, it is a tally with no rows");
  return n;
})();

const report = {
  ok: true,
  tool: "tools/check-summarize.mjs",
  artifact: artifactPath,
  artifactBytes: Buffer.byteLength(raw),
  preambleBytes,
  parsed: doc != null,
  document: false,
  command: null,
  rig: null,
  db: null,
  band: null,
  pass: null,
  counts: { findings: 0, severities: {}, checks: 0, checkFails: 0, perRule: [] },
  summaryClaims: {},
  mismatches: [],
  grep: null,
  droppedRules: 0,
  exitVerdict: 0,
};

function finish(exitCode) {
  report.exitVerdict = exitCode;
  report.costMs = Date.now() - t0;
  report.host = hostLine();
  if (o.get("out")) {
    try {
      writeFileSync(o.get("out"), JSON.stringify(report) + "\n");
    } catch (e) {
      die(`--out ${o.get("out")} could not be written (${e.code ?? "error"})`);
    }
  }
  const human = [];
  human.push(`check-summarize verdict: ${exitCode === 0 ? "artifact read and consistent" : "RED"} · artifact ${artifactPath} (${report.artifactBytes} B, preamble ${report.preambleBytes} B skipped)`);
  human.push(`denominator: rig=${report.rig} db=${report.db} command=${report.command} — the band and seat-count denominators are the RIG FILE this artifact names, not this tool's`);
  human.push(`document verdict: ${report.document ? "a check document" : "NOT a check document"}`);
  human.push(`checks=${report.counts.checks} (fail ${report.counts.checkFails}) · findings=${report.counts.findings} · pass=${report.pass}`);
  human.push(`summary claims: ${JSON.stringify(report.summaryClaims)}`);
  human.push("per-rule: " + (report.counts.perRule.length
    ? report.counts.perRule.map((r) => `${r.rule} ${r.n}`).join(" · ")
    : "(none counted)"));
  if (report.droppedRules) human.push(`droppedRules: ${report.droppedRules} (raise --top or pass --full — a truncated tally is not the whole tally)`);
  human.push("severities: " + Object.entries(report.counts.severities).map((kv) => `${kv[0]} ${kv[1]}`).join(" · "));
  if (report.grep) human.push(`grep "${report.grep.pattern}": ${report.grep.matched} finding(s) (${report.grep.rows.length} shown)`);
  for (const row of report.grep?.rows ?? []) human.push(`  match ${row.rule} ${row.severity} ${row.subject}: ${(row.detail || "").slice(0, 200)}`);
  for (const m of report.mismatches) human.push(`MISMATCH ${m}`);
  human.push(`cost: ${report.costMs} ms · host: ${report.host}`);
  process.stdout.write((o.has("json") ? JSON.stringify(report) : human.join("\n")) + "\n");
  process.exit(exitCode);
}

if (parseError) {
  report.mismatches.push(`the JSON did not parse (${parseError}) — a TRUNCATED capture is not a clean read; recount with a 64 MB maxBuffer or from the file itself`);
  finish(1);
}

report.summaryClaims = doc.summary && typeof doc.summary === "object" ? { ...doc.summary } : {};
report.command = typeof doc.command === "string" ? doc.command : null;
report.rig = typeof doc.rig === "string" ? doc.rig : null;
report.db = typeof doc.db === "string" ? doc.db : null;

const findings = Array.isArray(doc.findings) ? doc.findings : null;
const checks = Array.isArray(doc.checks) ? doc.checks : null;
report.document = findings != null || checks != null;

if (!report.document) {
  report.mismatches.push("not a check document: the object carries neither a `findings` array nor a `checks` array — naming what was handed so a reader knows this verdict came from somewhere else");
  finish(1);
}

report.band = `denominator is the rig file: ${report.rig ?? doc.rig ?? "(unnamed)"}`;
report.pass = typeof doc.pass === "boolean" ? doc.pass : null;

const list = findings ?? [];
report.counts.findings = list.length;

// THE RULE KEY. `findings[].id` IS the rule on this rig's artifacts; the key is the leading identifier so an
// id that later carries a subject suffix still groups. `findings[].rule` does not exist — reaching for it
// counts `undefined` and prints one row for the whole fleet.
const tally = new Map();
const sev = new Map();
for (const f of list) {
  const key = String(f.id ?? "(no id)").split(/[^A-Za-z0-9_-]/)[0] || "(no id)";
  tally.set(key, (tally.get(key) ?? 0) + 1);
  const s = String(f.severity ?? "(none)");
  sev.set(s, (sev.get(s) ?? 0) + 1);
}

const rows = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
report.counts.perRule = rows.slice(0, topWanted === Infinity ? rows.length : topWanted).map((r) => ({ rule: r[0], n: r[1] }));
report.droppedRules = rows.length - report.counts.perRule.length;
report.counts.severities = Object.fromEntries([...sev.entries()].sort((a, b) => b[1] - a[1]));

const checkFails = (checks ?? []).filter((c) => /fail/i.test(String(c.status)));
report.counts.checks = (checks ?? []).length;
report.counts.checkFails = checkFails.length;

// THE SELF-CHECK: the producer's claims vs the rows it handed.
const sum = report.summaryClaims;
if (sum.total != null && sum.total !== report.counts.findings) {
  report.mismatches.push(`summary.total ${sum.total} vs findings ${report.counts.findings} — the artifact's own total disagrees with the rows it carried`);
}
for (const [k, claimed] of Object.entries(sum)) {
  if (k === "total" || typeof claimed !== "number") continue;
  const actual = sev.get(k) ?? 0;
  if (claimed !== actual) report.mismatches.push(`summary."${k}" ${claimed} vs severity "${k}" ${actual} — a per-severity claim that disagrees with the findings`);
}
for (const [k, actual] of sev.entries()) {
  if (!Object.hasOwn(sum, k)) report.mismatches.push(`severity "${k}" ${actual} not claimed in summary — an unsanitized class the summary never counted (a reader comparing summary keys sees nothing)`);
}
if (report.pass === true && checkFails.length) {
  report.mismatches.push(`pass true vs ${checkFails.length} check(s) status fail — first named ${checkFails[0].id}: a green verdict over a red check is the "green suite over a dead feature" class`);
}

if (o.get("grep")) {
  let re = null;
  const pat = o.get("grep");
  try {
    re = new RegExp(pat);
  } catch {
    re = null; // a bracket in a plain question is a WORD search, not a broken pattern
  }
  const hits = list.filter((f) => {
    const hay = `${f.id ?? ""} ${f.subject ?? ""} ${f.detail ?? ""}`;
    return re ? re.test(hay) : hay.includes(pat);
  });
  report.grep = {
    pattern: pat,
    matched: hits.length,
    rows: hits.slice(0, topWanted === Infinity ? hits.length : topWanted).map((f) => ({
      rule: String(f.id ?? "").split(/[^A-Za-z0-9_-]/)[0],
      severity: f.severity,
      subject: f.subject,
      detail: f.detail,
    })),
  };
}

// A check document the summary lies about is RED; a grep that found nothing is RED.
let exitCode = 0;
if (report.mismatches.length) exitCode = 1;
if (report.grep && report.grep.matched === 0) exitCode = 1;
finish(exitCode);
