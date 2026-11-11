#!/usr/bin/env node
/*
 * routing-on-liveness-vs-progress.mjs — the falsifiable probe for RM-329 2/3 + 3/3 (#5631),
 * extended for the read-routing build row (#6321 -> #6399/#6401).

 The design says: ONE predicate (`brokerAlive` / `brokerHealth`), TWO consumers — the read ROUTING
 and the pid-not-running check rule. Routing must be three-way:
   up       -> spool, long bound
   degraded -> a VERDICT inside a DERIVED bound (never a hang, never a silent store open)
   down     -> readLocal, only with the pid PROVEN gone (ESRCH)

 What this probe measures on the code as it is:
   A  a state naming a DEAD pid with a fresh heartbeat: does a read answer fast, and via which route?
   B  a state naming a LIVE pid, fresh heartbeat, FROZEN lastPassAt: does the read resolve inside a
      derived bound, or wait out the 120_000 literal?
   C  does the operator's diagnostic verb (`status`) still answer while the broker is degraded?
   D  is there a `broker-state-pid-not-running` check rule at all?
   E  the negative half: with a LIVE pid that finding must be ABSENT. Scored as a failure until D is
      green - an absent rule vacuously passes every "must not fire" test.
   G  THE OWNERSHIP QUESTION THE ROUTING MIXES UP: when the state names a pid the OS says EXISTS, is
      the read served by opening the store directly? The store's owner is the broker PROCESS, not a
      seat generation lease, so "no lease is live" is not "no owner".
   H  the predicate disagreement itself: a wedged broker whose heartbeat has aged is called NOT ALIVE
      by the gate that decides whether a direct store open is safe, while the OS says the process is
      running. That is the second-writer path the fail-safe (#3398) exists to close.
   I  the documented contract "every path prints which one served the read": is it actually honoured
      on the primary local path?
   F  the invariant that must NOT be loosened: `resume` still refuses while the pid is alive.

Read-only opens cannot write, so they are not the hazard; the hazard is the write-mode open
(openNodeSqliteStorage migrates and takes BEGIN IMMEDIATE) reached while a broker process exists.

 Exit code 1 while ANY assertion fails. The original version printed FAIL lines and exited 0 - a
 gate that cannot fail is not a gate.
*/

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB = process.env.DURIG_DB || "selfdev.sqlite";
let scratchDb = DB;
const failures = [];
const say = (s) => console.log(s);
function check(cond, msg) {
	if (!cond) failures.push(msg);
	say(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
}

// Which path served the read. The client prints it on stderr by design ("an instrument that does not
// say how it got its number is indistinguishable from one that invented it"), so the route is
// observable - and the ownership invariant is testable without a debugger. A successful read that
// took the store-open route prints the note WITHOUT failing, so the probe must capture stderr from a
// process that exits 0; execFileSync cannot see it.
const routeOf = (text) => (/served directly from the store|served locally|read .* from the store directly/i.test(text) ? "local" : "broker");

function cli(verb, ms, env = {}, args = []) {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const child = spawn(process.execPath, ["cli.mjs", verb, ...args], {
			env: { ...process.env, DURIG_DB: scratchDb, ...env },
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => { out += d.toString(); });
		child.stderr.on("data", (d) => { err += d.toString(); });
		const killer = setTimeout(() => child.kill("SIGTERM"), ms);
		child.on("close", (code, signal) => {
			clearTimeout(killer);
			resolve({ code: signal ? 124 : code, out, err, combined: out + "\n" + err, elapsedMs: Date.now() - t0, killed: Boolean(signal) });
		});
	});
}

const scratch = mkdtempSync(join(tmpdir(), "durig-routing-"));
const db = join(scratch, "routing-repro.sqlite");
let livePid = null;
try {
	scratchDb = db;
	const { brokerAlive, brokerHealth, readBrokerState, pidAlive } = await import("../../src/broker.mjs");
	const { brokerAliveFor } = await import("../../src/readclient.mjs");

	const up = await cli("up", 60_000, {}, ["rig.starter.json"]);
	if (up.code !== 0) { say(`probe setup failed: ${up.err.slice(0, 200)}`); process.exit(2); }

	const forge = (state) => writeFileSync(`${db}.broker.json`, JSON.stringify(state));
	const liveState = () => ({ pid: process.pid, since: Date.now() - 6 * 3600_000, runToken: "repro", heartbeatAt: Date.now(), lastPassAt: Date.now() - 6 * 3600_000 });
	const spoolCount = () => (existsSync(`${db}.broker.inbox`) ? readdirSync(`${db}.broker.inbox`).length : 0);

	/* ---------- A: DEAD pid, fresh heartbeat ---------- */
	forge({ pid: 999999999, since: Date.now(), runToken: "repro", heartbeatAt: Date.now(), lastPassAt: Date.now() });
	const dead = await cli("queue", 40_000);
	check(dead.code === 0 && dead.elapsedMs < 10_000,
		`A a read with a DEAD pid answered fast (exit ${dead.code}, ${dead.elapsedMs} ms) - the down leg did not go to a dead spool`);
	check(routeOf(dead.combined) === "local",
		`A a proven-gone pid takes the local route (route was ${routeOf(dead.combined)})`);

	/* ---------- B: LIVE pid, fresh heartbeat, FROZEN progress ---------- */
	/* The probe's OWN pid is the guaranteed-live process. A state naming a live pid is exactly what a
	   resident broker produces. NOTE (#5829, runbook broker-down-or-stalled): refresh the heartbeat
	   before EACH verb, or it ages past the 60 s liveness gate and the state reads as dead. */
	livePid = process.pid;
	const before = spoolCount();
	forge(liveState());
	const live = await cli("queue", 40_000);
	say(`  B live pid ${livePid}, heartbeat fresh, lastPassAt 6 h old -> exit ${live.code} after ${live.elapsedMs} ms; spool ${before} -> ${spoolCount()}`);
	check(live.elapsedMs <= 30_000 && !live.killed,
		"B a degraded broker produces a VERDICT inside a derived bound (<=30 s); it took " + live.elapsedMs + " ms" + (live.killed ? " and was killed" : ""));

	/* ---------- C: the diagnostic verb must not be blinded by the wedge ---------- */
	forge(liveState());
	const stat = await cli("status", 40_000);
	say(`  C status under the same live-but-frozen state -> exit ${stat.code} after ${stat.elapsedMs} ms`);
	check(stat.code === 0 && stat.elapsedMs <= 30_000,
		"C `status` answers while the broker is degraded; it took " + stat.elapsedMs + " ms" + (stat.code !== 0 ? ` and exited ${stat.code}` : "") +
		" - the verb the operator uses to SEE the wedge is the thing the wedge blinds");

	/* ---------- D: is there a check rule at all? ---------- */
	forge(liveState());
	const chk = await cli("check", 60_000);
	const hasRule = /broker-state-pid-not-running|pid not running|pid is gone/.test(chk.out + chk.err);
	check(hasRule, "D `cli.mjs check` reports a finding for a broker state naming a DEAD pid (no such rule exists today)");

	/* ---------- E: the negative half, scored only once the rule exists ---------- */
	forge(liveState());
	const chkLive = await cli("check", 60_000);
	const falsePositive = /broker-state-pid-not-running/.test(chkLive.out + chkLive.err);
	check(hasRule && !falsePositive, "E a live pid does not trigger the pid-not-running finding" + (hasRule ? "" : " (untested: the rule does not exist, and an absent rule vacuously passes every 'must not fire' assertion)"));

	/* ---------- G: the ownership invariant ---------- */
	forge(liveState());
	const g = await cli("queue", 40_000);
	const route = routeOf(g.combined);
	say(`  G live pid ${livePid}: route=${route}, exit ${g.code} in ${g.elapsedMs} ms`);
	check(route !== "local",
		"G a read is NOT served by opening the store while the state names a pid that EXISTS (route was " + route +
		"); the owner is the broker PROCESS, and 'no generation lease is live' is not 'no owner'");

	/* ---------- H: does the ownership gate call a live process dead? ---------- */
	forge({ pid: process.pid, since: Date.now() - 6 * 3600_000, runToken: "repro", heartbeatAt: Date.now() - 90_000, lastPassAt: Date.now() - 6 * 3600_000 });
	const staleState = readBrokerState(db);
	const osSaysAlive = pidAlive(staleState.pid);
	const gateSaysAlive = brokerAliveFor(db);
	say(`  H pid ${staleState.pid}: pidAlive=${osSaysAlive} brokerAliveFor=${gateSaysAlive}`);
	check(!(osSaysAlive && !gateSaysAlive),
		"H the gate that decides whether a direct store open is safe must not call a running process dead " +
		"(pidAlive=true, brokerAliveFor=false with a 90 s-old heartbeat); today it does, so a wedged broker reads as 'no owner'");

	/* ---------- I: does the local path say how it got its number? ---------- */
	forge({ pid: 999999999, since: Date.now(), runToken: "repro", heartbeatAt: Date.now(), lastPassAt: Date.now() });
	const iRead = await cli("queue", 40_000);
	check(/read .* (served|from the store)|local read|route=/i.test(iRead.combined),
		"I a local read prints WHICH path served it (the docstring claims 'every path prints, on stderr, which one served the read'; nothing was printed) - got: " +
		(iRead.err.trim().slice(0, 120) || "nothing on stderr"));

	/* ---------- F: the invariant that must NOT be loosened ---------- */
	forge(liveState());
	const st = readBrokerState(db);
	say(`  F predicate before resume: pid=${st?.pid} brokerAlive=${brokerAlive(st, { now: Date.now() })} health=${brokerHealth(st, { now: Date.now() }).state}`);
	const res = await cli("resume", 40_000);
	check(res.code !== 0 && /second writer|second owner/i.test(res.out + res.err),
		"F `resume` still refuses while the pid is alive (exit " + res.code + "); a green that loosens this admits a second writer");

	console.log(`\nRESULT: ${failures.length} failed assertion(s)`);
} catch (err) {
	console.error(`probe error: ${err?.message ?? err}`);
	failures.push(`probe error: ${err?.message ?? err}`);
} finally {
	if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
}
process.exit(failures.length ? 1 : 0);
