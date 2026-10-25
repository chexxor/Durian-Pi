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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DIGEST_BUDGET_BYTES,
	POINTER_CAP_LINES,
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
		/#4002 \(qa2\) VERIFY the digest verb/,
		"a deferred row is named by id, target and subject",
	);
	assert.match(text, /item-4001 \+1 \[#4001 done\]/, "landing debt is joined to the row's status");
	assert.match(
		text,
		/\{"impl":"model_error: 402/,
		"the provider failure is visible without reading 22 MB",
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

	console.log(
		"CLOCKIN DIGEST TEST PASS (body-free, within budget, broker resolved by PID not by file, pointer-only, fixture run clean)",
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
