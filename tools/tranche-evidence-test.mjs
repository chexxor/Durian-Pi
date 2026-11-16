// tools/tranche-evidence-test.mjs — the tranche's contract re-check is MEASURED, and so is its RED.
//
// FAILING-FIRST (docs/failing-first-recipe.md METHOD 1, order of operations, no git revert): this file was
// written BEFORE tools/tranche-evidence.mjs existed, so every spawn below first exits with "Cannot find
// module" — the recorded red is `node tools/tranche-evidence-test.mjs` exit 1 in 0.289 s with stderr 0 B and
// the tally `TRANCHE EVIDENCE TEST FAIL (1 checks, 31 FAIL)`, every FAIL line naming the missing module. The
// recorded GREEN is `node tools/tranche-evidence-test.mjs` exit 0 in 1.63 s, stderr 0 B, `PASS (34 checks, 0
// FAIL)`, measured on **Linux** Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1.
//
// Store-free by construction: every case drives the tool with `--table=<fixture.json>` whose commands are
// `node -e` one-liners in a temp dir, so the test costs milliseconds and never reads ./selfdev.sqlite,
// never wakes a seat, never touches a broker (the same mocked plane as the tranche's other red-first demos).
//
// The shapes pinned here, one line each:
//   1. all-expectations-hold => exit 0 and the verdict prints 0 mismatched;
//   2. one child exits against its expectation => exit 1 and THAT row is named (the re-check is per row);
//   3. a child that is SUPPOSED to fail (expect 1, the band rule firing) is not a regression => exit 0;
//   4. bytes on a child's stderr are reported, because an exit code is not the falsifier (pitfall 405);
//   5. a child over the per-child bound is RED with the bound named, never a pass and never a silent skip;
//   6. flags arrive only in `=` form; the space form and an unknown flag REFUSE with exit 2 (pitfall 394/398);
//   7. `--only`/`--skip` name rows that exist; a name matching no row REFUSES rather than running a subset
//      that reads as the whole set;
//   8. `--dry-run` runs nothing, writes nothing, and prints every row with its expectation (a plan is a plan);
//   9. the DEFAULT table (no --table) is the tranche's nine rows, census expecting exit 1 — pinned from a
//      dry-run so the demo stays store-free while the shipped table stays pinned.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const dir = mkdtempSync(`${tmpdir()}/tranchev-`);
let ok = 0;
const fails = [];

function check(cond, why) {
	if (cond) ok++;
	else fails.push(why);
}

// The exit code is read from a SHELL MARKER, not from spawnSync's field. Measured on this rig's node (v24.22.1):
// `Object.keys(spawnSync(process.execPath, ["-e","process.exit(3)"]))` prints
// `[status,signal,output,pid,stdout,stderr]` — there is NO `exitCode` key at all, for a direct spawn OR a `bash -c`
// child. A demo that reads `r.exitCode` compares `undefined` against an expectation: every such check is a FALSE
// GREEN (or a wall of FAIL lines that name nothing). `trace()` is the seam — the shell echoes its own `$?` as a
// marker, and a marker the shell never printed means the child was KILLED (a bound, a signal), never a pass.
function shq(s) {
	return `'` + String(s).replace(/'/g, `'\''`) + `'`;
}
function trace(words) {
	const cmd = words.map(shq).join(" ");
	const r = spawnSync("bash", ["-c", `{ ${cmd}
}
__te=$?
printf '__TE_EXIT=%s' "$__te"
`], { encoding: "utf8" });
	const raw = r.stdout ?? "";
	const m = raw.match(/__TE_EXIT=(\d+)\s*$/);
	return {
		code: m ? Number(m[1]) : null,
		stdout: m ? raw.slice(0, m.index) : raw,
		stderr: r.stderr ?? "",
		killed: !m,
	};
}

function table(name, rows) {
	const p = `${dir}/${name}.json`;
	writeFileSync(p, JSON.stringify(rows));
	return p;
}

function runTool(extra, outName) {
	const out = `${dir}/${outName}.json`;
	const r = trace([process.execPath, "tools/tranche-evidence.mjs", ...extra, `--json=${out}`]);
	let j = null;
	try {
		j = JSON.parse(readFileSync(out, "utf8"));
	} catch { /* the FAIL lines name what is missing */ }
	return { code: r.code, stdout: r.stdout, stderr: r.stderr, killed: r.killed, json: j };
}

function verdict(r) {
	return r.json?.verdict ?? {};
}
function row(r, name) {
	return (r.json?.rows ?? []).find((x) => x.name === name);
}

// --- 1: every expectation holds => exit 0, 0 mismatched.
{
  const t = table("green", [
    { name: "alpha", cmd: "node -e 'process.exit(0)'", expect: 0 },
    { name: "beta", cmd: "node -e 'process.exit(1)'", expect: 1 },
  ]);
  const r = runTool([`--table=${t}`], "green");
  check(r.code === 0, `all rows hold => exit 0; got ${r.code}`);
  check(r.stderr === "", `the tool's own stderr stays empty; got ${JSON.stringify(r.stderr).slice(0, 120)}`);
  check(verdict(r).mismatched === 0, `0 mismatched; got ${JSON.stringify(verdict(r))}`);
  check((r.json?.rows ?? []).length === 2, `both rows reported; got ${(r.json?.rows ?? []).length}`);
  check(r.json?.rows?.every((x) => x.holds === true), "every row carries holds:true");
}

// --- 2: ONE row against its expectation => exit 1, and the report names that row, not the first one.
{
  const t = table("one-red", [
    { name: "alpha", cmd: "node -e 'process.exit(0)'", expect: 0 },
    { name: "beta", cmd: "node -e 'process.exit(4)'", expect: 0 },
    { name: "gamma", cmd: "node -e 'process.exit(0)'", expect: 0 },
  ]);
  const r = runTool([`--table=${t}`], "one-red");
  check(r.code === 1, `a row against expectation => exit 1; got ${r.code}`);
  check(verdict(r).mismatched === 1, `exactly one mismatched; got ${JSON.stringify(verdict(r))}`);
  const b = row(r, "beta");
  check(b && b.holds === false && b.exit === 4 && b.expect === 0, `beta named with exit 4 against expect 0; got ${JSON.stringify(b)}`);
  check(row(r, "alpha")?.holds === true && row(r, "gamma")?.holds === true, "the green rows around it still report holds:true");
}

// --- 3: the census-shaped row: exit 1 is the RULE firing, so expect 1 makes it a HOLD.
{
  const t = table("expected-red", [
    { name: "census", cmd: "node -e 'process.exit(1)'", expect: 1 },
  ]);
  const r = runTool([`--table=${t}`], "expected-red");
  check(r.code === 0, `a child that fails as declared exits the tool 0; got ${r.code}`);
  check(row(r, "census")?.holds === true, "the declared-fail row holds");
}

// --- 4: stderr bytes are reported even when the exit matches (an exit code is not the falsifier).
{
  const t = table("loud", [
    { name: "loud", cmd: "node -e 'process.stderr.write(\"provider slot refused\\n\"); process.exit(0)'", expect: 0 },
  ]);
  const r = runTool([`--table=${t}`], "loud");
  check(r.code === 0, "stderr alone does not make a row red");
  const lr = row(r, "loud");
  check(lr && lr.errBytes >= 21, `the row reports its own stderr bytes (>= 21); got ${JSON.stringify(lr)}`);
  check((lr ?? {}).errBytes > 0 && (lr ?? {}).holds === true, "a row with stderr and a matching exit still holds, and says so with bytes");
}

// --- 5: a child over the per-child bound is RED, with the bound named.
{
  const t = table("slow", [
    { name: "slow", cmd: "node -e 'const c=Array(3e8).fill(0);c.reduce((a,b)=>a+b,0);process.exit(0)'", expect: 0 },
  ]);
  const r = runTool([`--table=${t}`, "--budget=1"], "slow");
  check(r.code === 1, `a child over the bound => exit 1; got ${r.code}`);
  const s = row(r, "slow");
  check(s && s.holds === false, `the timed-out row is not a hold; got ${JSON.stringify(s)}`);
  check(s && (s.reason || "").includes("budget"), `the row names the bound as the reason; got ${JSON.stringify(s)}`);
}

// --- 6: flags arrive only in `=` form; the space form and an unknown flag REFUSE (exit 2).
{
  const t = table("flags", [{ name: "alpha", cmd: "node -e 'process.exit(0)'", expect: 0 }]);
  const space = trace([process.execPath, "tools/tranche-evidence.mjs", "--table", t]);
  check(space.code === 2, `the space form of --table refuses with exit 2; got ${space.code}`);
  check(!space.killed, "the refusal was RUN, not killed (its exit is a real one)");
  check(/space form|REFUS/i.test(space.stdout) || /space form|REFUS/i.test(space.stderr), "the refusal names the form it refuses");
  const unknown = trace([process.execPath, "tools/tranche-evidence.mjs", "--frobnicate=1"]);
  check(unknown.code === 2, `an unknown flag refuses with exit 2; got ${unknown.code}`);
  check(!unknown.killed, "the unknown-flag refusal was RUN, not killed");
  check(/unknown|REFUS/i.test(unknown.stdout) || /unknown|REFUS/i.test(unknown.stderr), "the refusal names the unknown flag");
}

// --- 7: --only / --skip subset the rows, and a name that matches no row REFUSES.
{
  const t = table("subset", [
    { name: "alpha", cmd: "node -e 'process.exit(0)'", expect: 0 },
    { name: "beta", cmd: "node -e 'process.exit(0)'", expect: 0 },
  ]);
  const only = runTool([`--table=${t}`, "--only=beta"], "only");
  check(only.code === 0 && (only.json?.rows ?? []).length === 1 && row(only, "beta"), `--only=beta runs exactly that row; got ${JSON.stringify(only.json?.rows)}`);
  const skip = runTool([`--table=${t}`, "--skip=beta"], "skip");
  check(skip.code === 0 && (skip.json?.rows ?? []).length === 1 && row(skip, "alpha"), `--skip=beta runs the other row; got ${JSON.stringify(skip.json?.rows)}`);
  const bogus = runTool([`--table=${t}`, "--only=nope"], "bogus");
  check(bogus.code === 2 || bogus.code === 1, `a --only name matching no row does not exit as a clean whole-set pass; got ${bogus.code}`);
  check(/nope/.test(`${bogus.stdout}${bogus.stderr}`), "the bad name is echoed, not swallowed");
}

// --- 8: --dry-run runs nothing, writes nothing, and prints every row with its expectation.
{
  const t = table("plan", [
    { name: "alpha", cmd: "node -e 'process.exit(0)'", expect: 0 },
    { name: "beta", cmd: "node -e 'process.exit(1)'", expect: 0 },
  ]);
  const outName = `${dir}/plan-dry.json`;
  const r = trace([process.execPath, "tools/tranche-evidence.mjs", `--table=${t}`, "--dry-run", `--json=${outName}`]);
  check(r.code === 0, "a plan pass exits 0");
  let wrote = true;
  try {
    readFileSync(outName, "utf8");
  } catch {
    wrote = false;
  }
  check(!wrote, "--dry-run writes nothing (the plan is not the record)");
  check(/alpha/.test(r.stdout ?? "") && /beta/.test(r.stdout ?? ""), "the plan names every row and its expectation");
}

// --- 9: the shipped DEFAULT table is the tranche's rows, census expecting exit 1.
{
  const r = trace([process.execPath, "tools/tranche-evidence.mjs", "--dry-run"]);
  const out = r.stdout;
  check(r.code === 0, "the default table dry-runs exit 0");
  check(/census/.test(out), "the default table has the census row");
  check(/docs/.test(out), "the default table has the docs-area row (the pair a docs carrier owes)");
  check(/expect=1/.test(out), "the census row is declared expect 1 (the band rule is SUPPOSED to fail)");
}

rmSync(dir, { recursive: true, force: true });

process.stdout.write(`TRANCHE EVIDENCE TEST ${fails.length ? "FAIL" : "PASS"} (${ok} checks, ${fails.length} FAIL)\n`);
if (fails.length) {
  process.stdout.write("\n" + fails.map((f) => "  FAIL " + f).join("\n") + "\n");
}
process.exit(fails.length ? 1 : 0);
