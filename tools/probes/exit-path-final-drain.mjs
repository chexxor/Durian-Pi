#!/usr/bin/env node
/*
 * exit-path-final-drain.mjs — RM-329 1/3, the failing-first measurement (#5630 review).
 *
   The claim under review: `runWakeLoop` never visits the intent spool on the way out, so an intent
   written after the last drain is neither delivered nor dead-lettered — it strands, and the NEXT
   broker replays it into a result slot its caller has already deleted.

   This probe runs a REAL bounded broker on a throwaway store, writes one intent after the last
   drain, requests the cooperative stop, and then reads the spool as it is left at exit. Three
   invariants are asserted; each is a line the build must turn green:

     A1  at process exit the inbox is EMPTY (drained or dead-lettered — never left in place);
     A2  any residue carries the <id>.error.json + <id>.error.json.reason PAIR, and the reason
         NAMES THE EXIT CAUSE (`reason=<stoppedBy>`), so the producer can branch on it;
     A3  nothing is silently requeued for the next run: the residue is terminal, so a second
         broker must NOT apply it.

   No live store is opened. Scratch dirs are created in the seat root and removed.
   Run: node tools/probes/exit-path-final-drain.mjs   exits 1 while any assertion fails: it is a
   gate, not a report. A probe that prints FAIL lines and exits 0 cannot be wired into `check`, so
   the exit path would look verified while nothing re-tests it.
*/
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeStopRequest, writeIntent } from "../../src/broker.mjs";

const cli = join(process.cwd(), "cli.mjs");
const rows = [];
const check = (label, ok, detail = "") => rows.push({ label, ok, detail });

function dirOf(db, suffix) {
	const p = `${db}.broker.inbox${suffix}`;
	return existsSync(p) ? readdirSync(p) : [];
}

function spawnBroker(db, args = []) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [cli, "serve", ...args], {
			cwd: process.cwd(),
			env: { ...process.env, DURIG_DB: db, DURIG_PROVIDER: "faux" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		child.stderr.on("data", (d) => { out += d.toString(); });
		child.on("close", (code) => resolve({ code, out }));
	});
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForLog(db, pattern, ms) {
	const logPath = `${db}.broker.log`;
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (existsSync(logPath) && pattern.test(readFileSync(logPath, "utf8"))) return true;
		await wait(200);
	}
	return false;
}

const scratch = mkdtempSync(join(process.cwd(), "probe-exit-drain-"));
const db = join(scratch, "store.sqlite");
let failures = 0;

try {
	console.log("probe: broker exit path and the spool  tree:", process.cwd());

	// 1. a resident broker, bounded so it cannot outlive the probe
	const broker = spawnBroker(db, ["--max-duration", "8"]);

	// 2. one pass has run, so the inbox has been swept at least once
	const sawPass = await waitForLog(db, / PASS /, 10000);
	check("a pass ran (the spool was swept at least once)", sawPass, sawPass ? "" : "no PASS line within 10 s");

	// 3. write the intent AFTER that drain — the exact shape 329(c) describes
	const requestId = "probe-strand-1";
	writeIntent(db, { op: "read", view: "health", from: "probe", requestId, createdAt: new Date().toISOString() });
	const beforeStop = dirOf(db, "").length;

	// 4. ask for a cooperative stop; the grace is short so the exit is bounded
	writeStopRequest(db);
	const exit = await Promise.race([broker, wait(25000)]);
	const log = existsSync(`${db}.broker.log`) ? readFileSync(`${db}.broker.log`, "utf8") : "";
	const exitLines = log.split("\n").filter((l) => / EXIT /.test(l));
	const exitLine = exitLines.length ? exitLines[exitLines.length - 1] : "(no EXIT line)";

	const residue = dirOf(db, "");
	const deadLettered = dirOf(db, ".error");
	const reasons = deadLettered.filter((f) => f.endsWith(".reason"));
	const resultRows = dirOf(db, ".out");

	console.log(`  timeline: intents in inbox before stop = ${beforeStop}; exit line: ${exitLine}`);
	console.log(`  at exit: inbox=${residue.length} dead-lettered=${deadLettered.length} reason files=${reasons.length} result rows=${resultRows.length}`);

	check("A1 inbox is empty at exit (drained or dead-lettered, never left in place)", residue.length === 0,
		residue.join(", "));
	check("A2 residue carries an error file", deadLettered.length > 0, deadLettered.join(", "));
	check("A2 the dead-letter names the EXIT cause in its .reason", reasons.some((f) => /reason=|exit|stopped/i.test(readFileSync(join(`${db}.broker.inbox.error`, f), "utf8"))),
		reasons.map((f) => readFileSync(join(`${db}.broker.inbox.error`, f), "utf8")).join(" | ") || "no .reason file");
	check("A3 the caller got a verdict it can read (result row or dead-letter)", resultRows.length > 0 || deadLettered.length > 0,
		`result rows=${resultRows.length}, dead-lettered=${deadLettered.length}`);

	// 5. replay arm: does the NEXT broker silently apply what the exit left behind?
	await spawnBroker(db, ["--max-duration", "5"]);
	const afterReplay = dirOf(db, "").length;
	const replayResults = dirOf(db, ".out").length;
	console.log(`  replay arm: after a second broker, inbox=${afterReplay} dead-lettered=${dirOf(db, ".error").length} result rows=${replayResults}`);
	check("A3b the exit accounted for every intent (nothing is handed to the next run)", residue.length === 0 && deadLettered.length + resultRows.length >= beforeStop,
		`intents before stop=${beforeStop}, dead-lettered=${deadLettered.length}, result rows=${resultRows.length}, residue=${residue.length}; the second broker consumed ${afterReplay === 0 ? beforeStop : 0} file(s) and produced ${replayResults} result row(s) - a verdict the original caller is no longer waiting for`);
	check("A4 the exit line reports the residue and its class", /residue=/.test(exitLine), exitLine);

		for (const r of rows) {
		console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.ok ? "" : `  -- ${r.detail}`}`);
		if (!r.ok) failures += 1;
	}
	console.log(`${rows.length} assertions; ${failures} measured failure(s).`);
} finally {
	rmSync(scratch, { recursive: true, force: true });
	console.log("scratch removed:", readdirSync(process.cwd()).filter((n) => n.startsWith("probe-exit-drain")).length === 0 ? "yes" : "NO");
}
process.exit(failures ? 1 : 0);
