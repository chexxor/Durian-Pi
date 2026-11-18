// tools/check-summarize-test.mjs — the check artifact's TALLY is read, not re-derived by hand (and a clean
// tally is not a lie wearing numbers).
//
// WHY THIS FILE EXISTS (docs/failing-first-recipe.md METHOD 1 — the test was written BEFORE the tool):
// `cli.mjs check --json` prints ~122 KB for this fleet (measured at `6c6691664`: 121,809 B, 31 checks, 207
// findings), and every window re-derives the verdict by hand across three files — `findings[].id` not
// `findings[].rule`, the summary keys `error`/`fix-now`/`total`, the `rig` denominator. Hand-derivation is the
// defect this pin removes: a hand tally has no exit code, so it cannot be grepped-red, and a session that
// re-derives nothing carries an older tree's per-rule counts forward as truth.
//
//   RED (measured — see the numbers in the shipped commit): stage the PRE-change tree and point --tool at it:
//     mkdir -p .spike/pc-redN && git archive HEAD tools scripts src cli.mjs | tar -x -C .spike/pc-redN
//     node tools/check-summarize-test.mjs --tool .spike/pc-redN/tools/check-summarize.mjs
//   Every spawn dies `Cannot find module` → the RED leg reports it, exit 1.
//
// CLOSED SET OF OUTCOMES pinned below, each on a FIXTURE document so the test costs ~1 s and never reads
// ./selfdev.sqlite (the mocked plane):
//   (a) a consistent document -> exit 0, per-rule tally sums to the finding count, 0 mismatches;
//   (b) summary.total != findings.length -> exit 1 naming BOTH numbers (a total that lies);
//   (c) a per-severity claim that disagrees -> exit 1, and a severity NO summary key names is also reported;
//   (d) summary claims a severity no finding carries -> the mirror finding;
//   (e) `pass: true` while checks report `status: fail` -> exit 1 (a green suite over a dead feature);
//   (f) an object with no findings and no checks -> NOT a check document: exit 1, named;
//   (g) a truncated capture (unparseable JSON) -> exit 1 "did not parse", never an empty tally that reads clean;
//   (h) a capture with a log preamble before the JSON -> parsed, and the skipped byte count is PRINTED;
//   (i) the denominator (rig/db/command) travels in the document — band 20 vs band 120 is pitfall 439's class;
//   (j) `--grep` matching nothing -> exit 1 (a search that found nothing is not a pass);
//   (k) `--top` caps the tally AND prints how many rows it dropped; `--full` prints all of them;
//   (l) `--top 0` REFUSES (a tally with no rows reads as clean); unknown option and a missing --artifact REFUSE exit 2;
//   (m) `--artifact=path` and `--artifact path` are ONE option (argv-contract);
//   (n) `--out <path>` writes the document and leaves the artifact bytes identical;
//   (o) cost in ms + host line (OS + distro + kernel + node, never user@hostname) are in the document.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";

const argv = process.argv.slice(2);
const TOOL = argv.includes("--tool") ? argv[argv.indexOf("--tool") + 1] : "tools/check-summarize.mjs";
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const dir = mkdtempSync(`${tmpdir()}/checks-`);

function fnd(rule, severity, subject, detail) {
  return { id: rule, severity, subject, detail, fix: "fixture fix" };
}

// A consistent check document: 5 findings, summary claims match, one failing check, pass false.
const GOOD = {
  ok: true, command: "cli.mjs check rig.selfdev.json --json", rig: "rig.selfdev.json", db: "./selfdev.sqlite",
  findings: [
    fnd("runbook-stale", "error", "docs/runbooks/a.md", "stale since the pin"),
    fnd("runbook-stale", "error", "docs/runbooks/b.md", "stale since the pin"),
    fnd("citation-unresolvable", "error", "docs/NEXT.md", "path:line does not exist"),
    fnd("duplicate-item", "fix-now", "#100", "two rows for one item"),
    fnd("queue-pressure", "fix-now", "queue", "open work over band"),
  ],
  checks: [{ id: "runbook-freshness", status: "fail", found: 2 }, { id: "citation", status: "pass", found: 0 }],
  summary: { error: 3, "fix-now": 2, total: 5 },
  pass: false, exitCode: 1, plane: "rig",
};
writeFileSync(`${dir}/good.json`, JSON.stringify(GOOD));

// (b) the total lies — 6 findings, summary claims 5.
const TOTAL_LIE = structuredClone(GOOD);
TOTAL_LIE.findings.push(fnd("queue-pressure", "fix-now", "queue", "second finding"));
TOTAL_LIE.summary = { error: 3, "fix-now": 2, total: 5 };
writeFileSync(`${dir}/total-lie.json`, JSON.stringify(TOTAL_LIE));

// (c) one severity claim disagrees AND a severity appears that no summary key names.
const SEV_LIE = structuredClone(GOOD);
SEV_LIE.findings[4].severity = "warn";
SEV_LIE.summary = { error: 3, "fix-now": 2, total: 5 };
writeFileSync(`${dir}/sev-lie.json`, JSON.stringify(SEV_LIE));

// (d) mirror: the summary claims fix-now 4, only 2 findings carry it.
const MIRROR = structuredClone(GOOD);
MIRROR.summary = { error: 3, "fix-now": 4, total: 5 };
writeFileSync(`${dir}/mirror-lie.json`, JSON.stringify(MIRROR));

// (e) a green verdict over failing checks.
const PASS_LIE = structuredClone(GOOD);
PASS_LIE.pass = true;
writeFileSync(`${dir}/pass-lie.json`, JSON.stringify(PASS_LIE));

// (f) not a check document.
writeFileSync(`${dir}/notadoc.json`, JSON.stringify({ hello: "world", summary: { total: 1 } }));

// (g) a truncated capture — a spawnSync whose maxBuffer clipped the JSON.
writeFileSync(`${dir}/truncated.json`, JSON.stringify({ ok: true, command: "x", findings: [{ id: "a", severity: "error", subject: "s", detail: "d", fix: "f" }] }).slice(0, 40) + "\n");

// (h) a capture with a log preamble before the JSON.
writeFileSync(`${dir}/preamble.json`, `provider WARN: something\n${JSON.stringify(GOOD)}\n`);

function run(extra, name) {
  const r = spawnSync(process.execPath, [TOOL, "--artifact", `${dir}/${name}.json`, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  let j = null;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    /* the tool did not print a document — the checks below name it */
  }
  return { status: r.status, out: r.stdout, err: r.stderr, j };
}

// node exits 1 (not 127) for ERR_MODULE_NOT_FOUND, so the falsifier is the words, not the code.
const miss = (r, _why) => /Cannot find module/.test(r.err || "") && r.j == null;

console.log("=== 0. the tool exists (the RED leg points --tool at a tree without it) ===");
const probe = run(["--json"], "good");
check("the tool exists (a spawn that dies `Cannot find module` is a refusal, not a verdict)", !miss(probe, ""), `status=${probe.status} err=${(probe.err || "").slice(0, 200)}`);
if (miss(probe, "")) {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\nCHECK SUMMARIZE TEST FAIL (1) — the RED leg: ${TOOL} does not exist; every spawn dies \`Cannot find module\` (node exit 1)`);
  process.exit(1);
}

console.log("=== 1. a consistent document reads clean, and its tally sums ===");
check("(a) exit 0 on a consistent document", probe.status === 0, `status=${probe.status}`);
if (probe.j) {
  const j = probe.j;
  check("the finding count is the artifact's (5)", j.counts?.findings === 5, `findings=${j.counts?.findings}`);
  check("the per-rule tally sums to the finding count", (j.counts?.perRule ?? []).reduce((a, b) => a + b.n, 0) === 5, JSON.stringify(j.counts?.perRule));
  check("the tally names runbook-stale 2 · citation-unresolvable 1 · duplicate-item 1 · queue-pressure 1", (j.counts?.perRule ?? []).length === 4 && j.counts.perRule[0].rule === "runbook-stale" && j.counts.perRule[0].n === 2, JSON.stringify(j.counts?.perRule));
  check("the tally comes from findings[].id, not findings[].rule (the live artifact has no `rule` key)", (j.counts?.perRule ?? []).every((r) => !/undefined|null/.test(r.rule)), JSON.stringify(j.counts?.perRule));
  check("severity counts are reported (error 3 · fix-now 2)", j.counts?.severities?.error === 3 && j.counts.severities["fix-now"] === 2, JSON.stringify(j.counts?.severities));
  check("check statuses are counted (1 fail of 2)", j.counts?.checkFails === 1 && j.counts.checks === 2, `checks=${j.counts?.checks} fails=${j.counts?.checkFails}`);
  check("0 mismatches", (j.mismatches ?? []).length === 0, JSON.stringify(j.mismatches));
  check("the DENOMINATOR travels in the document (rig file the check walked)", j.rig === "rig.selfdev.json" && j.db === "./selfdev.sqlite" && typeof j.band === "string" && /denominator/i.test(j.band), `rig=${j.rig} db=${j.db} band=${j.band}`);
  check("the artifact's own command is echoed (which check produced this)", j.command === GOOD.command, j.command);
  check("cost in ms and the host line are in the document", typeof j.costMs === "number" && j.costMs > 0 && /kernel .+node v/.test(j.host ?? ""), `costMs=${j.costMs} host=${j.host}`);
  check("the host line carries no hostname marker (never user@host)", !/@/.test(j.host ?? ""), j.host);
  check("the tool's own exit is declared in the document (a reader can tell verdict from refusal)", j.exitVerdict === 0, `exitVerdict=${j.exitVerdict}`);
}

console.log("=== 2. a summary that disagrees with the findings it was handed FAILS ===");
const tl = run(["--json"], "total-lie");
check("(b) the lying total exits 1", tl.status === 1, `status=${tl.status}`);
check("  and names BOTH numbers (claims vs counted)", (tl.j?.mismatches ?? []).some((m) => /total/.test(m) && /6/.test(m) && /5/.test(m)), JSON.stringify(tl.j?.mismatches));
const sv = run(["--json"], "sev-lie");
check("(c) the disagreeing severity claim exits 1", sv.status === 1, `status=${sv.status}`);
check("  and names the severity key and both counts", (sv.j?.mismatches ?? []).some((m) => /fix-now/.test(m) && /1/.test(m) && /2/.test(m)), JSON.stringify(sv.j?.mismatches));
check("  and a severity NO summary key names is ALSO reported", (sv.j?.mismatches ?? []).some((m) => /warn/.test(m)), JSON.stringify(sv.j?.mismatches));
const mi = run(["--json"], "mirror-lie");
check("(d) the mirror claim (summary 4 vs findings 2) exits 1", mi.status === 1, `status=${mi.status}`);
check("  and says which direction it is", (mi.j?.mismatches ?? []).some((m) => /fix-now/.test(m) && /4/.test(m) && /2/.test(m)), JSON.stringify(mi.j?.mismatches));
const pl = run(["--json"], "pass-lie");
check("(e) pass:true over a failing check exits 1 (green over a dead feature)", pl.status === 1, `status=${pl.status}`);
check("  and names the check that failed, not just the verdict", (pl.j?.mismatches ?? []).some((m) => /pass/.test(m) && /runbook-freshness/.test(m)), JSON.stringify(pl.j?.mismatches));

console.log("=== 3. an object that is not a check document, and a truncated capture ===");
const nd = run(["--json"], "notadoc");
check("(f) not a check document: exit 1, named", nd.status === 1 && /not a check document/i.test(nd.out + nd.err), `status=${nd.status} out=${nd.out.slice(0, 200)}`);
check("  and it does not print an empty tally as if clean", nd.j && (nd.j.mismatches ?? []).length >= 1 && nd.j.counts?.findings === 0, JSON.stringify(nd.j));
const tr = run(["--json"], "truncated");
check("(g) a truncated capture: exit 1, says it did not parse", tr.status === 1 && /did not parse/i.test(tr.out + tr.err), `status=${tr.status} out=${tr.out.slice(0, 200)}`);
check("  and never invents counts for an artifact it could not read", tr.j && tr.j.counts?.findings === 0 && !tr.j.document, JSON.stringify({ document: tr.j?.document, findings: tr.j?.counts?.findings }));
const pre = run(["--json"], "preamble");
check("(h) a log preamble before the JSON is tolerated, exit 0", pre.status === 0, `status=${pre.status}`);
check("  and the bytes it skipped are PRINTED (the skip is visible, not silent)", pre.j && typeof pre.j.preambleBytes === "number" && pre.j.preambleBytes === "provider WARN: something\n".length, `preambleBytes=${pre.j?.preambleBytes}`);

console.log("=== 4. the read options: grep, top, full ===");
const gp = run(["--grep", "queue-pressure", "--json"], "good");
check("--grep matches the finding that names it (1 row, exit 0)", gp.status === 0 && gp.j?.grep?.matched === 1, `matched=${gp.j?.grep?.matched} status=${gp.status}`);
const gn = run(["--grep", "no-such-rule", "--json"], "good");
check("(j) --grep matching NOTHING exits 1 (found nothing is not a pass)", gn.status === 1 && gn.j?.grep?.matched === 0, `status=${gn.status} matched=${gn.j?.grep?.matched}`);
check("  and the tool still read the artifact (counts are present)", (gn.j?.counts?.findings) === 5, `findings=${gn.j?.counts?.findings}`);
const cap = run(["--top", "2", "--json"], "good");
check("(k) --top 2 caps the tally to 2 rows", cap.status === 0 && (cap.j?.counts?.perRule ?? []).length === 2, `rows=${(cap.j?.counts?.perRule ?? []).length}`);
check("  and PRINTS how many rows it dropped (a truncated tally is visible)", cap.j && cap.j.droppedRules === 2, `droppedRules=${cap.j?.droppedRules}`);
const full = run(["--full", "--json"], "good");
check("(k') --full prints every rule row (4 here)", full.status === 0 && (full.j?.counts?.perRule ?? []).length === 4, `rows=${(full.j?.counts?.perRule ?? []).length}`);
check("  and drops none", full.j && full.j.droppedRules === 0, `droppedRules=${full.j?.droppedRules}`);

console.log("=== 5. refusals exit 2, never 1 (1 already means measured FAIL) ===");
const top0 = spawnSync(process.execPath, [TOOL, "--artifact", `${dir}/good.json`, "--top", "0"], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
check("(l) --top 0 REFUSES exit 2", top0.status === 2 && /REFUSED/.test(top0.stderr || ""), `status=${top0.status} err=${(top0.stderr || "").slice(0, 200)}`);
check("  and says why (an empty tally reads as clean)", /clean|no rows|empty/i.test(top0.stderr || ""), (top0.stderr || "").slice(0, 300));
const unk = spawnSync(process.execPath, [TOOL, "--artifact", `${dir}/good.json`, "--zzz=1"], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
check("(l') an unknown option REFUSES exit 2 by name", unk.status === 2 && /--zzz/.test(unk.stderr || ""), `status=${unk.status} err=${(unk.stderr || "").slice(0, 200)}`);
const noart = spawnSync(process.execPath, [TOOL, "--json"], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
check("(l'') a missing --artifact REFUSES exit 2 (no artifact = no measurement)", noart.status === 2 && /--artifact/.test(noart.stderr || ""), `status=${noart.status} err=${(noart.stderr || "").slice(0, 200)}`);
const gone = spawnSync(process.execPath, [TOOL, "--artifact", `${dir}/does-not-exist.json`], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
check("(l''') an unreadable artifact REFUSES exit 2, naming the path", gone.status === 2 && /does-not-exist/.test(gone.stderr || ""), `status=${gone.status} err=${(gone.stderr || "").slice(0, 200)}`);
check("(m) `--artifact=path` and `--artifact path` are ONE option", (() => {
  const eq = spawnSync(process.execPath, [TOOL, `--artifact=${dir}/good.json`, "--json"], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
  if (eq.status !== 0) return false;
  const a = JSON.parse(eq.stdout); const b = JSON.parse(probe.out);
  delete a.costMs; delete b.costMs; // the only field that may differ between two runs is its own cost
  return JSON.stringify(a) === JSON.stringify(b);
})(), "the two forms printed the same document (apart from the run's own cost)");

console.log("=== 6. --out writes the document; the artifact is not touched ===");
const outDir = `${dir}/out.json`;
const w = run(["--out", outDir, "--json"], "good");
check("--out exits 0 and prints the document too", w.status === 0 && w.j, `status=${w.status}`);
check("the file written is the SAME document stdout printed", w.j && readFileSync(outDir, "utf8").trim() === w.out.trim(), w.j ? "compared" : "no document to compare");
check("the artifact's own bytes are unchanged (a read tool did not rewrite its input)", statSync(`${dir}/good.json`).size === JSON.stringify(GOOD).length, `${statSync(dir + "/good.json").size} vs ${JSON.stringify(GOOD).length}`);
check("the tmp dir holds ONLY the fixtures this test wrote + one --out file", (() => {
  const names = readdirSync(dir);
  const expected = ["good.json", "total-lie.json", "sev-lie.json", "mirror-lie.json", "pass-lie.json", "notadoc.json", "truncated.json", "preamble.json", "out.json"];
  return names.length === expected.length && expected.every((n) => names.includes(n));
})(), readdirSync(dir).join(" "));

console.log("=== 7. the human form answers in words (a session reading a 122 KB artifact) ===");
const hum = run([], "good");
check("the human report names the verdict and the per-rule tally", /per-rule/i.test(hum.out) && /runbook-stale 2/.test(hum.out), hum.out.slice(0, 500));
check("the human report names the denominator it counted over", /rig\.selfdev\.json/.test(hum.out), hum.out.slice(0, 500));
check("the human report names its own cost and host", /\d+(\.\d+)? ms/.test(hum.out) && /node v/.test(hum.out), hum.out.slice(0, 700));

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\nCHECK SUMMARIZE TEST FAIL (${failures} failure(s))` : `\nCHECK SUMMARIZE TEST PASS (0 failures)`);
process.exit(failures ? 1 : 0);
