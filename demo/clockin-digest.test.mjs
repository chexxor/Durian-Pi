// demo/clockin-digest.test.mjs — the cold-start digest (scripts/clockin.mjs, D126) is BOUNDED,
// BODY-FREE, and does not trust its own broker state file.
//
// FAILING-FIRST: before `scripts/clockin.mjs` existed this file could not even import what it
// tests. The rule it guards is an economic one, measured on 2026-10-25: the clock-in ritual cost a
// new session ~113,000 tokens (docs/NEXT.md was 394,106 B / ~99k tok and overflowed a 50 KB read cap
// into eight chunked reads; docs/SELFDEV.md 57,589 B; `cli.mjs status` 22.7 MB; `cli.mjs queue`
// 21.2 MB). A digest that silently grows back into those dumps, or that prints queue row bodies, or
// that reports a broker as live because a state file exists, has stopped doing the one job it exists for.
//
// Run: node demo/clockin-digest.test.mjs   (exit 0 = pass)
//
// Section 7 is the part that must not be skipped in review: the landing gate (`scripts/land.mjs --changed-suite`)
// runs the suite in a DETACHED scratch worktree, and `git rev-list --count main..(no branch)` (fatal, exit 128,
// measured on git 2.56.0) is what made THIS file red and stopped the item-4966 landing at 129/242 tests (#4985).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DIGEST_BUDGET_BYTES,
	POINTER_CAP_LINES,
	branchDebt,
	brokerLiveness,
	pidAlive,
	pointerSection,
	queueCounts,
	renderDigest,
	suiteMarker,
} from "../scripts/clockin.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-clockin-"));
const cli = (args, env, cwd = ROOT) => {
	const r = spawnSync(process.execPath, args, {
		cwd,
		env: { ...process.env, ...env },
		encoding: "utf8",
		timeout: 120000,
	});
	// spawnSync reports the exit code as `status`; reading `.code` yields undefined and turns a
	// successful run into a mystery failure.
	return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

try {
	// 1. NO ROW BODIES, EVER. Bodies are the entire reason `status`/`queue` are tens of megabytes.
	const BODY = "THE FULL BODY TEXT OF A QUEUE ITEM. ".repeat(120); // ~4.3 KB, like the real ones
	const items = [
		{ id: 4001, to: "impl", subject: "BUILD the digest verb", status: "done", body: BODY },
		{ id: 4002, to: "qa2", subject: "VERIFY the digest verb", status: "deferred", body: BODY },
		{ id: 4003, to: "pm", subject: "ROUTE the follow-on", status: "held", body: BODY },
		{ id: 4004, to: "lead", subject: "NOTICE the cost", status: "deferred", body: BODY },
	];
	const text = renderDigest({
		pointer: {
			lines: ["## NEXT SESSION (test)", "", "**Current item:** the digest.", "**Blocker:** none."],
			start: 1,
			end: 4,
			fileLines: 9,
		},
		seats: 3,
		attention: [
			{
				seat: "impl",
				kind: "last_run_failed",
				detail: "model_error: 402: You need positive balance to do inference",
			},
			{
				seat: "qa2",
				kind: "deferred_awaiting_answer",
				detail: "1 item(s) parked on a question; #4002 waiting on human",
			},
		],
		broker: brokerLiveness({ stateFile: join(dir, "absent.sqlite.broker.json") }),
		items,
		counts: queueCounts(items),
		git: { refs: 4, worktrees: 2, debt: ["item-4001 +1 [#4001 done]"] },
		runbooks: {
			dated: 28,
			stale: [{ file: "land.md", last: "2026-10-21", changed: ["src/checkup.mjs"] }],
			probeFailures: 0,
		},
		config: { provider: "deepinfra", model: "zai-org/GLM-5.3-Flash", local: null, maxSeats: 4 },
		localEndpoint: "DOWN (fetch failed)",
		selfdevLines: 749,
		selfdevHeadings: ["Running it@66", "Known blocker@169"],
		suiteMarker: "last suite: 209/234",
		ms: 1234,
	});
	assert.ok(!text.includes(BODY.slice(0, 80)), "the digest printed a queue row BODY");
	assert.ok(
		Buffer.byteLength(text, "utf8") <= DIGEST_BUDGET_BYTES,
		`digest is ${Buffer.byteLength(text, "utf8")} B, over the ${DIGEST_BUDGET_BYTES} B budget`,
	);
	assert.deepEqual(
		queueCounts(items),
		{ done: 1, deferred: 2, held: 1 },
		"counts come from the rows, not from a guess",
	);
	assert.match(
		text,
		/## QUEUE  4 rows \{"done":1,"deferred":2,"held":1\}/,
		"the counts are printed",
	);
	assert.match(
		text,
		/^deferred qa2 \(1\): #4002$/m,
		"a deferred row is named by id, on ITS SEAT'S line — grep-able, not inline prose (#5596)",
	);
	assert.match(text, /item-4001 \+1 \[#4001 done\]/, "landing debt is joined to the row's status");
	assert.match(
		text,
		/\{"impl":"model_error: 402/,
		"the provider failure is visible without reading 22 MB",
	);

	// 1b. THE DEFERRED LIST IS A PER-SEAT AGGREGATE, AND IT IS CHEAPER (#5596). The measurement this
	//     replaces lives in docs/runbooks/session-start-cost.md: the one-line-per-row dump was 14,959 B
	//     of a 28.8 KB digest at 207 rows (52% of the digest). An outage window leaves exactly this shape
	//     behind, so the fixture is 207 rows across 6 seats: ONE greppable id list per seat, NO subject
	//     text, and a small fraction of the old cost on the SAME rows.
	const outage = [];
	const SEATS = ["devtools", "impl", "lead", "pm", "qa2", "opside"];
	const SUBJECT = "OUTAGE-WINDOW-SUBJECT-THAT-MUST-NOT-REACH-THE-DIGEST ";
	for (let n = 0; n < 207; n++)
		outage.push({
			id: 6000 + n,
			to: SEATS[n % SEATS.length],
			subject: SUBJECT + n,
			status: n % 7 === 0 ? "held" : "deferred",
			body: SUBJECT.repeat(30),
		});
	const big = renderDigest({
		pointer: { lines: ["## NEXT SESSION (test)"], start: 1, end: 2, fileLines: 2 },
		seats: 6,
		attention: [],
		broker: { detail: "NO STATE FILE" },
		items: outage,
		counts: queueCounts(outage),
		config: {},
		localEndpoint: "x",
		selfdevLines: 1,
		selfdevHeadings: [],
		ms: 1,
	});
	const dLines = big.split("\n").filter((l) => /^deferred /.test(l));
	assert.equal(dLines.length, SEATS.length + 1, "one header + exactly one line per seat holding rows");
	assert.match(
		dLines[0],
		/^deferred \(parked on a question\): \d+ rows across 6 seats — one id list per seat, grep "\^deferred <seat> "$/,
		"the header states the total and how to grep it",
		);
	for (const seat of SEATS) {
		const ids = outage
			.filter((i) => i.status === "deferred" && i.to === seat)
			.map((i) => `#${i.id}`);
		assert.ok(ids.length > 0, `${seat} holds deferred rows in the fixture — the control is not vacuous`);
		const lines = dLines.filter((l) => l.startsWith(`deferred ${seat} `));
		assert.equal(lines.length, 1, `exactly ONE line holds ${seat}'s deferred ids — one grep, whole set`);
		assert.match(
			lines[0],
			new RegExp(`^deferred ${seat} \\(\\d+\\): #`),
			"the line is anchored and count-prefixed",
		);
		assert.deepEqual(
			lines[0].slice(lines[0].indexOf(": ") + 2).split(" "),
			ids,
			`${seat}'s line carries EVERY deferred id for that seat, mechanically — no re-derivation from a 21 MB dump`,
		);
		assert.ok(!lines[0].includes(SUBJECT), "row subjects never reach the per-seat lines");
	}
	// The byte claim, measured against the shape it replaced ON THE SAME ROWS — not a feeling.
	const newBytes = Buffer.byteLength(dLines.join("\n"), "utf8");
	const oldBytes = Buffer.byteLength(
		`deferred (awaiting the operator): ${outage
			.filter((i) => i.status === "deferred")
			.map((i) => `#${i.id} (${i.to}) ${String(i.subject).slice(0, 55)}`)
			.join(" · ")}`,
			"utf8",
	);
	assert.ok(
		newBytes * 4 < oldBytes,
		`the per-seat aggregate must cost a fraction of the row-per-line dump: ${newBytes} B vs ${oldBytes} B`,
	);
	console.log(
		`  deferred list: ${oldBytes} B (one line per row) -> ${newBytes} B (per-seat ids) at ${outage.filter((i) => i.status === "deferred").length} rows`,
	);

	// 2. A BROKER STATE FILE IS NOT PROOF OF A LIVE BROKER. On 2026-10-25 the state file named pid
	//    14784 and `tasklist` reported `svchost.exe`: the broker had been dead for 23 hours and the
	//    file said otherwise. The probe must resolve the PID, not trust the file.
	const deadFile = join(dir, "dead.sqlite.broker.json");
	writeFileSync(
		deadFile,
		JSON.stringify({
			pid: 999999,
			since: "2026-10-22T17:39:46.173Z",
			lastPassAt: Date.now() - 1377 * 60000,
		}),
	);
	const dead = brokerLiveness({ stateFile: deadFile });
	assert.equal(dead.state, "DOWN", "a state file naming a dead PID is DOWN, not UP");
	assert.match(dead.detail, /DOWN pid=999999/, "the report names the PID it checked");
	assert.equal(pidAlive(999999), false, "the PID probe itself says no");

	const liveFile = join(dir, "live.sqlite.broker.json");
	writeFileSync(
		liveFile,
		JSON.stringify({ pid: process.pid, since: "2026-10-25T02:00:00.000Z", lastPassAt: Date.now() }),
	);
	assert.equal(
		brokerLiveness({ stateFile: liveFile }).state,
		"UP",
		"a live node PID is UP — the probe is not just pessimistic",
	);

	assert.equal(
		brokerLiveness({ stateFile: join(dir, "nope.sqlite.broker.json") }).state,
		"NO STATE FILE",
		"an absent state file says so",
	);
	const junkFile = join(dir, "junk.broker.json");
	writeFileSync(junkFile, "{not json");
	assert.equal(
		brokerLiveness({ stateFile: junkFile }).state,
		"UNREADABLE",
		"a corrupt state file is reported, not trusted",
	);

	// 3. THE POINTER ONLY. The rest of docs/NEXT.md is history and is never returned.
	const nextText = [
		"# title",
		"",
		"## NEXT SESSION (now)",
		"body one",
		"",
		"## CLOCK-OUT (older)",
		"old body",
	].join("\n");
	const p = pointerSection(nextText);
	assert.equal(p.start, 3);
	assert.equal(
		p.lines.join("\n"),
		"## NEXT SESSION (now)\nbody one\n",
		"the section ends at the next level-2 heading",
	);
	assert.ok(!p.lines.join("\n").includes("old body"), "history is not part of the pointer");
	const pointerOnly = renderDigest({
		pointer: p,
		seats: 0,
		attention: [],
		broker: { detail: "NO STATE FILE" },
		items: [],
		counts: {},
		config: {},
		localEndpoint: "x",
		selfdevLines: 1,
		selfdevHeadings: [],
		ms: 1,
	});
	assert.match(
		pointerOnly,
		/lines 3-5 of 7; cap 200/,
		"the digest says which lines it read and what the cap is",
	);

	// 4. INTEGRATION, against a store this test builds (never the live rig store).
	const starter = JSON.parse(readFileSync(join(ROOT, "rig.starter.json"), "utf8"));
	const rigPath = join(dir, "clockin.rig.json");
	writeFileSync(rigPath, JSON.stringify(starter));
	const db = join(dir, "clockin.sqlite");
	const up = cli(["cli.mjs", "up", rigPath, "--no-serve"], {
		DURIG_DB: db,
		DURIG_PI_DB: db,
		DURIG_PROVIDER: "faux",
	});
	assert.equal(up.code, 0, `up (fixture rig) failed: ${up.stderr.slice(0, 300)}`);
	writeFileSync(
		`${db}.broker.json`,
		JSON.stringify({
			pid: 999999,
			since: "2026-10-25T00:00:00.000Z",
			lastPassAt: Date.now() - 3600000,
		}),
	);

	const full = cli(["scripts/clockin.mjs", "--db", db], { DURIG_DB: db, DURIG_PI_DB: db });
	assert.equal(full.code, 0, `digest failed: ${full.stderr.slice(0, 300)}`);
	assert.ok(
		!full.stderr.includes("over its"),
		`digest broke its own budget: ${full.stderr.slice(0, 200)}`,
	);
	assert.ok(
		Buffer.byteLength(full.stdout, "utf8") <= DIGEST_BUDGET_BYTES,
		`real digest is ${Buffer.byteLength(full.stdout, "utf8")} B`,
	);
	for (const section of [
		"## POINTER",
		"## RIG",
		"## QUEUE",
		"## GIT",
		"## RUNBOOKS",
		"## PROVIDER",
		"## READ MAP",
		"## COST",
	]) {
		assert.ok(full.stdout.includes(section), `the digest lost the ${section} section`);
	}
	assert.match(
		full.stdout,
		/broker: DOWN pid=999999/,
		"the fixture's dead broker is reported DOWN",
	);
	assert.match(
		full.stdout,
		/## POINTER .*lines \d+-\d+ of \d+/,
		"the pointer is read from the live file, by line range",
	);
	assert.ok(full.stdout.includes("NEXT-ARCHIVE.md"), "the pointer still links its own archive");
	assert.match(full.stdout, /cap 200/, "the pointer cap is stated where a session will see it");

	// A SECOND run, flags off, still against the fixture. NOTE what this test does NOT do: it never puts
	// a LIVE pid in `<db>.broker.json`. Measured 2026-10-25 while writing this test: a fixture state file
	// naming a live pid made `cli.mjs status` itself behave as though a broker were attached and it hung
	// for the full 120 s spawn timeout (SIGTERM). The UP path is proven by the pure probe above, which is
	// the half this tool owns.
	writeFileSync(
		`${db}.broker.json`,
		JSON.stringify({
			pid: 999999,
			since: "2026-10-25T00:00:00.000Z",
			lastPassAt: Date.now() - 3600000,
		}),
	);
	const trimmed = cli(["scripts/clockin.mjs", "--db", db, "--no-git", "--no-runbooks"], {
		DURIG_DB: db,
		DURIG_PI_DB: db,
	});
	assert.equal(
		trimmed.code,
		0,
		`digest (trimmed fixture run) failed: ${trimmed.stderr.slice(0, 300)}`,
	);
	assert.match(
		trimmed.stdout,
		/broker: DOWN pid=999999/,
		"the fixture's dead broker is still reported DOWN",
	);
	// The digest quotes the pointer VERBATIM, so a section name mentioned in docs prose counts as "present"
	// unless the check is anchored at line start. Hit for real on 2026-10-25: docs/NEXT.md line 112 says "the
	// digest's `## GIT` section lists 17 unmerged refs", and an unanchored includes() read that as the GIT
	// section appearing in a --no-git run. A digest that prints a document must be tested against its own
	// heading lines, not against the words.
	const ownHeading = (name) => new RegExp(`^## ${name}( |$)`, "m");
	assert.ok(
		!ownHeading("RUNBOOKS").test(trimmed.stdout),
		"--no-runbooks skips the staleness probe",
	);
	assert.ok(!ownHeading("GIT").test(trimmed.stdout), "--no-git skips the branch walk");
	assert.ok(
		ownHeading("QUEUE").test(trimmed.stdout),
		"the sections the flags kept are still there",
	);
	assert.ok(
		Buffer.byteLength(trimmed.stdout, "utf8") < Buffer.byteLength(full.stdout, "utf8"),
		"the trimmed digest is smaller than the full one — the flags remove work, they do not add a section",
	);

	// 5. THE SUITE MARKER IS READ EITHER WAY IT WAS WRITTEN. The marker is scratch, written by whoever last
	//    ran the suite, and the two shapes used so far differ ({pass,total,at,sha} from the prototype,
	//    {suite,main,measured_at} from the later one). A reader that assumes one prints
	//    "last suite: undefined/undefined at undefined" — which looks exactly like a result. This session hit
	//    that for real: the digest printed `last suite: undefined/undefined at undefined` after the marker was
	//    rewritten by hand.
	assert.match(
		suiteMarker(
			JSON.stringify({ pass: 209, total: 234, at: "T1", sha: "4362bd54", note: "capped run" }),
		),
		/last suite: 209\/234 at T1 \(main 4362bd54\) — capped run/,
		"the older {pass,total,at,sha} shape still reads",
	);
	assert.match(
		suiteMarker(
			JSON.stringify({ suite: "235/235 passed in 479.9s", main: "1aeb0c43", measured_at: "T2" }),
		),
		/last suite: 235\/235 passed in 479\.9s at T2 \(main 1aeb0c43\)/,
		"the newer {suite,main,measured_at} shape reads too",
	);
	assert.match(
		suiteMarker(JSON.stringify({ suite: "1/2", main: "deadbee" }), "cafe1234"),
		/STALE: main is now cafe1234/,
		"a marker for a different main is labelled stale instead of presented as current",
	);
	assert.ok(!suiteMarker("{not json").includes("undefined"), "an unreadable marker says so");
	assert.ok(
		!suiteMarker(JSON.stringify({})).includes("undefined"),
		"an empty marker never prints undefined",
	);

	// 6. THE LIVE POINTER FILE IS STILL A POINTER. The cap is the durable half of the split: the file
	//    every session reads whole must not grow back into the 4,724-line file it was.
	const live = readFileSync(join(ROOT, "docs/NEXT.md"), "utf8").split(/\r?\n/);
	assert.ok(
		live.length <= POINTER_CAP_LINES,
		`docs/NEXT.md is ${live.length} lines; the cap is ${POINTER_CAP_LINES} — older sessions go VERBATIM to docs/NEXT-ARCHIVE.md`,
	);

	// 7. THE LANDING GATE'S TREE, NOT A COMFORTABLE ONE (#4985). `scripts/land.mjs --changed-suite` runs the
	//    suite in a DETACHED scratch worktree (`git worktree add --detach .land-scratch-<pid> <main>`, at
	//    land.mjs:483-497), and a green in a CHECKED-OUT tree proves nothing about that gate. Measured in a
	//    detached scratch at `43e26dcc`, git 2.56.0:
	//      `git branch --format='%(refname:short)'` → 15 lines, one of them the literal `(no branch)`
	//      `git rev-list --count 'main..(no branch)'` → exit 128 `fatal: ambiguous argument`
	//    The old debt walk interpolated branch NAMES into ranges, so that listing poisoned it, clockin exited 1,
	//    and THIS file was the red that stopped the item-4966 landing at 129 of 242 derived tests. So the demo
	//    builds the tree shape the gate builds and runs the tool inside it.
	const scratch = join(ROOT, `.durig-test-wt-clockin-${process.pid}`); // gitignored pattern; unregistered in `finally`
	const added = spawnSync("git", ["worktree", "add", "--detach", scratch, "HEAD"], { cwd: ROOT, encoding: "utf8" });
	assert.equal(added.status, 0, `could not create the detached scratch worktree: ${(added.stderr ?? "").slice(0, 300)}`);
	assert.equal(
		spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: scratch, encoding: "utf8" }).stdout.trim(),
		"HEAD",
		"the scratch really is DETACHED — a control that is not the failing shape is not a control",
	);
	const inDetached = cli(["scripts/clockin.mjs", "--db", db, "--no-runbooks"], { DURIG_DB: db, DURIG_PI_DB: db }, scratch);
	assert.equal(
		inDetached.code,
		0,
		`the digest died in a DETACHED scratch tree (this is #4985, the shape the landing gate runs in): ${(inDetached.stderr ?? "").slice(0, 400)}`,
	);
	assert.ok(
		inDetached.stdout.includes("## GIT"),
		"the GIT section still prints in a detached tree — the fix is not 'skip the git walk', which would hide debt",
	);
	assert.match(
		inDetached.stdout,
		/head=detached@[0-9a-f]{7,10}/,
		"the digest NAMES the tree shape it measured, so a landing-scratch reading is not mistaken for a live-checkout one",
	);
	assert.match(inDetached.stdout, /base=main@[0-9a-f]{8}/, "the base ref is resolved to a sha BEFORE any range is built");
	assert.ok(!inDetached.stderr.includes("git rev-list"), "no git fatal escapes the digest");

	// THE DISCRIMINATION PAIR: the range COMPUTES when the base resolves and is SKIPPED with a stated reason
	// when it does not. Never a crash (that is what stopped the gate) and never a silent `unmerged=0` (a lie).
	const noBase = cli(
		["scripts/clockin.mjs", "--db", db, "--no-runbooks", "--base", "refs/heads/no-such-base"],
		{ DURIG_DB: db, DURIG_PI_DB: db },
		scratch,
	);
	assert.equal(
		noBase.code,
		0,
		`an unresolvable --base must SKIP the range, not kill the digest: ${(noBase.stderr ?? "").slice(0, 400)}`,
	);
	assert.match(
		noBase.stdout,
		/^RANGE NOT COMPUTED: the base ref "refs\/heads\/no-such-base" does not resolve/m,
		"the skip is printed as a line a session will read, not swallowed",
	);
	assert.ok(
		/base=refs\/heads\/no-such-base UNRESOLVED/.test(noBase.stdout),
		"the GIT line admits the base is unresolved instead of implying there is no debt",
	);

	// And the RULE, at unit level, so it does not depend on this git version's listing quirks: the branch list
	// is namespace-pinned to refs/heads/ (a HEAD state is not a branch), and every operand of a git range is a
	// RESOLVED sha — nothing that could read `(no branch)` ever reaches a range.
	const calls = [];
	const hex = (c) => c.repeat(40);
	const fake = branchDebt({
		items: [{ id: 4985, status: "done" }],
		base: "main",
		git: (args) => {
			calls.push(args);
			if (args[0] === "symbolic-ref") return "item-4985";
			if (args[0] === "rev-parse" && args[1] === "--verify") return hex("a");
			if (args[0] === "for-each-ref") return `${hex("b")} item-4985\n`;
			if (args[0] === "rev-list") return "3";
			if (args[0] === "worktree") return "worktree /x\nworktree /y\n";
			return "";
		},
	});
	assert.ok(
		calls.some((a) => a[0] === "for-each-ref" && a.includes("refs/heads/")),
		`the branch list must come from refs/heads/: ${JSON.stringify(calls.map((a) => a[0]))}`,
	);
	assert.ok(
		!calls.some((a) => a[0] === "branch"),
		"no `git branch` listing anywhere — that is the call that yields the literal `(no branch)` in a detached tree",
	);
	const ranges = calls.filter((a) => a[0] === "rev-list").map((a) => String(a[a.length - 1]));
	assert.ok(ranges.length > 0, "the discriminating pair needs at least one range to inspect — otherwise this check is vacuous");
	assert.ok(
		ranges.every((r) => /^[0-9a-f]{40}\.\.[0-9a-f]{40}$/.test(r)),
		`every range operand is a resolved sha, never a name: ${JSON.stringify(ranges)}`,
	);
	assert.deepEqual(
		fake.debt,
		["item-4985 +3 [#4985 done]"],
		"the debt line keeps its shape (branch +ahead [#id status]) — the fix repaired the mechanism, it did not delete the section's content",
	);
	assert.equal(fake.worktrees, 2, "worktrees is counted from --porcelain records, not from line noise");
	const skipCalls = [];
	const skipped = branchDebt({
		items: [],
		base: "main",
		git: (args) => {
			skipCalls.push(args);
			if (args[0] === "symbolic-ref") return "main";
			if (args[0] === "rev-parse" && args[1] === "--verify") throw new Error("fatal: not a valid object name: 'main'.");
			if (args[0] === "for-each-ref") return `${hex("b")} item-4985\n`;
			if (args[0] === "worktree") return "worktree /x\n";
			return "";
		},
	});
	assert.match(skipped.skipped ?? "", /NOT computed/, "an unresolvable base SKIPS the range and says so");
	assert.ok(
		!skipCalls.some((a) => a[0] === "rev-list"),
		"an unresolved base must never reach a git range — that is the fatal that stopped the landing gate",
	);
	assert.deepEqual(skipped.debt, [], "the skip does not invent debt rows");
	assert.notEqual(skipped.skipped, null, "the skip reason is carried in the state, not only printed");
	// And ONE bad range must degrade to a counted failure, not a dead digest — a dead digest is what stopped the
	// landing gate mid-suite, and `git` fails for many reasons (a grafted branch, a bad object, a timeout).
	let revListAttempts = 0;
	const failing = branchDebt({
		items: [],
		base: "main",
		git: (args) => {
			if (args[0] === "symbolic-ref") return "main";
			if (args[0] === "rev-parse" && args[1] === "--verify") return hex("a");
			if (args[0] === "for-each-ref") return `${hex("b")} item-9999\n${hex("c")} item-9998\n`;
			if (args[0] === "rev-list") {
				revListAttempts++;
				if (revListAttempts === 1) throw new Error("fatal: bad object");
				return "2";
			}
			if (args[0] === "worktree") return "worktree /x\n";
			return "";
		},
	});
	assert.equal(failing.probeFailures, 1, "one unresolvable range is COUNTED (`rev-list-failures=1` in the digest), not fatal");
	assert.equal(revListAttempts, 2, "the walk CONTINUES past the failing branch — one bad row must not hide the rest");
	assert.deepEqual(failing.debt, ["item-9998 +2 [#9998 no-row]"], "the branches that DO resolve still report their debt");
	assert.equal(failing.skipped, null, "a probe failure is not reported as a skip — the base resolved");

	console.log(
		"CLOCKIN DIGEST TEST PASS (body-free, within budget, broker resolved by PID not by file, pointer-only, fixture run clean, and GREEN IN A DETACHED SCRATCH TREE with the range resolved to shas — #4985)",
	);
} finally {
	// A scratch worktree is a REGISTRATION, not just a directory: leaving one behind is worktree rot, the leak
	// the stray check counts (#4142 measures strays BY REGISTRATION, not by name). Drop the registration first,
	// then prune, then the temp store.
	spawnSync("git", ["worktree", "remove", "--force", join(ROOT, `.durig-test-wt-clockin-${process.pid}`)], {
		cwd: ROOT,
		encoding: "utf8",
	});
	spawnSync("git", ["worktree", "prune"], { cwd: ROOT, encoding: "utf8" });
	rmSync(dir, { recursive: true, force: true });
}
