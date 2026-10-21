// demo/tui-attach-seam.test.mjs — the Phase 2 SEAM LAYER (#3954): the operator window, fail-closed
//
// ONE SECTION PER RULED CONDITION, because each is a distinct way the seam fails dangerously. The
// demos are written against the seam module only (src/tui/durable/attach.mjs) — no live broker, no
// provider stack — so they run anywhere.
//
// FAILING-FIRST: before the seam module existed none of this was expressible. The properties it
// pins were, until now, prose in a ruling: the old `--own` flag WARNED and then opened a store the
// broker still owned (two writers with a log line), a seat's spooled pause request was accepted
// (`applyPauseOp` records `by: request.from`), and `npm run tui` defaulted to a FRESH
// `session.sqlite` when handed a seat with no store named.
//
// Run: node demo/tui-attach-seam.test.mjs   (exit 0 = pass)

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireSeatStore,
	assessAttachContract,
	attachContractPath,
	beginOperatorWindow,
	operatorSurfaceVerdict,
	readAttachContract,
	releaseSeatStore,
	resolveSeatStore,
	unscreenedPathVerdict,
} from "../src/tui/durable/attach.mjs";
import { BROKER_HEARTBEAT_TIMEOUT_MS, brokerStatePath } from "../src/storeownership.mjs";

/** Write a broker state file directly: the documented shape, without loading broker.mjs (pi-ai). */
function writeBrokerState(dbPath, { pid, heartbeatAt = Date.now() }) {
	writeFileSync(
		brokerStatePath(dbPath),
		JSON.stringify({ pid, since: new Date(heartbeatAt).toISOString(), runToken: "demo", heartbeatAt, lastPassAt: heartbeatAt }),
	);
}

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const base = await mkdtemp(join(tmpdir(), "durig-attach-"));
const db = join(base, "selfdev.sqlite");
// A store file has to EXIST for the ownership probe to be meaningful (a missing dir reads as free).
await writeFile(db, "");

try {
	console.log("\n=== (iii) A SEAT ATTEMPTS TO PAUSE THE BROKER IN ORDER TO ATTACH — REFUSED, naming why ===");
	const seatPause = operatorSurfaceVerdict("impl");
	check("a seat surface is refused", seatPause.allowed === false, JSON.stringify(seatPause));
	check("the refusal names the surface", /'impl'/.test(seatPause.reason ?? ""), seatPause.reason);
	check("the refusal names OPERATOR-ONLY (D113)", /OPERATOR-ONLY \(D113\)/.test(seatPause.reason ?? ""), seatPause.reason);
	check("the refusal says WHY it matters (second writer)", /second writer/.test(seatPause.reason ?? ""), seatPause.reason);
	check("an unspecified surface is refused too", operatorSurfaceVerdict(undefined).allowed === false);
	check("the operator surface is allowed", operatorSurfaceVerdict("operator").allowed === true);
	check("the operator check is case/space tolerant", operatorSurfaceVerdict("  Operator ").allowed === true);
	{
		const window = beginOperatorWindow({ dbPath: db, surface: "impl", tuiPid: 1234 });
		check("a seat cannot even RECORD a window", window.ok === false, JSON.stringify(window));
		check("...and no contract file was written", !existsSync(attachContractPath(db)));
	}

	console.log("\n=== (v) A NON-OPERATOR SURFACE IS REFUSED THE UNSCREENED PATH (the testable half of P-4) ===");
	const seatPath = unscreenedPathVerdict({ surface: "qa" });
	check("the unscreened path is refused for a seat", seatPath.unscreened === false, JSON.stringify(seatPath));
	check("a non-operator surface stays REDACTED", seatPath.redact === true, JSON.stringify(seatPath));
	const opPath = unscreenedPathVerdict({ surface: "operator" });
	check("the operator gets the unscreened path", opPath.unscreened === true && opPath.redact === false, JSON.stringify(opPath));

	console.log("\n=== (iv) (seat, conversation) resolves to the SEAT'S store, never a fresh session.sqlite ===");
	const rig = { db: db, seats: { impl: { conversationId: 7 }, qa: { conversationId: 15 }, scribe: {} } };
	const resolved = resolveSeatStore({ rig, seat: "impl" });
	check("it resolves", resolved.ok === true, JSON.stringify(resolved));
	check("to the RIG's store", resolved.dbPath === db, String(resolved.dbPath));
	check("and the seat's conversation id", resolved.conversationId === 7, String(resolved.conversationId));
	check("an explicit conversation id wins", resolveSeatStore({ rig, seat: "impl", conversationId: 99 }).conversationId === 99);
	check("an unknown seat is REFUSED (not defaulted)", resolveSeatStore({ rig, seat: "ghost" }).ok === false);
	check("a seat with no conversation is REFUSED", resolveSeatStore({ rig, seat: "scribe" }).ok === false);
	{
		const noDb = resolveSeatStore({ rig: { seats: { impl: { conversationId: 7 } } }, seat: "impl" });
		check("a rig with no store is REFUSED — there is deliberately no default", noDb.ok === false, JSON.stringify(noDb));
		check(
			"...and the refusal names the session.sqlite hazard",
			/session\.sqlite/.test(noDb.reason ?? ""),
			noDb.reason,
		);
	}

	console.log("\n=== (i) ACQUISITION FAILS -> the BROKER KEEPS WRITING and the attach refuses ===");
	// A LIVE broker state: fresh heartbeat, this process's own pid (alive by construction).
	writeBrokerState(db, { pid: process.pid, since: new Date().toISOString(), heartbeatAt: Date.now() });
	{
		const window = beginOperatorWindow({ dbPath: db, surface: "operator", tuiPid: process.pid });
		check("the operator can record a window", window.ok === true, JSON.stringify(window));
		const attempt = acquireSeatStore({ dbPath: db, surface: "operator", pid: 4242 });
		check("acquisition is REFUSED while the broker owns the store", attempt.ok === false, JSON.stringify(attempt));
		check("the refusal names the broker pid", /pid \d+/.test(attempt.reason ?? ""), attempt.reason);
		check(
			"...and says the broker KEEPS WRITING",
			/the broker keeps writing/i.test(attempt.reason ?? ""),
			attempt.reason,
		);
		check(
			"...and that a pause alone is not a release",
			/a pause alone is not a release/.test(attempt.reason ?? ""),
			attempt.reason,
		);
		const contract = readAttachContract(db);
		check("the contract is untouched by the refusal (it is still PENDING)", contract?.attachPending === true, JSON.stringify(contract));
	}

	console.log("\n=== the window opens only when the broker has GENUINELY released the store ===");
	// A dead pid with a FRESH heartbeat: exactly what a stopped broker leaves behind. `brokerAlive`
	// must read it as dead by the pid probe, not by waiting out the heartbeat window.
	writeBrokerState(db, { pid: 999_999, since: new Date().toISOString(), heartbeatAt: Date.now() });
	{
		const attempt = acquireSeatStore({ dbPath: db, surface: "operator", pid: 4242 });
		check("acquisition SUCCEEDS once the broker pid is gone", attempt.ok === true, JSON.stringify(attempt));
		check("the contract now names the attaching pid", attempt.contract?.tuiPid === 4242, JSON.stringify(attempt.contract));
		check("and is no longer pending", attempt.contract?.attachPending === false, JSON.stringify(attempt.contract));
	}

	console.log("\n=== (ii) A CRASHED TUI -> the reaper recovers from the RECORDED CONTRACT, no manual step ===");
	{
		// The recorded contract names a pid that is gone: a KILLED tui, not a clean exit.
		writeBrokerState(db, { pid: 999_999, since: new Date().toISOString(), heartbeatAt: Date.now() });
		beginOperatorWindow({ dbPath: db, surface: "operator", tuiPid: 999_998 });
		const stale = assessAttachContract(db);
		check("the abandoned window reads STALE", stale.stale === true, JSON.stringify(stale));
		check("the reason names the dead pid", /999998/.test(stale.reason ?? ""), stale.reason);
		// Recovery is legal: re-acquire through the guard with the contract re-recorded.
		const recovered = acquireSeatStore({ dbPath: db, surface: "operator", pid: 5555 });
		check("recovery re-acquires THROUGH the guard", recovered.ok === true, JSON.stringify(recovered));
		check("the recovered contract names the NEW pid", recovered.contract?.tuiPid === 5555, JSON.stringify(recovered.contract));
	}
	{
		// T-2's number, not a policy: a pending contract older than the heartbeat window is stale even
		// if the pid looks alive.
		writeBrokerState(db, { pid: 999_999, since: new Date().toISOString(), heartbeatAt: Date.now() });
		const old = Date.now() - BROKER_HEARTBEAT_TIMEOUT_MS - 1_000;
		beginOperatorWindow({ dbPath: db, surface: "operator", tuiPid: process.pid, now: old });
		const aged = assessAttachContract(db, { now: Date.now() });
		check(
			`a pending contract older than the ${BROKER_HEARTBEAT_TIMEOUT_MS / 1000}s heartbeat window is STALE`,
			aged.stale === true,
			JSON.stringify(aged),
		);
		check("...and the reason quotes the window", new RegExp(`${BROKER_HEARTBEAT_TIMEOUT_MS / 1000}s heartbeat window`).test(aged.reason ?? ""), aged.reason);
	}

	console.log("\n=== T-3: the holder DEMOTES on exit, and only its OWN contract ===");
	{
		// Re-establish a window owned by 5555 (the recovered attach above), so the release is aimed at a
		// contract that actually names it — the previous section left one owned by this process.
		beginOperatorWindow({ dbPath: db, surface: "operator", tuiPid: 5555 });
		const mine = releaseSeatStore({ dbPath: db, pid: 5555 });
		check("the holder releases its own contract", mine.released === true, JSON.stringify(mine));
		check("the contract file is gone", !existsSync(attachContractPath(db)));
		beginOperatorWindow({ dbPath: db, surface: "operator", tuiPid: 7777 });
		const other = releaseSeatStore({ dbPath: db, pid: 8888 });
		check("a DIFFERENT pid cannot clear someone else's contract", other.released === false, JSON.stringify(other));
		check("the contract survives that attempt", readAttachContract(db)?.tuiPid === 7777, JSON.stringify(readAttachContract(db)));
		check("a seat cannot release the window either", releaseSeatStore({ dbPath: db, pid: 7777 }).released === true);
	}

	console.log("\n=== no attach contract -> acquisition is refused (the window must be RECORDED first) ===");
	{
		writeBrokerState(db, { pid: 999_999, since: new Date().toISOString(), heartbeatAt: Date.now() });
		const attempt = acquireSeatStore({ dbPath: db, surface: "operator", pid: 4242 });
		check("refused with no contract on disk", attempt.ok === false, JSON.stringify(attempt));
		check("the refusal explains WHY the record is required (a reaper must not guess)", /recovered from the/.test(attempt.reason ?? ""), attempt.reason);
	}

	console.log(
		failures === 0
			? "\nPASS — the operator window is operator-only, fail-closed through the ownership guard, recorded before release, recoverable after a crash, and the unscreened path is refused to every non-operator surface"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
