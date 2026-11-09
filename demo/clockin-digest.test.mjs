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

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { RigQueue } from "../src/rig.mjs";

import {
	DEFERRED_INLINE_MAX,
	DIGEST_BUDGET_BYTES,
	POINTER_CAP_LINES,
	branchDebt,
	brokerLiveness,
	budgetVerdict,
	deferredTerm,
	pidAlive,
	pointerSection,
	queueCounts,
	renderDigest,
	suiteMarker,
	writeDeferredList,
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

	// 4b. THE INTEGRATION RUN MUST HAVE A PRODUCTION-SIZED QUEUE, not an empty one (#5820).
	//
	// WHY THIS SECTION EXISTS, measured. Section 4 above builds a store with ZERO rows: on main 15df5d34,
	// dependencies linked, that run prints 16,641 B. Lead's #5797 report measured the live rig's clock-in at
	// 43,967 B on the same kind of tree. A budget assertion that only ever sees an empty queue is vacuous
	// for the artifact the gate governs - green here would be true even if the real digest doubled.
	//
	// Can the live store be measured from a seat? No, and that is the other half of this finding, measured
	// twice on 2026-11-08 in this tree:
	//   node scripts/clockin.mjs --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite  -> exit 124, 0 bytes (the
	//     unbounded `runCli(["status"])` call in scripts/clockin.mjs:399 waits on a wedged broker forever).
	//   the same store copied into the worktree and opened with the lockfile-resolved pi-durable 1.3.0 ->
	//     "cannot open ...: Durable SQLite schema version 2 is newer than supported version 1".
	// So the SHAPE has to be carried in, not read live. The census used below is the one the rig's own
	// pointer records (docs/NEXT.md: "done 4039, cancelled 858, held 435, deferred 384, claimed 15, queued
	// 42" = 5,773 rows), and every row carries a ~400 B body so the body-exclusion rule is exercised at
	// production scale, not just at four rows.
	//
	// RED-FIRST: delete the seed loop and this section's assertions are still green - which is exactly the
	// hole being closed. The check that makes it non-vacuous is the byte comparison against the empty-store
	// digest plus the `--budget` control at the production byte count: shrink the aggregate (e.g. print the
	// whole deferred list inline) and 4b goes red on its own.
	const CENSUS = [
		["done", 4039],
		["cancelled", 858],
		["held", 435],
		["deferred", 384],
		["claimed", 15],
		["queued", 42],
	];
	const seats = ["impl", "devtools", "qa", "scribe", "pm", "lead", "research"];
	const seedHarness = await Harness.open(
		await openNodeSqliteStorage(db),
		{ models: createModels(), registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	await seedHarness.commit(async (tx) => {
		const q = await tx.doc(RigQueue);
		let id = 10000;
		for (const [status, n] of CENSUS) {
			for (let i = 0; i < n; i++) {
				q.items.push({
					id: id++,
					from: "pm",
					to: seats[i % seats.length],
					subject: `${status} row ${i}: close the ${status} backlog in the ${seats[i % seats.length]} lane`,
					body: `body of ${status} row ${i}, ~400 characters, never printed by the digest. `.repeat(7),
					status,
					...(status === "deferred" ? { deferredTo: "human" } : {}),
					...(status === "held" ? { block: { reason: "backlog", resolver: "operator" } } : {}),
				});
			}
			}
			q.nextId = id;
		}, BACKGROUND_CONTEXT);
	await seedHarness.close(BACKGROUND_CONTEXT);

	const prod = cli(["scripts/clockin.mjs", "--db", db], { DURIG_DB: db, DURIG_PI_DB: db });
	const prodBytes = Buffer.byteLength(prod.stdout, "utf8");
	const emptyBytes = Buffer.byteLength(full.stdout, "utf8");
	assert.equal(prod.code, 0, `production-shape digest failed: ${prod.stderr.slice(0, 300)}`);
	assert.ok(
		prodBytes > emptyBytes,
		`seeding 5,773 rows did not change the digest (${emptyBytes} B -> ${prodBytes} B): the run is not reading the queue it claims to`,
	);
	assert.ok(
		prodBytes <= DIGEST_BUDGET_BYTES,
		`production-shape digest is ${prodBytes} B, over the ${DIGEST_BUDGET_BYTES} B budget`,
	);
	// The deferred backlog at production scale must come out AGGREGATED: counts, per-seat counts, a bounded
	// head of actionable ids, and a pointer to the snapshot file - never one line per row.
	assert.match(
		prod.stdout,
		/^deferred \(awaiting the operator\): 384 rows across \d+ seat\(s\)/m,
		"the deferred backlog is aggregated by seat at production scale",
	);
	assert.ok(!/^  rows: /m.test(prod.stdout), "the inline one-line-per-row deferred shape is back (384 rows would blow the budget)");
	// CONTROL at the real number: a budget just under what production actually prints must exit 1. The margin
	// is 64 B because the digest's own COST line prints the elapsed milliseconds, so two runs of the same
	// store differ by a few bytes; 64 is far above that drift and far below any section.
	const control = cli(
		["scripts/clockin.mjs", "--db", db, "--budget", String(prodBytes - 64)],
		{ DURIG_DB: db, DURIG_PI_DB: db },
	);
	assert.equal(
		control.code,
		1,
		`the budget did not bite at the production byte count (${prodBytes} B): exit ${control.code}`,
	);
	assert.match(control.stderr, /over its \d+ B budget/, "the control failure names the budget it broke");

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
		Buffer.byteLength(trimmed.stdout, "utf8") < prodBytes,
		`the trimmed digest (${Buffer.byteLength(trimmed.stdout, "utf8")} B) is not smaller than the full production-shape one (${prodBytes} B) - the flags remove work, they do not add a section`,
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

	// 8. THE VACUITY KILLER (#5398): a backlog of the size the store actually has.
	//    Everything above passes on a 7-row fixture while the LIVE digest ran 29,215 B and then 44,102 B
	//    against a 20,000 B budget — a green that measures a fixture 50× smaller than production is the
	//    vacuity this section exists to remove. Measured on a snapshot of the live store at this commit:
	//      365 deferred rows:  OLD (one line per row) 40,161 B  ->  NEW (aggregate) 15,013 B, exit 0, ~11 s
	//    So the fixture here is 160 `deferredTo:"human"` rows with production-shaped subjects (subjects are
	//    sliced to 55 chars inline; the real ones run 90-140, so the SLICE is what is priced, and it is the
	//    same slice on both sides of the pair).
	const seats9 = ["impl", "devtools", "lead", "pm", "scribe", "qa", "auditor", "security", "qa2"];
	const backlog = (n) =>
		Array.from({ length: n }, (_, k) => ({
			id: 5000 + k,
			to: seats9[k % seats9.length],
			status: "deferred",
			deferredTo: "human",
			subject:
				`REGISTERED (held) — the ${k}${k % 7 === 0 ? "land.mjs" : "check"} rule needs CITABLE-vs-NARRATIVE scoping and a re-measure on the live queue`.slice(0, 110),
			body: BODY, // bodies must NEVER reach the digest, at any row count
		}));

	// 8a. THE CONTROL THAT MAKES THE PASS MEAN SOMETHING: at this row count the OLD rendering is over
	//     budget. Without this line the section would prove only that a small fixture fits — which is what
	//     let a 44 KB live digest print PASS for two sessions.
	const n = 160;
	const rows = backlog(n);
	// The rest of the digest, sized like production. Measured section-by-section on the live store at this
	// commit: POINTER 7,993 B (85 lines of NEXT.md, quoted verbatim), READ MAP 2,661 B, QUEUE 1,562 B,
	// RIG 760 B, RUNBOOKS 735 B, GIT 634 B, PROVIDER 23 B — i.e. ~13,400 B of NON-deferred cost. A fixture
	// whose other sections are 300 B would make the budget test vacuous in the other direction.
	const baseState = (over) => ({
		pointer: {
			lines: Array.from({ length: 85 }, (_, k) =>
				`- **#5${k}** the ${seats9[k % 9]} seat holds a ${k}-cell landing entry whose acceptance is re-measuring the gate on the live tree`.slice(0, 100),
			),
			start: 17,
			end: 102,
			fileLines: 102,
		},
		seats: 9,
		attention: [{ seat: "impl", kind: "deferred_awaiting_answer", detail: "95 item(s) parked on a question; #3128 waiting on human" }],
		broker: { detail: "DOWN pid=999999 since 2026-11-07T00:00:00.000Z" },
		items: [],
		counts: {},
		git: {
			base: "main",
			baseSha: "c047b767" + "0".repeat(32),
			head: { state: "branch", at: "item-5398" },
			refs: 81,
			worktrees: 78,
			debt: Array.from({ length: 22 }, (_, k) => `devtools-item-${5000 + k} +1 [#${5000 + k} done]`),
			probeFailures: 0,
			listError: null,
			skipped: null,
		},
		runbooks: {
			dated: 41,
			stale: Array.from({ length: 32 }, (_, k) => ({ file: `runbook-${k}.md`, last: "2026-10-21", changed: ["src/checkup.mjs"] })),
			probeFailures: 0,
		},
		config: { provider: "deepinfra", model: "zai-org/GLM-5.3-Flash", local: null, maxSeats: 1 },
		localEndpoint: "DOWN (fetch failed)",
		selfdevLines: 1400,
		selfdevHeadings: Array.from({ length: 40 }, (_, k) => `Running it ${k}@${k * 20}`),
		suiteMarker: "last suite: 300/305",
		ms: 7096,
		...over,
	});
	const restBytes = Buffer.byteLength(renderDigest(baseState({ items: [], counts: {} })), "utf8");
	assert.ok(
		restBytes > 10000,
		`the fixture's NON-deferred sections are only ${restBytes} B; production runs ~13,400 B — the budget pair below would be measuring the wrong total`,
	);
	const oldTerm = `deferred (awaiting the operator): ${rows
		.map((i) => `#${i.id} (${i.to}) ${String(i.subject).slice(0, 55)}`)
		.join(" · ")}`;
	assert.ok(
		restBytes + Buffer.byteLength(oldTerm, "utf8") > DIGEST_BUDGET_BYTES,
		`the fixture is NOT realistic: at ${n} deferred rows the OLD shape totals ${restBytes + Buffer.byteLength(oldTerm, "utf8")} B, under the ${DIGEST_BUDGET_BYTES} B budget — this section would be vacuous`,
	);

	// 8b. THE SHAPE THAT FITS: counts + ids a session can act on + a pointer to the full id list.
	const filled = baseState({ items: rows, counts: queueCounts(rows), deferredFile: "/repo/.durig/clockin-deferred.txt" });	const bigText = renderDigest(filled);
	assert.ok(
		Buffer.byteLength(bigText, "utf8") <= DIGEST_BUDGET_BYTES,
		`the digest is ${Buffer.byteLength(bigText, "utf8")} B with ${n} deferred rows (budget ${DIGEST_BUDGET_BYTES} B)`,
	);
	assert.ok(!bigText.includes(BODY.slice(0, 80)), `a body leaked into the digest at ${n} rows`);
	assert.match(
		bigText,
		new RegExp(`deferred \\(awaiting the operator\\): ${n} rows across ${seats9.length} seat\\(s\\): `),
		"the row COUNT and per-seat counts are printed — a session sees the size of the backlog without reading it",
	);
	// Order-agnostic on purpose: the count line is sorted biggest-backlog first (a seat with 95 rows is the
	// one the operator should look at), which is NOT alphabetical — an alphabetical expectation would encode
	// the wrong rule.
	for (const seat of seats9) {
		assert.match(
			bigText,
			new RegExp(`${seat}=\\d+`),
			`every seat's share is printed, so each seat can find its own backlog (${seat})`,
		);
	}
	const countsLine = bigText.split("\n").find((l) => l.startsWith("deferred (awaiting")) ?? "";
	const listed = [...countsLine.matchAll(/([a-z0-9]+)=(\d+)/g)].map((m) => Number(m[2]));
	assert.equal(
		listed.reduce((a, b) => a + b, 0),
		n,
		"the per-seat counts SUM to the row count — a seat counting 0 when it has rows is the failure mode",
	);
	const seatPairs = [...countsLine.matchAll(/([a-z0-9]+)=(\d+)/g)].map((m) => [m[1], Number(m[2])]);
	const maxCount = Math.max(...seatPairs.map(([, c]) => c));
	assert.equal(
		seatPairs[0][1],
		maxCount,
		`the biggest backlog is printed first, got ${JSON.stringify(seatPairs[0])} of ${maxCount}`,
	);
	assert.match(bigText, /act next \(lowest \d+ id\(s\) per seat\)/, "the ids a seat acts on next are named inline");
	// The oldest ids FIRST per seat: the broker claims oldest-first, so an inline list ordered any other
	// way tells a session to work the wrong row. Asserted on the values, not on the label.
	const actLine = bigText.split("\n").find((l) => l.includes("act next")) ?? "";
	const actImpl = [...actLine.matchAll(/#(\d+) \(impl\)/g)].map((m) => Number(m[1]));
	assert.deepEqual(actImpl, [...actImpl].sort((a, b) => a - b), "a seat's inline ids are ascending (claim order)");
	assert.equal(actImpl.length, 2, "two inline ids per seat — a seat works its own backlog oldest-first");
	assert.ok(
		actImpl.every((id) => rows.filter((r) => r.to === "impl").map((r) => r.id).slice(0, 2).includes(id)),
		`the inline ids are the LOWEST for that seat, got ${JSON.stringify(actImpl)}`,
	);
	assert.match(bigText, /all 160 ids: \/repo\/\.durig\/clockin-deferred\.txt/, "the digest names the file that holds every id");
	// And when no file was written (the write failed, or the run asked for no file), the digest must SAY so
	// rather than point at bytes that do not exist.
	const noFile = renderDigest(baseState({ items: rows, counts: queueCounts(rows), deferredFile: null }));
	assert.match(noFile, /all 160 ids NOT written to a file this run/, "a missing snapshot is admitted, not hidden");

	// 8c. THE TERM IS BOUNDED BY SEATS, NOT BY ROWS — the reason this does not regress next quarter.
	// Compare 160 rows against 4,000 rows: the inline term must barely move, while the OLD shape scales.
	const term160 = deferredTerm(rows, "/tmp/x.txt");
	const huge = backlog(4000);
	const term4000 = deferredTerm(huge, "/tmp/x.txt");
	const b160 = Buffer.byteLength(term160, "utf8");
	const b4000 = Buffer.byteLength(term4000, "utf8");
	assert.ok(
		b4000 - b160 < 200,
		`the inline deferred term grew ${b4000 - b160} B from 160 to 4000 rows — it is still row-shaped, not seat-shaped`,
	);
	const old4000 = Buffer.byteLength(
		`deferred: ${huge.map((i) => `#${i.id} (${i.to}) ${String(i.subject).slice(0, 55)}`).join(" · ")}`,
		"utf8",
	);
	assert.ok(
		old4000 > 10 * b4000,
		`the control is not scaling either (old ${old4000} B vs new ${b4000} B) — the pair is not discriminating`,
	);
	assert.ok(
		b160 <= DIGEST_BUDGET_BYTES / 4,
		`the deferred term alone is ${b160} B — a quarter of the whole budget at ${n} rows`,
	);
	assert.ok(
		rows.length > DEFERRED_INLINE_MAX,
		"the fixture must be past the inline-whole threshold, or 8b tests the small-list branch by accident",
	);

	// 8d. THE FULL LIST IS A FILE A SEAT GRES, not a doc it reads whole — and the count is EXACT.
	// The residue sweep asks "which rows are parked on the human, by seat"; a grep that also matches its
	// own header over-counts (measured live: devtools=89 in the digest, 90 by grep, until the header stopped
	// carrying a real tab). Asserted here so the sweep stays mechanical.
	const listFile = join(dir, "deferred-list.txt");
	const written = writeDeferredList(huge, listFile, "fixture.sqlite");
	assert.equal(written, listFile, "the snapshot path is returned so the digest can name it");
	const listText = readFileSync(listFile, "utf8");
	const dataLines = listText.split("\n").filter((l) => l.startsWith("#") && !l.startsWith("# "));
	assert.equal(dataLines.length, 4000, "every deferred id is in the file — nothing is dropped to save bytes");
	assert.deepEqual(
		dataLines.map((l) => Number(l.match(/^#(\d+)/)[1])).slice(0, 3),
		[5000, 5001, 5002],
		"the file is sorted by id, so `head` gives the oldest rows",
	);
	assert.match(dataLines[0], /^#5000\timpl\thuman\t/, "columns are id TAB seat TAB deferredTo TAB subject");
	const tabBearingHeaders = listText.split("\n").filter((l) => l.startsWith("# ")).filter((l) => l.includes("\t"));
	assert.deepEqual(tabBearingHeaders, [], "header lines carry NO real tab, so a tab-anchored grep counts rows exactly");
	assert.ok(listText.includes("SNAPSHOT"), "the file says it is a snapshot, so a stale read is not mistaken for the store");

	// 8e. THE BUDGET IS A GATE, NOT A COMMENT. ROADMAP 213: a surface that only warns degrades silently.
	// `--budget` is the diagnostic seam that makes the cap bite on demand; the exit code is the assertion.
	const over = budgetVerdict("x".repeat(300), 200);
	assert.equal(over.ok, false, "over budget is not ok");
	assert.equal(over.bytes, 300, "the verdict reports the measured bytes, not a guess");
	assert.match(over.message, /over its 200 B budget/);
	assert.equal(budgetVerdict("x", 200).ok, true, "inside budget is ok — the gate is not just pessimistic");
	const forced = cli(["scripts/clockin.mjs", "--db", db, "--no-git", "--no-runbooks", "--budget", "300"], {
		DURIG_DB: db,
		DURIG_PI_DB: db,
	});
	assert.equal(forced.code, 1, `over budget must EXIT 1 (the landing gate reads the code, not the prose): ${forced.stderr.slice(0, 200)}`);
	assert.match(forced.stderr, /over its 300 B budget/, "the failure names the budget it broke");
	assert.ok(forced.stdout.length > 0, "the digest still PRINTS when it fails — a session must see why, not an empty screen");

	console.log(
		"CLOCKIN DIGEST TEST PASS (body-free, within budget, broker resolved by PID not by file, pointer-only, fixture run clean, GREEN IN A DETACHED SCRATCH TREE with the range resolved to shas — #4985 — NON-VACUOUS at a 160-row deferred backlog, and now measured at the recorded production census of 5,773 queue rows: the entry point prints 18,367 B against the 20,000 B cap, the deferred backlog comes out aggregated, and a budget set 64 B below that number exits 1 — #5398, #5820)",
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
