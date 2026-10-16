// demo/check-autodiscover.test.mjs — #491 C8 (item #623, landed 0281f30): `check`
// discovers rig.json upward when no path is given, with provenance.
//
// The PROMISED artifact of #623 (qa DONE #653 flagged: the named demo file was
// absent while the logic demonstrably worked — the missing-demo promise, landed
// now by impl on item #665's close-out).
//
// ONE concern: check's auto-discovery + provenance surface. NOT covered here:
// audit rules themselves (demo/check.test.mjs), or the object-form-rig crash
// qa found in resolveModelsBySeat (a standing pre-existing defect, disclosed —
// the shipped rig.json/rig.starter.json use the canonical ARRAY form).
//
// Headless/temp-cwd contract (same class as demo/errorwording.test.mjs): every
// case drives the REAL cli from a fresh temp dir chain with DURIG_DB pointed at
// an ABSENT store, so the store-dependent check rules skip with their why and
// the audit of the copied starter exits 0.
//
// Run: node demo/check-autodiscover.test.mjs  (exit 0 = pass)

import assert from "node:assert";
import { mkdtempSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const durigDir = dirname(fileURLToPath(new URL("../cli.mjs", import.meta.url)));
const STARTER = join(durigDir, "rig.starter.json");

/** Drive the real cli from `cwd` with an env; resolves { code, stdout, stderr }. */
const runCli = (args, cwd, env = {}) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, [join(durigDir, "cli.mjs"), ...args], {
			cwd,
			env: {
				...process.env,
				DURIG_DB: join(tmpdir(), "durig-autodiscover-absent.sqlite"),
				DURIG_NO_SERVE: "1",
				...env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else { failures += 1; console.log(`  FAIL ${label}${detail ? " -- " + detail : ""}`); }
}

try {
	console.log("\n=== C8: check auto-discovers rig.json (provenance) ===\n");

	const dir = mkdtempSync(join(tmpdir(), "durig-autodisc-"));
	// outer/ holds the rig; inner/ holds the invocation: discovery must find
	// the PARENT's rig.json and report its resolved path.
	const outer = join(dir, "outer");
	const inner = join(outer, "inner");
	mkdirSync(inner, { recursive: true });
	copyFileSync(STARTER, join(outer, "rig.json"));
	// The bare/empty store: DURIG_DB points at a path whose file does not exist,
	// so check reads the file-only audit and skips store rules with a reason.
	const NOMATCH = join(dir, "nomatch");
	mkdirSync(NOMATCH, { recursive: true });

	console.log("1. bare check from inner/ finds the parent rig.json");
	{
		const r = await runCli(["check"], inner);
		const json = JSON.parse(r.stdout);
		assert.equal(r.code, 0, `exit 0 (starter audits clean at absent store) -- ${r.stdout.slice(0, 400)}`);
		assert.equal(json.ok, true);
		assert.equal(json.discovered, true, "discovered provenance is true");
		assert.ok(json.rig.endsWith(join("outer", "rig.json")),
			`rig names the resolved parent path -- ${json.rig}`);
		assert.equal(json.store, "absent", "absent store reads as a skipped-reason fact, not an error");
		check("discovered:true + resolved parent path + absent store", true);
	}

	console.log("2. `check auto` and `check .` take the same discovery path");
	{
		const rAuto = await runCli(["check", "auto"], inner);
		assert.equal(rAuto.code, 0, rAuto.stdout.slice(0, 300));
		const jAuto = JSON.parse(rAuto.stdout);
		assert.equal(jAuto.discovered, true);
		const rDot = await runCli(["check", "."], inner);
		assert.equal(rDot.code, 0, rDot.stdout.slice(0, 300));
		const jDot = JSON.parse(rDot.stdout);
		assert.equal(jDot.discovered, true);
		check("auto/. aliases => discovered:true, exit 0", true);
	}

	console.log("3. a discovered audit vs a named one on the human surface (stderr note)");
	{
		const r = await runCli(["check", "--discovered:false", join(outer, "rig.json")], inner);
		assert.equal(r.code, 0, r.stdout.slice(0, 300));
		const j = JSON.parse(r.stdout);
		assert.equal(j.discovered, false, "explicit path is provenance-false");
		check("explicit path => discovered:false (no discovery run)", true);
	}

	console.log("4. no rig.json anywhere upward => loud exit 1 with the scaffold message");
	{
		const r = await runCli(["check"], NOMATCH);
		assert.equal(r.code, 1, `exit 1 -- ${r.stdout.slice(0, 300)}`);
		const json = JSON.parse(r.stdout);
		assert.equal(json.ok, false);
		assert.match(json.error, /no rig\.json found in this directory or its parents/);
		assert.match(json.error, /node cli\.mjs up rig\.starter\.json/, "the scaffold message, not a bare usage error");
		check("no-match => ok:false + scaffold message (exit 1)", true);
	}

	console.log("5. --discovered:false without a path is a usage error, not a discovery");
	{
		const r = await runCli(["check", "--discovered:false"], inner);
		assert.equal(r.code, 1, `usage exit -- ${r.stdout.slice(0, 300)}`);
		const json = JSON.parse(r.stdout);
		assert.equal(json.ok, false);
		assert.match(json.error, /auto-discovery is disabled/);
		check("--discovered:false with no path => loud usage error", true);
	}

	rmSync(dir, { recursive: true, force: true });

	console.log(failures === 0
		? "\nC8 AUTO-DISCOVER TEST PASS"
		: `\nFAIL - ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err?.stack ?? err);
	process.exitCode = 1;
}
process.exitCode = failures === 0 ? 0 : 1;
