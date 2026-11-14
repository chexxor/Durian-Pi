// demo/suite-runner-exit-verdict.test.mjs — #6268: scripts/suite.mjs must read the EXIT CODE,
// not wait for the child's stdio to close.
//
// WHY THIS EXISTS. #6104 fixed exactly this in scripts/test.mjs (see
// demo/test-runner-concurrency.test.mjs §8 and docs/runbooks/suite-red-standalone-green.md):
// a demo that spawns a child and does not reap it keeps the pipe's WRITE END open, so `close`
// does not fire until that grandchild exits. scripts/suite.mjs still used `child.once("close")`
// to decide the verdict. Measured on the base tree (`e01e9256`) before this change: a fixture
// that printed PASS and exited 0 with a detached 30 s grandchild took the runner **30.108 s**
// to report it. Under the 300 s default timeout a longer linger makes a GREEN demo report as a
// timeout FAILURE, and every leak steals a pool slot for the length of the leak.
//
// THE CONTRACT pinned here:
//   1. the verdict comes from the exit event; a passing demo that leaves a child alive is
//      reported GREEN, promptly (wall clock, not vibes);
//   2. a failing demo is still FAILED, even while a child lingers — the fix must not swallow
//      real failures;
//   3. a hung demo is still bounded: it is killed at the timeout and reported as exit 124;
//   4. stderr is still captured well enough to classify an environmental abort (the grace,
//      not the close, bounds it);
//   5. NO row is silently dropped: pass + environmental + fail == the number of demos.
//
// It runs against fixtures in a temp root, never the real suite, copying the real runner and the
// one module it imports so the code path under test is the code that ships.
// Run: node demo/suite-runner-exit-verdict.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "durig-suite-verdict-"));
mkdirSync(join(root, "demo"), { recursive: true });
mkdirSync(join(root, "scripts"), { recursive: true });
mkdirSync(join(root, "src"), { recursive: true });

// The real runner, verbatim. It imports ../src/suite.mjs relative to its own location, so the
// classifier must be next to it.
copyFileSync(join(ROOT, "scripts", "suite.mjs"), join(root, "scripts", "suite.mjs"));
copyFileSync(join(ROOT, "src", "suite.mjs"), join(root, "src", "suite.mjs"));

const LINGER_MS = 8000;
const fixtures = {
	// Exits 0 immediately, but leaves a detached grandchild holding the stderr pipe open.
	"linger.test.mjs": `import { spawn } from "node:child_process";
spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), ${LINGER_MS})"], { stdio: "inherit", detached: true });
console.log("linger PASS");
process.exit(0);
`,
	"plain.test.mjs": 'console.log("plain PASS"); process.exit(0);\n',
	"failing.test.mjs": 'console.error("assertion failed: expected 1"); process.exit(1);\n',
	// Fails AND lingers: the verdict must still come from the exit code, promptly.
	"failing-linger.test.mjs": `import { spawn } from "node:child_process";
spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), ${LINGER_MS})"], { stdio: "inherit", detached: true });
console.error("real failure"); process.exit(1);
`,
	"hangs.test.mjs": 'setTimeout(() => process.exit(0), 600000); // never returns\n',
	// A resource abort, written to stderr before a nonzero exit: the classifier must still see it.
	"starved.test.mjs": 'console.error("STATUS_COMMITMENT_LIMIT exceeded"); process.exit(3221225773);\n',
};
for (const [name, body] of Object.entries(fixtures)) writeFileSync(join(root, "demo", name), body);

const runner = join(root, "scripts", "suite.mjs");
/** Write EXACTLY the named fixtures into the temp demo dir, then run the real runner over them.
 * The runner discovers every demo in its own directory, so a run must not leave other fixtures
 * lying around or it will execute them too. */
function run(files, env = {}) {
	for (const name of readdirSync(join(root, "demo"))) rmSync(join(root, "demo", name), { force: true });
	for (const name of files) writeFileSync(join(root, "demo", name), fixtures[name]);
	const before = Date.now();
	const r = spawnSync(process.execPath, [runner, "--jobs", "2"], {
		cwd: root,
		env: { ...process.env, ...env },
		timeout: 120000,
	});
	return { ...r, wallMs: Date.now() - before, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

try {
	console.log("\n1. a demo that exits 0 but leaves a child alive is GREEN, and promptly");
	{
		writeFileSync(join(root, "demo/failing.test.mjs"), fixtures["failing.test.mjs"]);
		const r = run(["plain.test.mjs", "linger.test.mjs"]);
		check(`the run reported GREEN (got exit ${r.status}): ${r.out.trim().split("\n").pop()}`, r.status === 0, r.out);
		check(`the wall clock is ${r.wallMs}ms, not the ${LINGER_MS}ms the grandchild lingers`, r.wallMs < 4000, `wall=${r.wallMs}ms`);		check("both demos are counted", /pass=2 environmental=0 fail=0/.test(r.out), r.out.trim());
	}

	console.log("\n2. a real failure is still FAILED, even while a child lingers");
	{
		const r = run(["failing-linger.test.mjs"]);
		check("exit 1 (the verdict), not 0", r.status === 1, `exit=${r.status} ${r.out}`);
		check("the failing demo is named in the report", /FAIL demo\/failing-linger\.test\.mjs/.test(r.out), r.out.trim());
		check(`reported in ${r.wallMs}ms, not ${LINGER_MS}ms`, r.wallMs < 4000, `wall=${r.wallMs}ms`);
	}

	console.log("\n3. a hung demo is still bounded and reported as a failure");
	{
		const r = run(["hangs.test.mjs"], { DURIG_SUITE_TIMEOUT_MS: "2000" });
		check("the hang is a FAILURE, exit 1", r.status === 1, `exit=${r.status}`);
		check("the reason names the timeout and the code it reports", /timed out \(killed at the suite timeout, exit 124\)/.test(r.out), r.out.trim());
		check("it did not wait for the 600s sleep", r.wallMs < 8000, `wall=${r.wallMs}ms`);
	}

	console.log("\n4. environmental classification still works (the stderr grace is not the pipe close)");
	{
		const r = run(["starved.test.mjs"]);
		check("the commitment-limit abort is ENVIRONMENTAL, not a regression", r.status === 2 && /ENV  demo\/starved\.test\.mjs/.test(r.out), `exit=${r.status} ${r.out.trim()}`);
		check("the verdict line says so", /ENVIRONMENTALLY-BLOCKED/.test(r.out), r.out.trim());
	}

	console.log("\n5. nothing is silently dropped from the verdict");
	{
		const r = run(["plain.test.mjs", "failing.test.mjs", "starved.test.mjs"]);
		const line = r.out.match(/SUITE \w+: pass=(\d+) environmental=(\d+) fail=(\d+)/);
		const sum = line ? Number(line[1]) + Number(line[2]) + Number(line[3]) : -1;
		check(`pass+environmental+fail = ${sum} equals demos=3`, sum === 3, r.out.trim());
	}

	console.log(failures === 0
		? "\nPASS — scripts/suite.mjs decides from the exit code and does not wait for the pipe"
		: `\nFAIL — ${failures} check(s) failed`);
	process.exit(failures === 0 ? 0 : 1);
} finally {
	rmSync(root, { recursive: true, force: true });
}
