// demo/restart-limit-behaviour.test.mjs — #7006 (ROADMAP 355 item 3).
//
// `settings.restartLimit = 3` has been PROVEN as a number that reaches the library (#6173: the
// seam's settings object carries it and `resolveSettings` returns it). That is not the ruled
// claim. The claim is that a seat cut off three times in a row STOPS, and that it stops because
// of the 3 and not because of the fixture. Nothing in this repo had driven a run three times and
// watched it end.
//
// This demo drives the crash-loop guard itself. A harness is opened, a run is started, and the
// host "dies": every later storage call hangs, so nothing is written - not even the `pending`
// records a clean close would write. Reopening the store charges one restart for every task left
// committed `running` (pi-durable scheduler.open), and the generation phase ends the run once the
// streak reaches the limit. The crash is only allowed to land while the task is committed
// `running`: if it landed during a retry backoff the reopen would charge nothing, and the demo
// would be measuring the retry policy instead of the limit.
//
// Checks:
//   1. restartLimit 3, three crashes  -> the submission settles `unanswered` with reason
//      `restart_limit`, charged exactly 3 restarts, and `pi.live` carries the runFailure.
//   2. restartLimit UNSET (library default 5), three crashes -> NOT ended by the limit, though
//      charged the same 3 cut-offs. Same fixture, same crash count: this is the rig's effective
//      behaviour today, because `openHarness` on main passes no `restartLimit` (printed below).
//   3. restartLimit 5, five crashes -> ends `restart_limit` charged 5. The boundary moves with
//      the NUMBER, not the fixture, so check 1 is not "three crashes always kill a run".
//   4. restartLimit 3, two crashes -> not ended by the limit. One short.
//   5. The vacuity control: the limited and the unlimited fixture both finish WITHOUT throwing.
//      An assertion shaped "the run did not explode" passes for BOTH, so it proves nothing; the
//      reason string is the load-bearing assertion, and this check shows that.
//
// Run: node demo/restart-limit-behaviour.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, DEFAULT_RESTART_LIMIT, Harness, LiveDoc, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const ctx = BACKGROUND_CONTEXT;
const RULED = 3;
const ANSWER = "z".repeat(400); // ~1 s of streaming at 400 tokens/s: enough time to crash mid-request

/* Which dependency plane is answering? Report it with every verdict (#6773). */
function plane() {
	const pkg = JSON.parse(readFileSync(new URL("../node_modules/@earendil-works/pi-durable/package.json", import.meta.url), "utf8"));
	const pin = JSON.parse(readFileSync(new URL("../pi-main.pin.json", import.meta.url), "utf8"));
	return pkg.version === "1.5.1" ? "built pin pi-durable " + pkg.version + " (vendor/pi-main @ " + pin.ref + ")" : "lockfile pi-durable " + pkg.version;
}

/* What the rig's own seam writes today. An observation printed with the verdict, not an assertion. */
function seamValue() {
	const src = readFileSync(new URL("../cli.mjs", import.meta.url), "utf8");
	const body = (src.match(/async function openHarness\([\s\S]*?\n\}/) || [""])[0];
	const expr = (body.match(/settings:\s*(\{[^}]*\})/) || [])[1] ?? "{}";
	try {
		const obj = new Function("streamSettings", "compactionSettings", "runControlSettings", "CFG", "return " + expr + ";")(
			() => ({}),
			() => ({}),
			() => ({}),
			{},
		);
		return { written: obj.restartLimit ?? null, effective: obj.restartLimit ?? DEFAULT_RESTART_LIMIT };
	} catch (err) {
		return { written: null, effective: null, error: err.message };
	}
}

/** A Storage whose every call hangs from `dead` on: a host that stops writing, not one that closes. */
function hangingStorage(inner, flag) {
	return new Proxy(inner, {
		get(target, prop) {
			const value = Reflect.get(target, prop);
			if (typeof value !== "function") return value;
			return (...args) => (flag.dead ? new Promise(() => {}) : value.apply(target, args));
		},
	});
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `predicate` is true, up to `tries` polls of 50 ms. */
async function until(predicate, tries = 120) {
	for (let i = 0; i < tries; i += 1) {
		if (await predicate()) return true;
		await sleep(50);
	}
	return false;
}

/**
 * ONE fixture. The only things that vary between calls are `restartLimit` and the crash count.
 * Returns what the store says the run did.
 */
async function crashLoop({ restartLimit, crashes }) {
	const dir = mkdtempSync(join(tmpdir(), "durig-restart-limit-"));
	const inner = await openNodeSqliteStorage(join(dir, "rig.sqlite"));
	const models = createModels();
	const faux = fauxProvider({ models: [{ id: "faux-seat" }], tokensPerSecond: 400, tokenSize: { min: 1, max: 1 } });
	models.setProvider(faux.provider);
	const registry = createRegistry();
	const settings = { retry: { enabled: true, maxRetries: 20, baseDelayMs: 1 }, progress: { persistWithinMs: 0 } };
	if (restartLimit !== undefined) settings.restartLimit = restartLimit;

	let submissionId = null;
	let taskId = null;
	let restarts = null;
	let threw = null;

	try {
		for (let crash = 0; crash < crashes; crash += 1) {
			faux.setResponses([fauxAssistantMessage(ANSWER)]);
			const flag = { dead: false };
			const harness = await Harness.open(hangingStorage(inner, flag), { models, registry, settings }, ctx);
			harness.resume();
			const root = await harness.root(ctx, { agent: { model: { provider: "faux", modelId: "faux-seat" } } });
			if (submissionId === null) submissionId = (await root.submit({ type: "input", content: "hi" }, ctx)).id;
			// Crash only while the task is committed `running` AND a partial has reached storage.
			await until(async () => {
				const live = (await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, ctx)) ?? {};
				if (live.run?.taskId === undefined) return false;
				taskId = live.run.taskId;
			 const rec = await harness.getTask(taskId, ctx);
				return live.generation?.message !== undefined && rec?.state?.status === "running";
			});
			flag.dead = true; // the host dies: no clean close, nothing more written
		}

		// Final open, this one NOT killed: the scheduler charges the streak and decides.
		faux.setResponses([fauxAssistantMessage(ANSWER)]);
		const flag = { dead: false };
		const harness = await Harness.open(hangingStorage(inner, flag), { models, registry, settings }, ctx);
		harness.resume();
		await harness.root(ctx, { agent: { model: { provider: "faux", modelId: "faux-seat" } } });

		// `restarts` is dropped from the record once an outcome is decided, so read it while the
		// task is still live; that is the streak the guard acted on.
		if (taskId !== null) restarts = (await harness.getTask(taskId, ctx))?.restarts ?? 0;
		await until(async () => {
			const rec = taskId === null ? null : await harness.getTask(taskId, ctx);
			return rec?.state?.status === "terminal";
		});
		const live = (await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, ctx)) ?? {};
		const submission = submissionId === null ? null : await harness.submission(submissionId, ctx);
		const settled = submission ? await submission.wait(ctx) : null;
		await inner.close(ctx);
		return { settled, restarts, runFailure: live.runFailure ?? null, threw };
	} catch (err) {
		return { settled: null, restarts, runFailure: null, threw: err };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const endedByLimit = (run) => run.settled?.reason === "restart_limit";

let failures = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log("  ok   " + label);
	else {
		failures += 1;
		console.log("  FAIL " + label + (detail ? " -- " + detail : ""));
	}
};

console.log("restart-limit behaviour on " + plane());
const seam = seamValue();
console.log("rig seam: cli.mjs openHarness writes restartLimit=" + (seam.written ?? "nothing") + " -> effective " + (seam.effective ?? "unknown") + " (the ruled 3 bites only where the seam writes it)");

if (DEFAULT_RESTART_LIMIT === undefined) {
	console.log("RESTART-LIMIT BEHAVIOUR FAIL - this plane has no settings.restartLimit at all, so the guard cannot be exercised here; run against the built pin (node scripts/sync-pi.mjs --sync && node scripts/sync-pi.mjs --link)");
	process.exit(1);
}

assert.equal(DEFAULT_RESTART_LIMIT, 5, "the library default this demo measures against is 5");

const atRuled = await crashLoop({ restartLimit: RULED, crashes: 3 });
const atDefault = await crashLoop({ restartLimit: undefined, crashes: 3 });
const atFiveFive = await crashLoop({ restartLimit: 5, crashes: 5 });
const shortOfLimit = await crashLoop({ restartLimit: RULED, crashes: 2 });

/* 1. the limit bites, and bites at the number */
check("restartLimit 3 + 3 crashes: the run ENDS with reason restart_limit", endedByLimit(atRuled), JSON.stringify(atRuled.settled));
check("restartLimit 3 + 3 crashes: it was charged exactly 3 restarts", atRuled.restarts === 3, "restarts=" + atRuled.restarts);
check("pi.live records the failure with the same reason", atRuled.runFailure?.reason === "restart_limit", JSON.stringify(atRuled.runFailure));

/* 2. the value the rig runs on today (no restartLimit at the seam) does not stop it */
check("restartLimit unset (default 5) + 3 crashes: NOT ended by the limit", !endedByLimit(atDefault), "settled=" + JSON.stringify(atDefault.settled) + " restarts=" + atDefault.restarts);
check("and it was charged the same 3 cut-offs, so the difference is the setting, not the fixture", atDefault.restarts === 3, "restarts=" + atDefault.restarts);

/* 3. the boundary is the number, not the fixture */
check("restartLimit 5 + 5 crashes: ENDS with restart_limit", endedByLimit(atFiveFive), JSON.stringify(atFiveFive.settled));
check("charged 5, not 3", atFiveFive.restarts === 5, "restarts=" + atFiveFive.restarts);

/* 4. one short of the limit still runs */
check("restartLimit 3 + 2 crashes: not ended by the limit", !endedByLimit(shortOfLimit), "settled=" + JSON.stringify(shortOfLimit.settled) + " restarts=" + shortOfLimit.restarts);

/* 5. the vacuity control */
check("vacuity control: the limited and the unlimited fixture both pass a no-throw assertion", atRuled.threw === null && atDefault.threw === null, "threw: " + (atRuled.threw?.message ?? "none") + " / " + (atDefault.threw?.message ?? "none"));
check("only the reason assertion separates them", endedByLimit(atRuled) && !endedByLimit(atDefault), atRuled.settled?.reason + " vs " + atDefault.settled?.reason);

console.log("\n" + (failures === 0 ? "RESTART-LIMIT BEHAVIOUR PASS - 3 ends the run, 5 does not, and the fixture alone proves nothing" : "RESTART-LIMIT BEHAVIOUR FAIL (" + failures + " check(s))"));
process.exit(failures === 0 ? 0 : 1);
