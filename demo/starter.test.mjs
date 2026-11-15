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

// AUTHOR WARNING (#977, D83): a byte-equality compare MUST be EOL-insensitive. This repo has
// core.autocrlf=true, so the LF blob is checked out as CRLF while a JSON-parsed inline copy
// carries LF — a raw `a === b` then flakes by platform/checkout. Normalize CRLF->LF on BOTH
// sides before comparing (the file-scoped .gitattributes half is a separate item, #1055).
const lf = (text) => String(text ?? "").replace(/\r\n/g, "\n");

const dir = mkdtempSync(join(tmpdir(), "durig-starter-"));

// THE FIXTURE NAMES ITS OWN CONFIG (found 2026-11-15 at `0f14e998`). `cli.mjs check` runs EVERY armed rule over
// `process.cwd()`, so a fixture that inherits the LIVE rig's config also runs the live rig's EXTENSION rules over
// the live repo: `ready-ref-stale` reported `item-3570-recut` ready and 24.1 h past its 24 h SLA, which failed the
// "check must exit 0 on the starter" assertion below. The proof it read the host and not the fixture is in the
// finding itself — its `fix` names the FIXTURE store (`queue status no-row`) while its git facts came from the live
// repo. The starter rig is the BASE surface (`durian-core` ships with NO armed extension, durig.config.example.json),
// so the fixture says so: `DURIG_CONFIG` is precedence 1 in src/config.mjs.
const baseConfig = join(dir, "base-config.json");
writeFileSync(baseConfig, JSON.stringify({ DURIG_EXTENSIONS: "" }));

/** Run cli.mjs against a scratch database and return its parsed JSON. */
function cli(args, dbName) {
	const r = spawnSync(process.execPath, ["cli.mjs", ...args], {
		cwd: durigDir,
		env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: join(dir, `${dbName}.sqlite`), DURIG_CONFIG: baseConfig },
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
	// path resolves against the CWD, so it would only work from durian-pi's own
	// directory). That copy must not silently drift from the text durian-pi ships.
	// Compare EOL-insensitively (#977/D83): the inline carries LF, the disk file CRLF.
	assert.equal(
		lf(spec.constitutionInline),
		lf(readFileSync(join(durigDir, "constitution.txt"), "utf8")),
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
	// #6374: the dependency-plane rule measures the CHECKOUT this CLI runs from, not the starter rig, so
	// its verdict legitimately differs between a tree on the pin and an un-linked worktree. The starter
	// itself must still be clean, and the plane finding must match the measurement exactly.
	assert.ok(result.json.plane?.line, "check did not measure the dependency plane of the tree it ran in");
	const rigFindings = result.json.findings.filter((f) => f.id !== "pi-dependency-plane");
	assert.equal(rigFindings.length, 0, `starter has findings of its own: ${JSON.stringify(rigFindings)}`);
	assert.equal(result.json.summary.error, 0, "the starter has error findings");
	const expectedPlaneFindings =
		(result.json.plane.versionAgrees ? 0 : 1) +
		(result.json.plane.storeSchema > result.json.plane.supportedSchema ? 1 : 0);
	assert.equal(
		result.json.findings.filter((f) => f.id === "pi-dependency-plane").length,
		expectedPlaneFindings,
		"the dependency-plane finding appears exactly when the measured plane disagrees with the pin",
		);
	// "0 findings" would also be true if every rule bailed out, so require that
	// each one genuinely ran. A `skipped` status here means the starter is being
	// audited by a check that could not actually judge it.
	for (const c of result.json.checks) {
		// The runbook rules need runbook data the CLI does not supply yet (item 86 wires the caller to
		// read docs/runbooks/*), so they are legitimately SKIPPED here - and must say why.
		if (c.id.startsWith("runbook-")) {
			assert.equal(c.status, "unknown", `rule ${c.id} is "${c.status}", not "unknown": the CLI passes no runbook data yet, so it cannot judge (#5767)`);
			assert.ok(c.why, `rule ${c.id} reports unknown without a reason`);
			continue;
		}
		// The FEATURES-row rule (ROADMAP 46 / D62) needs git-history data the CLI does
		// not supply yet (the wiring is a separate, serialized item), so it is
		// legitimately SKIPPED here - and must say why.
		if (c.id === "feature-row-missing") {
			assert.equal(c.status, "skipped", `rule ${c.id} is "${c.status}", not "skipped": the CLI passes no git-history data yet`);
			assert.ok(c.why, `rule ${c.id} skips without a reason`);
			continue;
		}
		// The starter deliberately declares no `ownership` block (a bare starter rig
		// must stay clean — ROADMAP 46 / #714), so that rule is SKIPPED with a reason,
		// not passed. Every other rule must genuinely run and pass.
		if (c.id === "ownership-seat-missing") {
			assert.equal(c.status, "skipped", `the starter must skip ${c.id}, got "${c.status}"`);
			assert.ok(c.why, `${c.id} must state why it was skipped`);
			continue;
		}
		// The shared-tree rule judges the SHARED tree's branch. In a LINKED worktree (a landing
		// scratch or a seat/item worktree - `scripts/land.mjs --suite` runs this very suite in a
		// detached scratch, #2679) that branch cannot be observed from here, so the rule is
		// legitimately SKIPPED with a reason, like the runbook/FEATURES/ownership rules above.
		// Anywhere else it must genuinely run and pass.
		if (c.id === "shared-tree-on-main" && c.status === "skipped") {
			assert.match(c.why ?? "", /LINKED worktree/, `rule ${c.id} skipped for an unexpected reason`);
			continue;
		}
		// #6374: this rule judges the tree the check runs in, not the rig, so it is the one rule that may
		// legitimately FAIL here (an un-linked worktree resolves the lockfile's pi, not the pin's). It must
		// still RUN, and every finding it raises must carry a runnable fix.
		if (c.id === "pi-dependency-plane") {
			assert.ok(c.status === "pass" || c.status === "fail", `${c.id} is "${c.status}" - it must run, not skip`);
			for (const f of result.json.findings.filter((f) => f.id === c.id)) {
				assert.match(f.fix ?? "", /sync-pi\.mjs|npm install/, `${c.id} names no runnable fix: ${f.fix}`);
			}
			continue;
		}
		assert.equal(c.status, "pass", `rule ${c.id} is "${c.status}", not "pass": ${c.why ?? ""}`);
	}

	/* ------------------------------------- controls: every rule can fail */

	// 1. Declared but not applied — the exact defect `check` was built from.
	//    Note the distinction: a store that does not EXIST reports
	//    constitution-not-applied as *skipped* (absent cannot be told from
	//    unread), so this control needs a store that exists and was never upped.
	// The store has to EXIST for that distinction, and since #4955 `ps` no longer creates it, so this
	// control opens it once the way a WRITER does (an empty store, never upped).
	{
		const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
		const made = await openNodeSqliteStorage(join(dir, "never-upped.sqlite"));
		await made.close();
	}
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
		"runbook-stale": "demo/runbook-rules.test.mjs",
		"runbook-unverified": "demo/runbook-rules.test.mjs",
		"runbook-front-matter": "demo/runbook-frontmatter.test.mjs",
		"ownership-seat-missing": "demo/ownership.test.mjs",
		"verification-without-evidence": "demo/check-evidence.test.mjs",
		"evidence-tree": "demo/check-evidence.test.mjs",
		"citation-unresolvable": "demo/checkup-citation.test.mjs",
		"feature-row-missing": "demo/feature-row.test.mjs",
		"shared-tree-on-main": "demo/shared-tree-on-main.test.mjs",
		"duplicate-item": "demo/duplicate-item.test.mjs",
		"text-integrity": "demo/text-integrity-wiring.test.mjs",
		"commit-message-encoding": "demo/commit-message-encoding.test.mjs",
		"context-over-window": "demo/context-over-window.test.mjs",
		"doc-count-drift": "demo/doc-count-drift.test.mjs",
		"stranded-gate": "demo/queue-ops.test.mjs",
		"human-deferral-past-clock": "demo/human-defer-lease.test.mjs",
		"pool-dead-gate": "demo/check-pool-gate.test.mjs",
		"pool-claim-without-capability": "demo/check-pool-gate.test.mjs",
		"pi-dependency-plane": "demo/depplane.test.mjs", // #6374: a mismatched plane is driven there, and the no-data case is pinned as UNKNOWN
	"queue-pressure": "demo/queue-pressure.test.mjs", // out of band AND growing-past-the-fleet fire; a net +4 inside the band does not
		"registration-as-work": "demo/queue-pressure.test.mjs", // a QUEUED registration fires; a held one and a notice whose subject names registration words do not
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
