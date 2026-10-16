// demo/starter.test.mjs — the hardened starter rig, checked rather than asserted.
//
// Item 1's other half: `check` can already *detect* a bad rig, but nothing handed
// a new user a good one. `rig.starter.json` is that rig, and this test is what
// keeps it good — a starter that silently stops passing its own linter is worse
// than no starter, because it teaches the wrong configuration confidently.
//
// The negative controls are the load-bearing part. "0 findings" is also what a
// rig produces when every rule is skipped, so each rule is shown firing on a
// deliberately broken copy of the same file.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES } from "../src/checkup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const durigDir = join(here, "..");
const STARTER = join(durigDir, "rig.starter.json");

const dir = mkdtempSync(join(tmpdir(), "durig-starter-"));

/** Run cli.mjs against a scratch database and return its parsed JSON. */
function cli(args, dbName) {
	const r = spawnSync(process.execPath, ["cli.mjs", ...args], {
		cwd: durigDir,
		env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: join(dir, `${dbName}.sqlite`) },
		encoding: "utf8",
	});
	let json = null;
	try {
		json = JSON.parse(r.stdout);
	} catch {
		// Human output, or a crash: the text is kept for the assertion message.
	}
	return { status: r.status, json, text: `${r.stdout}${r.stderr}` };
}

/** A copy of the starter with one thing broken, written beside the temp DBs.
 * Inline constitution means the copy works from any directory. */
function broken(name, mutate) {
	const spec = JSON.parse(readFileSync(STARTER, "utf8"));
	mutate(spec);
	const path = join(dir, name);
	writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
	return path;
}

const findingIds = (result) => result.json?.findings?.map((f) => f.id) ?? [];

/** Assert a control produced the finding it was built to produce. */
function mustFind(label, result, id) {
	const ids = findingIds(result);
	assert.ok(
		ids.includes(id),
		`${label}: expected finding "${id}", got [${ids.join(", ") || "none"}] (exit ${result.status})`,
	);
}

try {
	/* ------------------------------------------------------------ the file */

	const spec = JSON.parse(readFileSync(STARTER, "utf8"));
	assert.equal(spec.version, 2, "the starter uses the current spec version");
	assert.equal(spec.seats.length, 4, "the starter is deliberately the small rig");
	assert.ok(
		spec.seats.length >= 2,
		"a one-seat rig cannot satisfy the verifier rule, and the starter must satisfy it",
	);

	// The constitution is inline so the file is self-contained (a `constitution`
	// path resolves against the CWD, so it would only work from durig's own
	// directory). That copy must not silently drift from the text durig ships.
	assert.equal(
		spec.constitutionInline,
		readFileSync(join(durigDir, "constitution.txt"), "utf8"),
		"the inline constitution has drifted from constitution.txt — regenerate the starter",
	);

	// Restrictive edges mean every seat needs an outgoing link, or it can only be
	// sent to and never reply (the D16 bug class this rig shape exists to avoid).
	const edgeFrom = (name) => spec.edges.find((e) => e.from === name);
	for (const seat of spec.seats) {
		const e = edgeFrom(seat.name);
		assert.ok(
			e && e.maySendTo.length > 0,
			`seat "${seat.name}" has no outgoing edge, so check's unreachable-seat rule will fail the starter`,
		);
	}

	/* ------------------------------------------- the claim: it passes check */

	const applied = cli(["up", STARTER], "applied");
	assert.equal(applied.status, 0, `up failed: ${applied.text.slice(0, 400)}`);

	const result = cli(["check", STARTER], "applied");
	assert.equal(result.status, 0, `check must exit 0 on the starter:\n${result.text.slice(0, 600)}`);
	assert.equal(result.json.store, "read", "check must have read a store, or the rules assert nothing");
	for (const key of ["error", "fix-now"]) {
		assert.equal(result.json.summary[key], 0, `starter has ${key} findings: ${JSON.stringify(result.json.findings)}`);
	}
	// "0 findings" would also be true if every rule bailed out, so require that
	// each one genuinely ran. A `skipped` status here means the starter is being
	// audited by a check that could not actually judge it.
	for (const c of result.json.checks) {
		// The starter deliberately declares no `ownership` block (a bare starter rig
		// must stay clean — ROADMAP 46 / #714), so that rule is SKIPPED with a reason,
		// not passed. Every other rule must genuinely run and pass.
		if (c.id === "ownership-seat-missing") {
			assert.equal(c.status, "skipped", `the starter must skip ${c.id}, got "${c.status}"`);
			assert.ok(c.why, `${c.id} must state why it was skipped`);
			continue;
		}
		assert.equal(c.status, "pass", `rule ${c.id} is "${c.status}", not "pass": ${c.why ?? ""}`);
	}

	/* ------------------------------------- controls: every rule can fail */

	// 1. Declared but not applied — the exact defect `check` was built from.
	//    Note the distinction: a store that does not EXIST reports
	//    constitution-not-applied as *skipped* (absent cannot be told from
	//    unread), so this control needs a store that exists and was never upped.
	const created = cli(["ps"], "never-upped");
	assert.equal(created.status, 0, `ps failed: ${created.text.slice(0, 300)}`);
	const notApplied = cli(["check", STARTER], "never-upped");
	assert.equal(notApplied.status, 1, "an unapplied constitution must fail the run");
	mustFind("never-upped store", notApplied, "constitution-not-applied");

	// The same file with a store that does not exist at all passes, and says so
	// by naming the rule it could not judge. Asserting this keeps the two cases
	// from being collapsed into one.
	const noStore = cli(["check", STARTER], "totally-absent");
	assert.equal(noStore.status, 0, "a rig that was never run has no applied-state defect to report");
	assert.equal(noStore.json.store, "absent");
	const skippedRule = noStore.json.checks.find((c) => c.id === "constitution-not-applied");
	assert.equal(skippedRule.status, "skipped", "with no store, the applied-state rule must be skipped, not passed");

	// 2. One model everywhere: drop the verifier's second family.
	const sameModel = broken("same-model.json", (s) => {
		delete s.seats.find((x) => x.name === "qa").model;
	});
	mustFind("single-model rig", cli(["check", sameModel], "same-model"), "single-model-rig");

	// 3. A seat with no outgoing edge.
	const stranded = broken("stranded.json", (s) => {
		s.edges = s.edges.filter((e) => e.from !== "impl");
	});
	mustFind("stranded seat", cli(["check", stranded], "stranded"), "unreachable-seat");

	// 4. An edge to a seat that does not exist: dead routing that only fails at
	//    send time, long after the config looked fine.
	const dangling = broken("dangling.json", (s) => {
		s.edges.push({ from: "pm", maySendTo: ["ghost"] });
	});
	mustFind("dangling edge", cli(["check", dangling], "dangling"), "dangling-edge");

	// 5. No verifier seat: rename the one whose name carries it.
	const unverified = broken("unverified.json", (s) => {
		const qa = s.seats.find((x) => x.name === "qa");
		qa.name = "helper";
		qa.role = "code helper";
		s.edges = s.edges.map((e) => ({
			from: e.from === "qa" ? "helper" : e.from,
			maySendTo: e.maySendTo.map((to) => (to === "qa" ? "helper" : to)),
		}));
	});
	mustFind("no verifier", cli(["check", unverified], "unverified"), "no-verifier-seat");

	// 6. A seat that declares no capabilities. Per-seat tool scoping is derived from capabilities,
	//    so such a seat silently becomes a coordinator with no file or shell tools - it cannot work,
	//    and from outside it just looks like a seat deferring everything.
	const capless = broken("capless.json", (s) => {
		delete s.seats.find((x) => x.name === "impl").capabilities;
	});
	mustFind("seat with no capabilities", cli(["check", capless], "capless"), "seat-without-capabilities");

	/* ------------------------- coverage: no rule may go uncontrolled */

	// The whole point of the controls above is that "0 findings" means nothing unless every rule can
	// be shown to fail. That was true for FIVE of the eight rules when this file was written, and a
	// rule added afterwards was covered by nothing - which is how `seat-without-capabilities` arrived
	// with only an ad-hoc manual check. This ledger makes the gap impossible to miss: a new rule in
	// RULES with no control recorded here fails the suite and names itself.
	const CONTROL_FOR = {
		"constitution-missing": "demo/check.test.mjs",
		"constitution-not-applied": "this file, control 1",
		"unreachable-seat": "this file, control 3",
		"dangling-edge": "this file, control 4",
		"store-missing-seat": "demo/check.test.mjs",
		"stray-seat": "demo/check.test.mjs",
		"no-verifier-seat": "this file, control 5",
		"single-model-rig": "this file, control 2",
		"seat-without-capabilities": "this file, control 6",
		"ownership-seat-missing": "demo/ownership.test.mjs",
	};
	for (const rule of RULES) {
		assert.ok(
			CONTROL_FOR[rule.id],
			`rule "${rule.id}" has no negative control anywhere; add one and record it in CONTROL_FOR`,
		);
	}
	// ...and the other direction: an entry for an id that is no longer a rule means a rule was
	// RENAMED and its control silently orphaned, which would read as coverage while proving nothing.
	const knownRules = new Set(RULES.map((r) => r.id));
	for (const id of Object.keys(CONTROL_FOR)) {
		assert.ok(knownRules.has(id), `CONTROL_FOR names "${id}", which is not a rule any more`);
	}
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}

// After the finally: an exit inside the try would skip cleanup entirely.
console.log("STARTER TEST PASS (passes every rule, and each rule is shown failing)");
process.exit(0);
